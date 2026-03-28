/**
 * src/core/selfHealingAgent.js
 * ZerathCode — Self-Healing Agent
 * Author: sanaX3065
 *
 * Runs a project command, captures stdout/stderr,
 * detects errors, asks the AI to generate a fix,
 * applies the fix (file patches), then re-runs.
 *
 * Max healing attempts: 3 (configurable)
 *
 * Used by Orchestrator when action = "run_command"
 */

"use strict";

const fs             = require("fs");
const path           = require("path");
const { spawn }      = require("child_process");
const renderer       = require("../ui/renderer");

const MAX_ATTEMPTS = 3;

// Error patterns that indicate something fixable
const FIXABLE_PATTERNS = [
  /SyntaxError/i,
  /Cannot find module/i,
  /not found/i,
  /ENOENT/i,
  /TypeError/i,
  /ReferenceError/i,
  /Error:/i,
  /failed/i,
  /unexpected token/i,
  /is not defined/i,
  /cannot read propert/i,
  /npm ERR/i,
];

class SelfHealingAgent {
  /**
   * @param {object} opts
   * @param {import('./memoryManager')} opts.memory
   * @param {import('../utils/aiClient')} opts.ai
   * @param {string}  opts.provider
   * @param {string}  opts.workDir
   */
  constructor(opts) {
    this.memory   = opts.memory;
    this.ai       = opts.ai;
    this.provider = opts.provider;
    this.workDir  = opts.workDir;
  }

  /**
   * Run a command with self-healing.
   * Returns { success, output, attempts }
   *
   * @param {string}   cmd
   * @param {string[]} args
   * @param {string}   cwd
   * @param {number}   timeoutMs
   */
  async run(cmd, args = [], cwd = null, timeoutMs = 60000) {
    const workDir = cwd || this.workDir;
    let attempt   = 0;

    while (attempt < MAX_ATTEMPTS) {
      attempt++;
      renderer.agentLog("system", "run",
        `${cmd} ${args.join(" ")}  (attempt ${attempt}/${MAX_ATTEMPTS})`);

      const { code, stdout, stderr } = await this._exec(cmd, args, workDir, timeoutMs);
      const combined = (stdout + "\n" + stderr).trim();

      if (code === 0) {
        renderer.agentLog("system", "ok", `Exited 0 — success`);
        this.memory.setStatus("running");
        return { success: true, output: combined, attempts: attempt };
      }

      // Detect error
      const errorLines = this._extractErrors(combined);
      renderer.agentLog("system", "error",
        `Exit ${code}: ${errorLines[0] || combined.slice(0, 80)}`);

      // Log to memory
      this.memory.logError(`${cmd} ${args.join(" ")}`, combined.slice(0, 500));
      this.memory.setStatus("error");

      if (attempt >= MAX_ATTEMPTS) {
        renderer.agentLog("system", "warn",
          `Max healing attempts (${MAX_ATTEMPTS}) reached. Manual fix needed.`);
        return { success: false, output: combined, attempts: attempt };
      }

      // Ask AI to fix
      const fixed = await this._requestFix(cmd, args, combined, workDir);
      if (!fixed) {
        renderer.agentLog("system", "warn", "AI could not generate a fix.");
        return { success: false, output: combined, attempts: attempt };
      }

      renderer.agentLog("system", "info", "Fix applied — retrying…");
    }

    return { success: false, output: "", attempts: attempt };
  }

  // ── Ask AI for a fix ───────────────────────────────────────────────────────
  async _requestFix(cmd, args, errorOutput, workDir) {
    renderer.agentLog("ai", "plan", "Analysing error and generating fix…");

    // Build a list of relevant files for context
    const filesContext = this._gatherRelevantFiles(workDir, errorOutput);
    const ctx          = this.memory.buildContextBlock();

    const prompt = `You are an autonomous self-healing coding agent.

A command failed. Your job is to analyse the error and return ONLY a JSON array of file patches to fix it.

FAILED COMMAND: ${cmd} ${args.join(" ")}
WORKING DIR: ${workDir}

ERROR OUTPUT:
\`\`\`
${errorOutput.slice(0, 2000)}
\`\`\`

RELEVANT FILES:
${filesContext}

${ctx}

RULES:
- Output ONLY a valid JSON array of patch objects — no prose, no markdown outside the array.
- Each patch must fix the EXACT error shown above.
- Use ONLY these action types:
  { "action": "create_file", "params": { "path": "relative/path", "content": "full content" } }
  { "action": "edit_file",   "params": { "path": "relative/path", "find": "exact text", "replace": "fixed text" } }
  { "action": "run_command", "params": { "cmd": "npm", "args": ["install", "missing-package"], "cwd": "." } }
  { "action": "message",     "params": { "text": "explanation of what was wrong and what was fixed" } }
- If the error is "module not found X", add a run_command to install it first.
- Always include a message step explaining the fix.
- Do NOT include plan or memory_note steps.`;

    let rawResponse;
    try {
      rawResponse = await this.ai.ask(this.provider, prompt, { maxTokens: 2048 });
    } catch (err) {
      renderer.agentLog("ai", "error", `Fix request failed: ${err.message}`);
      return false;
    }

    // Parse steps
    const steps = this._parseSteps(rawResponse);
    if (!steps || steps.length === 0) {
      renderer.agentLog("system", "warn", "Could not parse fix steps from AI response.");
      return false;
    }

    // Apply each step (file patches only — no recursive run_command to avoid loops)
    for (const step of steps) {
      await this._applyStep(step, workDir);
    }

    return true;
  }

  // ── Apply a single fix step ────────────────────────────────────────────────
  async _applyStep(step, workDir) {
    const { action, params = {} } = step;

    if (action === "message") {
      renderer.agentLog("system", "info", `Fix: ${params.text?.slice(0, 100)}`);
      return;
    }

    if (action === "create_file") {
      const filePath = this._resolvePath(params.path, workDir);
      if (!filePath) return;
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, params.content || "", "utf8");
      const rel = path.relative(workDir, filePath);
      renderer.agentLog("file", "create", `[heal] ${rel}`);
      this.memory.registerFile(filePath, "Auto-healed file", "");
      return;
    }

    if (action === "edit_file") {
      const filePath = this._resolvePath(params.path, workDir);
      if (!filePath || !fs.existsSync(filePath)) return;

      let content = fs.readFileSync(filePath, "utf8");

      if (params.find !== undefined && params.replace !== undefined) {
        if (content.includes(params.find)) {
          content = content.replace(params.find, params.replace);
          fs.writeFileSync(filePath, content, "utf8");
          const rel = path.relative(workDir, filePath);
          renderer.agentLog("file", "edit", `[heal] ${rel}`);
        }
      } else if (params.line && params.content !== undefined) {
        const lines = content.split("\n");
        const idx   = parseInt(params.line) - 1;
        if (idx >= 0 && idx < lines.length) {
          lines[idx] = params.content;
          fs.writeFileSync(filePath, lines.join("\n"), "utf8");
          const rel = path.relative(workDir, filePath);
          renderer.agentLog("file", "edit", `[heal] ${rel} line ${params.line}`);
        }
      }
      return;
    }

    // Install missing packages — only npm/pip/pkg allowed, not arbitrary commands
    if (action === "run_command") {
      const safeCommands = new Set(["npm", "pip", "pip3", "pkg", "yarn"]);
      if (!safeCommands.has(params.cmd)) {
        renderer.agentLog("system", "warn", `Heal: skipping unsafe command "${params.cmd}"`);
        return;
      }
      const resolvedCwd = params.cwd
        ? path.resolve(workDir, params.cwd)
        : workDir;
      renderer.agentLog("system", "install",
        `[heal] ${params.cmd} ${(params.args || []).join(" ")}`);
      try {
        await this._exec(params.cmd, params.args || [], resolvedCwd, 120000);
      } catch {}
    }
  }

  // ── Gather relevant file contents for AI context ──────────────────────────
  _gatherRelevantFiles(workDir, errorText) {
    const lines   = [];
    const maxSize = 500; // chars per file

    // Extract filenames mentioned in error
    const mentioned = [];
    const fileRe    = /([a-zA-Z0-9_\-./]+\.[a-zA-Z]{1,5})(?::\d+)?/g;
    let m;
    while ((m = fileRe.exec(errorText)) !== null) {
      const candidate = path.resolve(workDir, m[1]);
      if (fs.existsSync(candidate)) mentioned.push(candidate);
    }

    // Also include package.json, main entry files
    const defaults = ["package.json", "index.js", "index.ts", "app.js", "server.js",
                      "build.gradle", "settings.gradle", "app/build.gradle"];
    for (const f of defaults) {
      const fp = path.join(workDir, f);
      if (fs.existsSync(fp)) mentioned.push(fp);
    }

    // Deduplicate and read
    const seen = new Set();
    for (const fp of mentioned) {
      if (seen.has(fp) || seen.size >= 6) continue;
      seen.add(fp);
      try {
        const content = fs.readFileSync(fp, "utf8").slice(0, maxSize);
        const rel     = path.relative(workDir, fp);
        lines.push(`\`${rel}\`:\n${content}\n`);
      } catch {}
    }

    return lines.join("\n---\n") || "(no relevant files found)";
  }

  // ── Parse AI response into step array ─────────────────────────────────────
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
        ? parsed.filter((x) => x && typeof x.action === "string")
        : null;
    } catch { return null; }
  }

  // ── Shell exec (returns { code, stdout, stderr }) ─────────────────────────
  _exec(cmd, args, cwd, timeoutMs) {
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const child = spawn(cmd, args, {
        cwd,
        env:   process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, timeoutMs);

      child.stdout.on("data", (d) => {
        const s = d.toString();
        stdout += s;
        process.stdout.write(s); // stream to terminal
      });

      child.stderr.on("data", (d) => {
        const s = d.toString();
        stderr += s;
        process.stderr.write(s);
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({ code: 1, stdout, stderr: err.message });
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        if (timedOut) {
          resolve({ code: 124, stdout, stderr: "Process timed out." });
        } else {
          resolve({ code: code || 0, stdout, stderr });
        }
      });
    });
  }

  // ── Extract error lines from output ───────────────────────────────────────
  _extractErrors(output) {
    return output.split("\n").filter((l) =>
      FIXABLE_PATTERNS.some((re) => re.test(l))
    );
  }

  // ── Safe path resolution ───────────────────────────────────────────────────
  _resolvePath(rawPath, workDir) {
    if (!rawPath) return null;
    const resolved = rawPath.startsWith("/")
      ? rawPath
      : path.resolve(workDir, rawPath);
    // Ensure it stays within workDir
    if (!resolved.startsWith(workDir)) {
      renderer.agentLog("file", "warn", `Heal: path "${rawPath}" escapes workDir`);
      return null;
    }
    return resolved;
  }
}

module.exports = SelfHealingAgent;
