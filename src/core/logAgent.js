/**
 * src/core/logAgent.js
 * ZerathCode — Log Agent
 *
 * Watches dev server stdout/stderr in real time.
 * Detects errors, reads relevant source files, asks AI to fix,
 * applies the patch, and restarts the server — all independently
 * of the coding orchestrator so the user always sees output.
 *
 * Key design:
 *   - Runs in its own process/scope, never blocks the REPL
 *   - Keeps a ring-buffer of the last 120 log lines
 *   - Debounces error detection (waits 1.5s of silence before acting)
 *   - Max 3 auto-fix attempts per session to avoid loops
 *   - Emits events: 'error_detected', 'fix_applied', 'fix_failed', 'log'
 */

"use strict";

const { spawn }      = require("child_process");
const fs             = require("fs");
const path           = require("path");
const EventEmitter   = require("events");
const renderer       = require("../ui/renderer");
const { C }          = require("../ui/renderer");

// Patterns that indicate a runtime error worth fixing
const ERROR_PATTERNS = [
  /Error:/i,
  /TypeError:/i,
  /ReferenceError:/i,
  /SyntaxError:/i,
  /Cannot find module/i,
  /ENOENT/i,
  /EADDRINUSE/i,
  /UnhandledPromiseRejection/i,
  /\bfailed\b/i,
  /\bcrash(ed)?\b/i,
];

// Lines that are safe to ignore (not real errors)
const IGNORE_PATTERNS = [
  /deprecation warning/i,
  /^\s*$/, // blank lines
  /listening on/i,
  /server (started|running)/i,
  /connected/i,
  /\[nodemon\]/i,
];

const RING_SIZE     = 120;   // max lines to buffer
const DEBOUNCE_MS   = 1500;  // wait for burst to settle before acting
const MAX_FIX_TRIES = 3;     // stop auto-fixing after this many attempts

class LogAgent extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string}   opts.workDir    - project directory
   * @param {string}   opts.provider   - AI provider key
   * @param {object}   opts.ai         - AiClient instance
   * @param {object}   opts.memory     - MemoryManager instance
   * @param {number}   [opts.port]     - dev server port
   */
  constructor(opts) {
    super();
    this.workDir   = opts.workDir;
    this.provider  = opts.provider;
    this.ai        = opts.ai;
    this.memory    = opts.memory;
    this.port      = opts.port || 3000;

    this._proc       = null;    // child process of dev server
    this._logBuffer  = [];      // ring buffer of { line, isErr, ts }
    this._fixCount   = 0;
    this._debounce   = null;
    this._fixing     = false;
    this._started    = false;
    this._startCmd   = null;
    this._startArgs  = [];
    this._restarting = false;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Start the dev server and begin watching its output.
   * @param {string}   cmd   e.g. "node"
   * @param {string[]} args  e.g. ["server.js"]
   */
  start(cmd, args = []) {
    if (this._started) this.stop();
    this._startCmd  = cmd;
    this._startArgs = args;
    this._fixCount  = 0;
    this._launch(cmd, args);
  }

  stop() {
    this._started = false;
    this._killProc();
    if (this._debounce) { clearTimeout(this._debounce); this._debounce = null; }
  }

  isRunning() {
    return this._proc && !this._proc.killed;
  }

  getRecentLogs(n = 40) {
    return this._logBuffer.slice(-n).map(e => e.line).join("\n");
  }

  // ── Launch / restart ───────────────────────────────────────────────────────

  _launch(cmd, args) {
    this._started = true;

    const child = spawn(cmd, args, {
      cwd:   this.workDir,
      env:   { ...process.env, PORT: String(this.port), FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    this._proc = child;

    let startLines = 0;

    const onData = (chunk, isErr) => {
      const text = chunk.toString();
      const lines = text.split(/\r?\n/).filter(Boolean);

      for (const line of lines) {
        // Show first 8 lines of startup
        if (startLines < 8) {
          renderer.agentLog("infra", isErr ? "warn" : "ok", line.trim().slice(0, 100));
          startLines++;
        }

        this._push(line, isErr);
        this.emit("log", line, isErr);
        this._scheduleErrorCheck(line, isErr);
      }
    };

    child.stdout.on("data", d => onData(d, false));
    child.stderr.on("data", d => onData(d, true));

    child.on("close", (code) => {
      if (!this._started) return;
      if (!this._restarting) {
        renderer.agentLog("infra", code === 0 ? "ok" : "warn",
          `Dev server exited (code ${code}) — LogAgent watching for errors…`);
      }
    });

    child.on("error", (err) => {
      renderer.agentLog("infra", "error", `Failed to start server: ${err.message}`);
    });
  }

  _killProc() {
    if (this._proc) {
      try { this._proc.kill("SIGTERM"); } catch {}
      this._proc = null;
    }
  }

  _restart() {
    this._restarting = true;
    renderer.agentLog("infra", "run", "Restarting dev server after fix…");
    this._killProc();
    setTimeout(() => {
      this._restarting = false;
      this._launch(this._startCmd, this._startArgs);
    }, 800);
  }

  // ── Ring buffer ────────────────────────────────────────────────────────────

  _push(line, isErr) {
    if (this._logBuffer.length >= RING_SIZE) this._logBuffer.shift();
    this._logBuffer.push({ line, isErr, ts: Date.now() });
  }

  // ── Error detection ────────────────────────────────────────────────────────

  _scheduleErrorCheck(line, isErr) {
    if (!isErr && !ERROR_PATTERNS.some(p => p.test(line))) return;
    if (IGNORE_PATTERNS.some(p => p.test(line))) return;
    if (this._fixing) return;
    if (this._fixCount >= MAX_FIX_TRIES) return;

    // Debounce: wait for burst to settle
    if (this._debounce) clearTimeout(this._debounce);
    this._debounce = setTimeout(() => {
      this._debounce = null;
      this._onError();
    }, DEBOUNCE_MS);
  }

  async _onError() {
    if (this._fixing || this._fixCount >= MAX_FIX_TRIES) return;
    this._fixing = true;
    this._fixCount++;

    const errorLines = this._logBuffer
      .filter(e => e.isErr || ERROR_PATTERNS.some(p => p.test(e.line)))
      .slice(-20)
      .map(e => e.line)
      .join("\n");

    const context = this._logBuffer.slice(-40).map(e => e.line).join("\n");

    renderer.agentLog("system", "warn",
      `[LogAgent] Error detected (attempt ${this._fixCount}/${MAX_FIX_TRIES}) — analysing…`);

    this.emit("error_detected", { errorLines, context });

    try {
      await this._requestFix(errorLines, context);
    } catch (err) {
      renderer.agentLog("system", "error", `[LogAgent] Fix request failed: ${err.message}`);
      this.emit("fix_failed", err.message);
    } finally {
      this._fixing = false;
    }
  }

  // ── AI fix request ─────────────────────────────────────────────────────────

  async _requestFix(errorLines, fullContext) {
    // Gather relevant source files to give AI full context
    const fileContext = this._readProjectFiles(errorLines);

    const prompt = `You are a bug-fixer for a Node.js web app running in Termux on Android.
The dev server crashed or threw an error. Fix it WITHOUT changing the app's features.

ERROR OUTPUT (last 20 relevant lines):
\`\`\`
${errorLines.slice(0, 1500)}
\`\`\`

FULL LOG CONTEXT (last 40 lines):
\`\`\`
${fullContext.slice(0, 1000)}
\`\`\`

PROJECT FILES:
${fileContext}

TERMUX RULES:
- Never use sqlite3 / better-sqlite3 / native addons — use sql.js or plain JSON files
- Never use vite/parcel/webpack — use Express + vanilla JS only
- Start command is always: node server.js (or node index.js)
- Node version: 18+ on ARM64

Respond with ONLY a valid JSON array of fix steps:
[
  { "action": "edit_file", "params": { "path": "server.js", "find": "exact text to find", "replace": "replacement text" } },
  { "action": "create_file", "params": { "path": "newfile.js", "content": "full content" } },
  { "action": "run_command", "params": { "cmd": "npm", "args": ["install", "missing-package"] } },
  { "action": "message", "params": { "text": "What was wrong and what was fixed" } }
]

RULES:
- Only fix the actual error shown — do not rewrite the whole app
- Include a "message" step explaining the fix
- Keep all existing functionality intact`;

    let raw;
    try {
      raw = await this.ai.ask(this.provider, prompt, { maxTokens: 2048 });
    } catch (err) {
      throw err;
    }

    const steps = this._parseSteps(raw);
    if (!steps || steps.length === 0) {
      renderer.agentLog("system", "warn", "[LogAgent] Could not parse fix from AI response");
      this.emit("fix_failed", "Could not parse AI response");
      return;
    }

    let hasRestartableChange = false;
    let fixDescription = "";

    for (const step of steps) {
      const result = await this._applyStep(step);
      if (step.action === "message") fixDescription = step.params?.text || "";
      if (["edit_file", "create_file", "run_command"].includes(step.action)) {
        hasRestartableChange = true;
      }
    }

    if (fixDescription) {
      renderer.agentLog("system", "ok",
        `[LogAgent] Fix applied: ${fixDescription.slice(0, 120)}`);
    }

    this.emit("fix_applied", { steps, description: fixDescription });

    if (this.memory) {
      this.memory.logAction("logagent", "fix",
        `Auto-fixed: ${fixDescription.slice(0, 80)}`);
    }

    // Restart server to apply the fix
    if (hasRestartableChange) {
      this._restart();
    }
  }

  // ── Apply a fix step ───────────────────────────────────────────────────────

  async _applyStep(step) {
    const { action, params = {} } = step;

    if (action === "message") {
      console.log(`\n  ${C.bcyan}[LogAgent Fix]${C.reset}  ${params.text || ""}\n`);
      return;
    }

    if (action === "create_file") {
      const fp = this._safeResolve(params.path);
      if (!fp) return;
      const dir = path.dirname(fp);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fp, params.content || "", "utf8");
      renderer.agentLog("file", "create",
        `[LogAgent] ${path.relative(this.workDir, fp)}`);
      return;
    }

    if (action === "edit_file") {
      const fp = this._safeResolve(params.path);
      if (!fp || !fs.existsSync(fp)) return;
      let content = fs.readFileSync(fp, "utf8");
      if (params.find !== undefined && content.includes(params.find)) {
        content = content.replace(params.find, params.replace ?? "");
        fs.writeFileSync(fp, content, "utf8");
        renderer.agentLog("file", "edit",
          `[LogAgent] ${path.relative(this.workDir, fp)}`);
      } else if (params.content !== undefined) {
        fs.writeFileSync(fp, params.content, "utf8");
        renderer.agentLog("file", "edit",
          `[LogAgent] ${path.relative(this.workDir, fp)} (full rewrite)`);
      }
      return;
    }

    if (action === "run_command") {
      const safe = new Set(["npm", "pip", "pip3", "pkg", "yarn"]);
      if (!safe.has(params.cmd)) return;
      const args = Array.isArray(params.args) ? params.args : [];
      renderer.agentLog("system", "install",
        `[LogAgent] ${params.cmd} ${args.join(" ")}`);
      await new Promise((resolve) => {
        const c = spawn(params.cmd, args, {
          cwd: this.workDir,
          stdio: "inherit",
        });
        c.on("close", resolve);
        c.on("error", resolve);
      });
    }
  }

  // ── Read project files for context ─────────────────────────────────────────

  _readProjectFiles(errorText) {
    const MAX_SIZE  = 400;  // chars per file
    const MAX_FILES = 6;

    // Extract filenames mentioned in the error
    const mentioned = [];
    const re = /([a-zA-Z0-9_\-./]+\.(js|ts|json|html|css))(?::\d+)?/g;
    let m;
    while ((m = re.exec(errorText)) !== null) {
      const fp = path.resolve(this.workDir, m[1]);
      if (fs.existsSync(fp)) mentioned.push(fp);
    }

    // Always include entry points
    const defaults = ["package.json", "server.js", "index.js", "app.js", "db.js"]
      .map(f => path.join(this.workDir, f));

    const all  = [...new Set([...mentioned, ...defaults])];
    const out  = [];

    for (const fp of all) {
      if (out.length >= MAX_FILES) break;
      if (!fs.existsSync(fp)) continue;
      try {
        const content = fs.readFileSync(fp, "utf8").slice(0, MAX_SIZE);
        const rel = path.relative(this.workDir, fp);
        out.push(`--- ${rel} ---\n${content}`);
      } catch {}
    }

    return out.join("\n\n") || "(no source files found)";
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  _safeResolve(rawPath) {
    if (!rawPath) return null;
    const abs = rawPath.startsWith("/")
      ? rawPath
      : path.resolve(this.workDir, rawPath);
    if (!abs.startsWith(this.workDir)) return null;
    return abs;
  }

  _parseSteps(raw) {
    if (!raw) return null;
    let str = raw.trim();
    const fence = str.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) str = fence[1].trim();
    const s = str.indexOf("[");
    const e = str.lastIndexOf("]");
    if (s === -1 || e === -1) return null;
    try {
      const parsed = JSON.parse(str.slice(s, e + 1));
      return Array.isArray(parsed)
        ? parsed.filter(x => x && typeof x.action === "string")
        : null;
    } catch { return null; }
  }
}

module.exports = LogAgent;
