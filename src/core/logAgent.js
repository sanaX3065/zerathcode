/**
 * src/core/logAgent.js
 * ZerathCode — Log Agent v4 (Dual-Process Aware)
 *
 * Monitors BOTH frontend and backend subprocesses independently.
 * Each has its own fix budget (3 attempts), debounce timer, and
 * error buffer. Both share the same FileMutex from the Orchestrator.
 *
 * Error → fix → restart flow is fully independent per process,
 * so a backend crash doesn't interrupt a healthy frontend.
 */

"use strict";

const { spawn }    = require("child_process");
const fs           = require("fs");
const path         = require("path");
const EventEmitter = require("events");
const renderer     = require("../ui/renderer");
const { C }        = require("../ui/renderer");

const ERROR_PATTERNS = [
  /error:/i, /typeerror/i, /referenceerror/i, /syntaxerror/i,
  /cannot find module/i, /enoent/i, /unhandledpromiserejection/i,
  /\bcrash(ed)?\b/i, /\bfailed\b/i, /identifier .* has already been declared/i,
];
const IGNORE_PATTERNS = [
  /^\s*$/, /deprecation warning/i, /^warn\b/i,
  /listening on/i, /server (started|running)/i, /^>$/,
  /npm warn/i, /looking for funding/i,
];

const RING_SIZE     = 80;
const DEBOUNCE_MS   = 2000;
const MAX_FIX_TRIES = 3;

// ─────────────────────────────────────────────────────────────────────────────
class ProcessWatcher extends EventEmitter {
  constructor(name, processRef, mutex, workDir, ai, provider, memory) {
    super();
    this.name       = name;      // "frontend" | "backend"
    this.proc       = processRef;  // SubProcess instance
    this.mutex      = mutex;
    this.workDir    = workDir;
    this.ai         = ai;
    this.provider   = provider;
    this.memory     = memory;

    this._buf      = [];   // { line, isErr, ts }
    this._fixing   = false;
    this._tries    = 0;
    this._debounce = null;
  }

  /** Called by DualProcessManager when a line arrives from the subprocess */
  feed(line, isErr) {
    if (this._buf.length >= RING_SIZE) this._buf.shift();
    this._buf.push({ line, isErr, ts: Date.now() });

    if (IGNORE_PATTERNS.some(p => p.test(line))) return;
    if (this._fixing) return;
    if (this._tries >= MAX_FIX_TRIES) return;

    if (isErr || ERROR_PATTERNS.some(p => p.test(line))) {
      this._schedule();
    }
  }

  reset() {
    this._tries  = 0;
    this._fixing = false;
    if (this._debounce) { clearTimeout(this._debounce); this._debounce = null; }
  }

  _schedule() {
    if (this._debounce) clearTimeout(this._debounce);
    this._debounce = setTimeout(() => {
      this._debounce = null;
      this._fix();
    }, DEBOUNCE_MS);
  }

  async _fix() {
    if (this._fixing || this._tries >= MAX_FIX_TRIES) return;
    this._fixing = true;
    this._tries++;

    const errorLines = this._buf
      .filter(e => e.isErr || ERROR_PATTERNS.some(p => p.test(e.line)))
      .slice(-15).map(e => e.line).join("\n");

    const context = this._buf.slice(-30).map(e => e.line).join("\n");

    renderer.agentLog("system", "warn",
      `[LogAgent:${this.name}] Fix attempt ${this._tries}/${MAX_FIX_TRIES}`);

    this.emit("error_detected", { name: this.name, errorLines });

    try {
      const changed = await this._requestFix(errorLines, context);
      if (changed) {
        renderer.agentLog("infra", "run",
          `[LogAgent:${this.name}] Fix applied — restarting ${this.name}…`);
        await this.proc.restart();
        this.emit("fix_applied", this.name);
      } else {
        this.emit("fix_failed", { name: this.name, reason: "No actionable steps from AI" });
      }
    } catch (err) {
      renderer.agentLog("system", "error",
        `[LogAgent:${this.name}] Fix cycle error: ${err.message}`);
      this.emit("fix_failed", { name: this.name, reason: err.message });
    } finally {
      this._fixing = false;
    }
  }

  async _requestFix(errorLines, context) {
    const fileCtx = this._gatherFiles(errorLines);
    const isBackend = this.name === "backend";

    const prompt = `You are fixing a ${this.name} process crash in a Node.js/Vite project on Termux (Android ARM64).

PROCESS: ${this.name}
ERROR:
\`\`\`
${errorLines.slice(0, 1200)}
\`\`\`

CONTEXT (last 30 lines):
\`\`\`
${context.slice(0, 800)}
\`\`\`

FILES:
${fileCtx}

${isBackend ? `BACKEND RULES:
- NO sqlite3/better-sqlite3 (no NDK) — use sql.js (pure WASM) or flat JSON
- sql.js usage: const { Database } = require('sql.js'); initSqlJs().then(SQL => { const db = new SQL.Database(); ... })
- Express must use CommonJS: const express = require('express'); — never duplicate declarations
- Entry: node server.js on port process.env.PORT || 3001` : `FRONTEND RULES:
- Uses Vite dev server — vite must be in devDependencies
- React components in src/ with .jsx extension
- API calls proxy to http://localhost:3001 via vite.config.js`}

CRITICAL: Respond ONLY with a JSON array. No prose outside [].
[
  { "action": "edit_file", "params": { "path": "server.js", "find": "exact text", "replace": "fixed text" } },
  { "action": "create_file", "params": { "path": "file.js", "content": "full content" } },
  { "action": "run_command", "params": { "cmd": "npm", "args": ["install", "pkg"] } },
  { "action": "message", "params": { "text": "What was wrong and what was fixed" } }
]
Make the MINIMUM change needed. Do not rewrite the entire file unless absolutely necessary.`;

    let raw;
    try {
      raw = await this.ai.ask(this.provider, prompt, { maxTokens: 2000 });
    } catch (err) {
      throw new Error(`AI call failed: ${err.message}`);
    }

    const steps = this._parseSteps(raw);
    if (!steps?.length) return false;

    let changed = false;
    for (const step of steps) {
      const ok = await this._applyStep(step);
      if (ok) changed = true;
    }
    return changed;
  }

  async _applyStep(step) {
    const { action, params = {} } = step;

    if (action === "message") {
      console.log(`\n  ${C.bcyan}[LogAgent:${this.name}]${C.reset}  ${params.text || ""}\n`);
      if (this.memory) this.memory.logAction(`logagent:${this.name}`, "fix",
        (params.text || "").slice(0, 80));
      return false;
    }

    if (action === "create_file") {
      const fp = this._safe(params.path);
      if (!fp) return false;
      const release = await this.mutex.acquire(fp);
      try {
        const dir = path.dirname(fp);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(fp, params.content || "", "utf8");
        renderer.agentLog("file", "create",
          `[LogAgent:${this.name}] ${path.relative(this.workDir, fp)}`);
        return true;
      } finally { release(); }
    }

    if (action === "edit_file") {
      const fp = this._safe(params.path);
      if (!fp || !fs.existsSync(fp)) return false;
      const release = await this.mutex.acquire(fp);
      try {
        let content = fs.readFileSync(fp, "utf8");
        if (params.find !== undefined && content.includes(params.find)) {
          content = content.replace(params.find, params.replace ?? "");
          fs.writeFileSync(fp, content, "utf8");
          renderer.agentLog("file", "edit",
            `[LogAgent:${this.name}] ${path.relative(this.workDir, fp)}`);
          return true;
        } else if (params.content !== undefined) {
          fs.writeFileSync(fp, params.content, "utf8");
          renderer.agentLog("file", "edit",
            `[LogAgent:${this.name}] ${path.relative(this.workDir, fp)} (rewrite)`);
          return true;
        }
        renderer.agentLog("file", "warn",
          `[LogAgent:${this.name}] find text not found in ${params.path}`);
        return false;
      } finally { release(); }
    }

    if (action === "run_command") {
      const SAFE = new Set(["npm", "pip", "pip3", "pkg", "yarn"]);
      if (!SAFE.has(params.cmd)) return false;
      const args = Array.isArray(params.args) ? params.args : [];
      renderer.agentLog("system", "install",
        `[LogAgent:${this.name}] ${params.cmd} ${args.join(" ")}`);
      await new Promise(resolve => {
        const c = spawn(params.cmd, args, { cwd: this.workDir, stdio: "inherit" });
        c.on("close", resolve);
        c.on("error", resolve);
      });
      return true;
    }

    return false;
  }

  _gatherFiles(errorText) {
    const MAX_PER = 500, MAX_FILES = 4;
    const mentioned = [];
    const re = /([a-zA-Z0-9_\-./]+\.(js|jsx|ts|json|html|css))(?::\d+)?/g;
    let m;
    while ((m = re.exec(errorText)) !== null) {
      const fp = path.resolve(this.workDir, m[1]);
      if (fs.existsSync(fp)) mentioned.push(fp);
    }
    const defaults = this.name === "backend"
      ? ["server.js","index.js","package.json"]
      : ["vite.config.js","src/App.jsx","src/main.jsx","package.json"];
    for (const name of defaults) {
      const fp = path.join(this.workDir, name);
      if (fs.existsSync(fp)) mentioned.push(fp);
    }
    const seen = new Set(), out = [];
    for (const fp of mentioned) {
      if (seen.has(fp) || out.length >= MAX_FILES) continue;
      seen.add(fp);
      try {
        const content = fs.readFileSync(fp, "utf8").slice(0, MAX_PER);
        out.push(`--- ${path.relative(this.workDir, fp)} ---\n${content}`);
      } catch {}
    }
    return out.join("\n\n") || "(no source files found)";
  }

  _safe(rawPath) {
    if (!rawPath) return null;
    const abs = rawPath.startsWith("/")
      ? rawPath : path.resolve(this.workDir, rawPath);
    return abs.startsWith(this.workDir) ? abs : null;
  }

  _parseSteps(raw) {
    if (!raw) return null;
    let str = raw.trim();
    const fence = str.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) str = fence[1].trim();
    const s = str.indexOf("["), e = str.lastIndexOf("]");
    if (s === -1 || e === -1) return null;
    try {
      const p = JSON.parse(str.slice(s, e + 1));
      return Array.isArray(p) ? p.filter(x => x && typeof x.action === "string") : null;
    } catch { return null; }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LogAgent — owns two ProcessWatchers
// ─────────────────────────────────────────────────────────────────────────────
class LogAgent extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string}             opts.workDir
   * @param {string}             opts.provider
   * @param {AiClient}           opts.ai
   * @param {MemoryManager}      opts.memory
   * @param {FileMutex}          opts.mutex
   * @param {DualProcessManager} opts.processManager
   */
  constructor(opts) {
    super();
    this.workDir = opts.workDir;

    this._frontendWatcher = null;
    this._backendWatcher  = null;

    this._opts = opts;  // store for lazy creation
  }

  /**
   * Create watcher for the frontend subprocess.
   * Call this after DualProcessManager.frontend is ready.
   */
  attachFrontend(frontendSubProc) {
    const w = new ProcessWatcher(
      "frontend", frontendSubProc,
      this._opts.mutex, this.workDir,
      this._opts.ai, this._opts.provider, this._opts.memory
    );
    this._wire(w);
    this._frontendWatcher = w;
    // Wire onLine
    frontendSubProc.onLine = (line, isErr) => w.feed(line, isErr);
  }

  attachBackend(backendSubProc) {
    const w = new ProcessWatcher(
      "backend", backendSubProc,
      this._opts.mutex, this.workDir,
      this._opts.ai, this._opts.provider, this._opts.memory
    );
    this._wire(w);
    this._backendWatcher = w;
    backendSubProc.onLine = (line, isErr) => w.feed(line, isErr);
  }

  resetFrontend() { this._frontendWatcher?.reset(); }
  resetBackend()  { this._backendWatcher?.reset(); }

  _wire(watcher) {
    watcher.on("error_detected", ev => {
      renderer.agentLog("system", "warn",
        `[LogAgent:${ev.name}] Runtime error — starting auto-fix…`);
      this.emit("error_detected", ev);
    });
    watcher.on("fix_applied", name => {
      renderer.agentLog("system", "ok",
        `[LogAgent:${name}] ✔ Fix applied & process restarted`);
      this.emit("fix_applied", name);
    });
    watcher.on("fix_failed", ev => {
      renderer.agentLog("system", "error",
        `[LogAgent:${ev.name}] Auto-fix failed: ${ev.reason}`);
      this.emit("fix_failed", ev);
    });
  }
}

module.exports = LogAgent;