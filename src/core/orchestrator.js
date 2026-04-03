/**
 * src/core/orchestrator.js
 * ZerathCode v4 — Full Stack Orchestrator
 */

"use strict";

const fs               = require("fs");
const path             = require("path");

const AiClient           = require("../utils/aiClient");
const SandboxManager     = require("./sandboxManager");
const SelfHealingAgent   = require("./selfHealingAgent");
const LogAgent           = require("./logAgent");
const FileContextBuilder = require("./fileContextBuilder");
const { DualProcessManager } = require("./processManager");
const renderer           = require("../ui/renderer");
const { C }              = require("../ui/renderer");

const InfrastructureAgent = require("../agents/infrastructureAgent");
const SecurityAgent       = require("../agents/securityAgent");
const QAAgent             = require("../agents/qaAgent");
const AssistantAgent      = require("../agents/assistantAgent");
const WebAgent            = require("../agents/webAgent");

const PREVIEW_LINES  = 20;
const PARALLEL_BATCH = 4;

// ═════════════════════════════════════════════════════════════════════════════
// FILE MUTEX
// ═════════════════════════════════════════════════════════════════════════════
class FileMutex {
  constructor() { this._chains = new Map(); }

  acquire(filePath) {
    const key  = path.normalize(filePath);
    const prev = this._chains.get(key) || Promise.resolve();
    let release;
    const next = new Promise(r => { release = r; });
    this._chains.set(key, prev.then(() => next));
    return prev.then(() => () => {
      release();
      if (this._chains.get(key) === next) this._chains.delete(key);
    });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPTS
// ═════════════════════════════════════════════════════════════════════════════
const SYSTEM_PROMPTS = {

  chat: `You are ZerathCode Chat Agent — expert assistant on Termux/Android.
Output ONLY valid JSON arrays.
For real-time data use web_fetch first.
AVAILABLE ACTIONS: message, create_file, read_file, search_files, web_fetch`,

  fullstack: `You are ZerathCode Full Stack Agent — builds complete web apps on Termux/Android.

⚠️  CRITICAL: OUTPUT ONLY A SINGLE VALID JSON ARRAY.
- No text before [ or after ]
- NO markdown code blocks (no triple backticks)
- NO literal newlines inside JSON strings — use \\n instead
- Escape all newlines as \\n in string values
- Use straight double quotes only
- Every string property must use \\n for line breaks, never actual newlines

MANDATORY STEP FORMAT — use EXACTLY this structure, always nested under "params":
  { "action": "create_file", "params": { "path": "src/App.jsx", "content": "line1\\nline2" } }
  { "action": "edit_file",   "params": { "path": "server.js", "find": "old text", "replace": "new text" } }
  { "action": "run_command", "params": { "cmd": "npm", "args": ["install"] } }
  { "action": "message",     "params": { "text": "Summary of what was done" } }
  { "action": "memory_note", "params": { "note": "Key fact to remember" } }
  { "action": "plan",        "params": { "steps": ["1. ...", "2. ..."], "phases": [...] } }

DO NOT put "path" or "content" directly on the step object — always nest them inside "params".

STACK RULES (Termux ARM64 — STRICT):
  Frontend : React + Vite OR vanilla HTML+CSS+JS. NEVER server-side rendered.
  Backend  : Node.js + Express. CommonJS ONLY (require/module.exports).
             NEVER duplicate require() declarations in the same file.
  Database : sql.js (pure WASM) — NEVER sqlite3/better-sqlite3 (no NDK on ARM).
             sql.js: const initSqlJs = require('sql.js'); const SQL = await initSqlJs(); const db = new SQL.Database();
  Ports    : frontend → 5173 (vite dev), backend → process.env.PORT || 3001
  Start    : backend = "node server.js", frontend = "npx vite" or "npm run dev"

PHASE-SPLIT EXECUTION (REQUIRED):
  The plan MUST separate files into two phases:
    phase "frontend" → all React/HTML/CSS/JS/vite files
    phase "backend"  → server.js, db files, API routes
  After frontend phase runs, the frontend dev server starts BEFORE backend is built.

PLAN STEP FORMAT (required):
  { "action": "plan", "params": {
      "steps": ["1. Create package.json", "2. Create vite.config.js"],
      "frontend_entry": "index.html",
      "backend_entry": "server.js",
      "frontend_port": 5173,
      "backend_port": 3001,
      "phases": [
        { "name": "frontend", "files": ["package.json","vite.config.js","index.html","src/App.jsx","src/main.jsx","src/App.css"] },
        { "name": "backend",  "files": ["server.js"] }
      ]
  }}

CREATE FILES IN ORDER:
  1. package.json (first — needed for npm install)
  2. vite.config.js
  3. index.html + src/main.jsx + src/App.jsx (in parallel)
  4. src/App.css
  [frontend starts here]
  5. server.js
  6. db.js (if needed)
  [backend starts here]

FILE CONTEXT below shows existing files — edit don't recreate.
ALWAYS end with memory_note.

AVAILABLE ACTIONS: plan, message, create_file, edit_file, append_file,
  delete_file, read_file, search_files, run_command, web_fetch, memory_note,
  ask_user, deploy_app, start_tunnel, security_scan

FINAL REMINDER: Your ENTIRE response must be a valid JSON array starting with [ and ending with ].
No text outside the array. Always use "params" object — never put path/content directly on the step.`,

  mobiledev: `You are ZerathCode Mobile Dev Agent.

⚠️  OUTPUT ONLY VALID JSON ARRAY. NO MARKDOWN, NO BACKTICKS. ⚠️️
- Start with [ and end with ]
- NO literal newlines in strings (use \\n instead)
- Always nest fields inside "params": { "path": "...", "content": "..." }

AVAILABLE ACTIONS: plan, message, create_file, edit_file, search_files, read_file,
  run_command, memory_note, ask_user, security_scan`,

  infra: `You are ZerathCode Infrastructure Agent.

⚠️  OUTPUT ONLY VALID JSON ARRAY. NO MARKDOWN, NO BACKTICKS. ⚠️️
- Start with [ and end with ]
- NO literal newlines in strings (use \\n instead)
- Always nest fields inside "params"

AVAILABLE ACTIONS: plan, message, create_file, run_command, deploy_app, start_tunnel, memory_note`,

  fullai: `[{ "action": "message", "params": { "text": "Full AI Mode ready." } }]`,
};

// ═════════════════════════════════════════════════════════════════════════════
// STATUS REPORT PROMPT
// ═════════════════════════════════════════════════════════════════════════════
function statusPrompt(phase, logLines, port, projectName) {
  return `You are the ZerathCode status reporter.
The ${phase} of project "${projectName}" just started on port ${port}.

Here are the last 20 lines from ${phase}.log:
\`\`\`
${logLines}
\`\`\`

Report in exactly this format (JSON array with ONE message action):
[
  { "action": "message", "params": { "text": "✅ ${phase.toUpperCase()} READY\\n\\nWhat was built:\\n- [list key files/features]\\n\\nRunning at: http://localhost:${port}\\n\\nStatus: [HEALTHY / HAS WARNINGS / describe any issues]\\n\\nNext: [what happens next]" } }
]
Keep it short (under 100 words). Be specific about what files were created.`;
}

// ═════════════════════════════════════════════════════════════════════════════
// ORCHESTRATOR
// ═════════════════════════════════════════════════════════════════════════════
class Orchestrator {
  constructor(opts) {
    this.provider    = opts.provider;
    this.mode        = opts.mode;
    this.keyManager  = opts.keyManager;
    this.memory      = opts.memory;
    this.permManager = opts.permManager;
    this.workDir     = opts.workDir || process.cwd();

    this.sandbox = new SandboxManager();
    this.ai      = new AiClient(opts.keyManager);
    this.healer  = new SelfHealingAgent({
      memory: this.memory, ai: this.ai,
      provider: this.provider, workDir: this.workDir,
    });

    this.mutex = new FileMutex();
    this.fileCtx = new FileContextBuilder(this.workDir);

    this.procMgr = new DualProcessManager({
      workDir:      this.workDir,
      frontendPort: 5173,
      backendPort:  3001,
    });

    this.logAgent = new LogAgent({
      workDir:        this.workDir,
      provider:       this.provider,
      ai:             this.ai,
      memory:         this.memory,
      mutex:          this.mutex,
      processManager: this.procMgr,
    });

    this.logAgent.on("error_detected", ev =>
      renderer.agentLog("system", "warn",
        `[LogAgent:${ev.name}] Error detected — auto-fix starting…`));
    this.logAgent.on("fix_applied", name =>
      renderer.agentLog("system", "ok",
        `[LogAgent:${name}] ✔ Fixed & restarted`));
    this.logAgent.on("fix_failed", ev =>
      renderer.agentLog("system", "error",
        `[LogAgent:${ev.name}] Auto-fix exhausted — manual fix needed`));

    this._filesCreated = 0;
    this._phases       = { frontend: [], backend: [] };
    this._currentPhase = null;
    this._frontendDone = false;
    this._backendDone  = false;

    this._frontendPort  = 5173;
    this._backendPort   = 3001;
    this._frontendEntry = null;
    this._backendEntry  = null;
  }

  // ── Shutdown ───────────────────────────────────────────────────────────────
  async shutdown() {
    await this.procMgr.stopAll();
  }

  // ── Generate run.sh programmatically based on what files actually exist ───
  async _ensureRunScript() {
    const runSh = path.join(this.workDir, "run.sh");

    if (fs.existsSync(runSh)) {
      renderer.agentLog("infra", "ok", `✓ run.sh found`);
      return;
    }

    const hasPackageJson = fs.existsSync(path.join(this.workDir, "package.json"));
    const backendEntry   = ["server.js", "index.js", "app.js"]
      .find(f => fs.existsSync(path.join(this.workDir, f)));
    const hasFrontend    = ["src/App.jsx", "src/main.jsx", "index.html", "vite.config.js"]
      .some(f => fs.existsSync(path.join(this.workDir, f)));

    if (!hasPackageJson && !backendEntry && !hasFrontend) {
      renderer.agentLog("infra", "warn", "No project files found yet — run.sh skipped");
      return;
    }

    const lines = ["#!/bin/bash", 'cd "$(dirname "$0")"', ""];

    if (hasPackageJson) {
      lines.push("# Install dependencies if needed");
      lines.push('[ ! -d node_modules ] && npm install');
      lines.push("");
    }

    if (hasFrontend && backendEntry) {
      lines.push(`# Start backend on port ${this._backendPort}`);
      lines.push(`PORT=${this._backendPort} node ${backendEntry} &`);
      lines.push("BACKEND_PID=$!");
      lines.push("");
      lines.push(`# Start frontend dev server on port ${this._frontendPort}`);
      lines.push("npm run dev &");
      lines.push("FRONTEND_PID=$!");
      lines.push("");
      lines.push(`echo "✔ Backend  → http://localhost:${this._backendPort}"`);
      lines.push(`echo "✔ Frontend → http://localhost:${this._frontendPort}"`);
      lines.push('echo "Press Ctrl+C to stop both"');
      lines.push("wait");
    } else if (hasFrontend) {
      lines.push(`echo "✔ Starting frontend on port ${this._frontendPort}"`);
      lines.push("npm run dev");
    } else if (backendEntry) {
      lines.push(`echo "✔ Starting server on port ${this._backendPort}"`);
      lines.push(`PORT=${this._backendPort} node ${backendEntry}`);
    }

    const script = lines.join("\n") + "\n";
    fs.writeFileSync(runSh, script, { encoding: "utf8", mode: 0o755 });
    renderer.agentLog("infra", "create", `✓ run.sh generated (${lines.length} lines)`);

    console.log(`\n  ${C.bgreen}run.sh${C.reset}\n  ${C.grey}${lines.slice(0, 4).join("\n  ")}...\n`);
  }

  // ── Main process turn ──────────────────────────────────────────────────────
  async process(userInput) {
    this.memory.addUserMessage(userInput);
    renderer.userMessage(userInput);

    const isChatMode = this.mode === "chat" || this.mode === "fullai";
    const MAX_LOOPS  = isChatMode ? 5 : 1;

    this._filesCreated = 0;
    this._phases       = { frontend: [], backend: [] };

    const systemPrompt = this._buildSystemPrompt(userInput);
    const toolResults  = [];
    let   summary      = "";
    let   loopCount    = 0;
    let   gotAnswer    = false;
    let   forcedWeb    = false;

    while (loopCount < MAX_LOOPS && !gotAnswer) {
      loopCount++;

      const prompt = toolResults.length > 0
        ? this._buildPromptWithResults(userInput, toolResults)
        : this._buildPrompt(userInput);

      renderer.agentLog("ai", "info",
        loopCount === 1 ? `Thinking with ${this.provider}…` : `Processing results (loop ${loopCount})…`);

      let raw;
      try {
        raw = await this.ai.ask(this.provider, prompt, { systemPrompt, maxTokens: 8192 });
      } catch (err) {
        renderer.errorBox("AI Error", err.message);
        this.memory.logError("ai", err.message);
        return;
      }

      const parseResult = this._parseSteps(raw);
      const steps = parseResult.steps;

      if (!steps?.length) {
        if (parseResult.error) {
          renderer.errorBox(`JSON PARSE ERROR`,
            `Failed to parse AI response: ${parseResult.error}\n\nAI Response (first 500 chars):\n${raw.slice(0, 500)}`);
          renderer.agentLog("ai", "error", `Invalid JSON: ${parseResult.error}`);
        } else {
          renderer.aiMessage(raw.slice(0, 3000), this.provider);
        }
        this.memory.addAssistantMessage(raw.slice(0, 500));
        return;
      }

      if (parseResult.warnings?.length) {
        for (const warn of parseResult.warnings) {
          renderer.agentLog("ai", "warn", warn);
        }
      }

      // Auto-web-fetch for chat
      if (isChatMode && !forcedWeb && !toolResults.length
          && WebAgent.shouldAutoFetch(userInput)) {
        if (!steps.some(s => s.action === "web_fetch")
            && steps.some(s => s.action === "message")) {
          forcedWeb = true;
          const text = await this._executeStep({ action:"web_fetch", params:{ query:userInput } });
          if (text) toolResults.push({ url:`query:${userInput}`.slice(0,140), content: String(text).slice(0,3000) });
          continue;
        }
      }

      const batches          = this._buildPlan(steps);
      const loopHasWebFetch  = steps.some(s => s.action === "web_fetch");
      const suppressMessages = isChatMode && loopHasWebFetch;
      let   hasToolCall      = false;
      let   suppressedText   = "";

      for (const batch of batches) {
        if (batch.parallel) {
          await this._executeParallel(batch.steps);
        } else {
          const step   = batch.steps[0];
          const silent = suppressMessages && step.action === "message";
          const result = await this._executeStep(step, { silent, query: userInput });

          if (step.action === "web_fetch" && result) {
            const url = step.params?.url
              || `query:${String(step.params?.query || "").slice(0,140)}`;
            toolResults.push({ url, content: String(result).slice(0,3000) });
            hasToolCall = true;
          }
          if ((step.action === "message" && !silent) || step.action === "ask_user") {
            summary += (result || "") + "\n";
            gotAnswer = true;
          }
          if (step.action === "message" && silent) suppressedText += (result || "") + "\n";
        }

        await this._checkPhaseTransitions();
      }

      if (!hasToolCall && !gotAnswer && suppressedText.trim()) {
        renderer.aiMessage(suppressedText.trim(), this.provider);
        summary += suppressedText.trim() + "\n";
        gotAnswer = true;
      }
      if (!hasToolCall && !gotAnswer) break;
    }

    if (this.mode === "fullstack" && this._filesCreated > 0) {
      renderer.agentLog("infra", "info", "Phase transition: Finalizing frontend and backend setup…");

      const hasPkg = fs.existsSync(path.join(this.workDir, "package.json"));
      if (hasPkg && !this._frontendDone) {
        renderer.agentLog("infra", "run", "🔧 Installing dependencies…");
        const installOk = await this.procMgr.runNpmInstall();
        if (installOk) {
          renderer.agentLog("infra", "ok", "✓ npm install completed");
        } else {
          renderer.agentLog("infra", "warn", "npm install had issues but continuing…");
        }
        await this._startFrontend();
      }

      if (this._frontendDone && !this._backendDone &&
          ["server.js","index.js","app.js"].some(f =>
            fs.existsSync(path.join(this.workDir, f)))) {
        await this._startBackend();
      }
    }

    if (this.mode !== "chat" && this.mode !== "fullai") {
      try { this.memory.writeReadme(); } catch {}
    }
    await this._ensureRunScript();

    if (summary.trim()) this.memory.addAssistantMessage(summary.trim());
  }

  // ── Phase transition logic ─────────────────────────────────────────────────
  async _checkPhaseTransitions(force = false) {
    if (this.mode !== "fullstack") return;

    const hasNpmModules = fs.existsSync(path.join(this.workDir, "node_modules"));

    if (!this._frontendDone && hasNpmModules) {
      const frontendReady = this._frontendEntry ||
        ["src/App.jsx","src/main.jsx","index.html"].some(f =>
          fs.existsSync(path.join(this.workDir, f)));

      if (frontendReady || force) await this._startFrontend();
    }

    if (this._frontendDone && !this._backendDone && hasNpmModules) {
      const backendReady = this._backendEntry ||
        ["server.js","index.js","app.js"].some(f =>
          fs.existsSync(path.join(this.workDir, f)));

      if (backendReady || force) await this._startBackend();
    }
  }

  async _startFrontend() {
    if (this._frontendDone) return;
    this._frontendDone = true;

    this.procMgr.frontend.port = this._frontendPort;

    let cmd = "npx", args = ["vite", "--port", String(this._frontendPort)];
    const pkg = this._readPkg();
    if (pkg?.scripts?.dev?.includes("vite")) { cmd = "npm"; args = ["run", "dev"]; }
    else if (pkg?.scripts?.start && !pkg.scripts.start.includes("node server")) {
      cmd = "npm"; args = ["start"];
    }

    await this.procMgr.frontend.start(cmd, args, {
      PORT: String(this._frontendPort)
    });

    this.logAgent.attachFrontend(this.procMgr.frontend);
    await this._statusReport("frontend", this._frontendPort);
  }

  async _startBackend() {
    if (this._backendDone) return;
    this._backendDone = true;

    this.procMgr.backend.port = this._backendPort;

    const entry = this._backendEntry
      || ["server.js","index.js","app.js"].find(f =>
           fs.existsSync(path.join(this.workDir, f)))
      || "server.js";

    await this.procMgr.backend.start("node", [entry], {
      PORT: String(this._backendPort)
    });

    this.logAgent.attachBackend(this.procMgr.backend);
    await this._statusReport("backend", this._backendPort);
  }

  async _statusReport(phase, port) {
    const logLines = this.procMgr.readLog(phase, 20);
    const projName = this.memory?.getProject?.()?.name || "project";

    renderer.agentLog("ai", "info", `Generating ${phase} status report…`);

    try {
      const raw = await this.ai.ask(
        this.provider,
        statusPrompt(phase, logLines, port, projName),
        { maxTokens: 400 }
      );

      const parseResult = this._parseSteps(raw);

      if (parseResult.error || !parseResult.steps?.length) {
        // Fallback status block
        this._printStatusBlock(phase, port);
      } else {
        for (const s of parseResult.steps) {
          if (s.action === "message") {
            const text = s.params?.text || "";
            console.log(
              `\n${C.bcyan}  ╔${"═".repeat(54)}╗${C.reset}\n` +
              `${C.bcyan}  ║  ${C.white}PHASE STATUS: ${phase.toUpperCase().padEnd(39)}${C.bcyan}║${C.reset}\n` +
              `${C.bcyan}  ╠${"═".repeat(54)}╣${C.reset}`
            );
            for (const line of text.split("\n")) {
              console.log(`${C.bcyan}  ║  ${C.reset}${line.slice(0,52).padEnd(52)}${C.bcyan}  ║${C.reset}`);
            }
            console.log(`${C.bcyan}  ╚${"═".repeat(54)}╝${C.reset}\n`);
            this.memory.addNote(`${phase} status: ${text.split("\n")[0]}`);
          }
        }
      }
    } catch (err) {
      renderer.agentLog("system", "warn", `Status report skipped: ${err.message}`);
      this._printStatusBlock(phase, port);
    }
  }

  _printStatusBlock(phase, port) {
    console.log(
      `\n${C.bcyan}  ╔${"═".repeat(54)}╗${C.reset}\n` +
      `${C.bcyan}  ║  ${C.white}PHASE STATUS: ${phase.toUpperCase().padEnd(39)}${C.bcyan}║${C.reset}\n` +
      `${C.bcyan}  ╠${"═".repeat(54)}╣${C.reset}\n` +
      `${C.bcyan}  ║  ✔ ${phase.toUpperCase()} RUNNING at http://localhost:${port}${" ".repeat(Math.max(0, 30 - String(port).length))}${C.bcyan}║${C.reset}\n` +
      `${C.bcyan}  ╚${"═".repeat(54)}╝${C.reset}\n`
    );
  }

  // ── Execution plan: parallel file batches ─────────────────────────────────
  _buildPlan(steps) {
    const batches = [];
    let   pending = [];

    const flush = () => {
      if (!pending.length) return;
      for (let i = 0; i < pending.length; i += PARALLEL_BATCH) {
        batches.push({ parallel: true, steps: pending.slice(i, i + PARALLEL_BATCH) });
      }
      pending = [];
    };

    for (const step of steps) {
      if (step.action === "create_file") pending.push(step);
      else { flush(); batches.push({ parallel: false, steps: [step] }); }
    }
    flush();
    return batches;
  }

  async _executeParallel(steps) {
    renderer.agentLog("file", "info", `Parallel: ${steps.length} file(s)…`);
    await Promise.all(steps.map(s => this._executeStep(s)));
  }

  // ── Single step ────────────────────────────────────────────────────────────
  // NOTE: Gemini often returns flat structures like { action, path, content }
  // instead of { action, params: { path, content } }.
  // All file operations support both via _pickParam() helper.
  async _executeStep(step, opts = {}) {
    const { action, params = {} } = step;

    // ── Helper: read a field from params first, then from step directly ──────
    const pick = (key, ...aliases) => {
      for (const k of [key, ...aliases]) {
        if (params[k] !== undefined) return params[k];
      }
      for (const k of [key, ...aliases]) {
        if (step[k] !== undefined) return step[k];
      }
      return undefined;
    };

    switch (action) {

      // ── message ─────────────────────────────────────────────────────────────
      case "message": {
        const text = pick("text") || "";
        if (!opts.silent) renderer.aiMessage(text, this.provider);
        return text;
      }

      // ── plan ─────────────────────────────────────────────────────────────────
      case "plan": {
        if (Array.isArray(params.steps)) renderer.planBlock(params.steps);

        if (params.frontend_port) this._frontendPort = parseInt(params.frontend_port) || 5173;
        if (params.backend_port)  this._backendPort  = parseInt(params.backend_port)  || 3001;
        if (params.frontend_entry) this._frontendEntry = params.frontend_entry;
        if (params.backend_entry)  this._backendEntry  = params.backend_entry;

        this.procMgr.frontend.port = this._frontendPort;
        this.procMgr.backend.port  = this._backendPort;

        if (Array.isArray(params.phases)) {
          for (const ph of params.phases) {
            if (ph.name === "frontend" && Array.isArray(ph.files)) this._phases.frontend = ph.files;
            if (ph.name === "backend"  && Array.isArray(ph.files)) this._phases.backend  = ph.files;
          }
        }

        if (this._phases.frontend.length || this._phases.backend.length) {
          console.log(
            `\n  ${C.byellow}FRONTEND${C.reset} (port ${this._frontendPort}): ` +
            `${C.grey}${this._phases.frontend.join(", ") || "auto-detect"}${C.reset}\n` +
            `  ${C.bgreen}BACKEND${C.reset}  (port ${this._backendPort}):  ` +
            `${C.grey}${this._phases.backend.join(", ") || "auto-detect"}${C.reset}\n`
          );
        }
        return null;
      }

      // ── search_files ─────────────────────────────────────────────────────────
      case "search_files": {
        const op      = pick("op") || "find";
        const pattern = pick("pattern", "query", "path") || "";
        let result = "";
        if (op === "grep") {
          const hits = this.fileCtx.grep(pattern);
          result = hits.length === 0
            ? `No matches: ${pattern}`
            : hits.slice(0,20).map(h => `${h.rel}:${h.lineNo}  ${h.content}`).join("\n");
        } else if (op === "read") {
          const content = this.fileCtx.readFile(pick("path") || pattern);
          result = content ? `--- ${pick("path") || pattern} ---\n${content}` : `Not found: ${pick("path") || pattern}`;
        } else {
          const files = this.fileCtx.find(pattern);
          result = files.length === 0
            ? `No files: ${pattern}`
            : files.map(f => `${f.rel}  (${f.size}B)`).join("\n");
        }
        renderer.agentLog("file", "read",
          `search(${op}: ${pattern}) → ${result.split("\n").length} result(s)`);
        return result;
      }

      // ── create_file ───────────────────────────────────────────────────────────
      case "create_file": {
        // Support both nested params and flat step structure from Gemini
        const pathValue    = pick("path", "file", "filename", "filePath");
        const contentValue = pick("content") ?? "";

        const fp = this._resolvePath(pathValue);
        if (!fp) {
          renderer.agentLog("file", "error", `Invalid path: ${pathValue}`);
          return null;
        }
        const rel = path.relative(this.workDir, fp);

        if (fs.existsSync(fp) && this.memory.isFileComplete(fp)) {
          renderer.agentLog("file", "warn", `${rel}  ${C.grey}SKIPPED (completed)${C.reset}`);
          return null;
        }

        const release = await this.mutex.acquire(fp);
        try {
          const dir = path.dirname(fp);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

          fs.writeFileSync(fp, contentValue, { encoding: "utf8", mode: 0o644 });

          if (!fs.existsSync(fp)) {
            renderer.agentLog("file", "error", `${rel}  ${C.grey}FILE WRITE FAILED${C.reset}`);
            return null;
          }

          const ext  = path.extname(fp).slice(1).toLowerCase();
          const lang = { js:"JS",jsx:"JSX",ts:"TS",tsx:"TSX",
            kt:"Kotlin",html:"HTML",css:"CSS",json:"JSON",
            sh:"Shell",md:"MD" }[ext] || ext.toUpperCase();

          renderer.agentLog("file", "create",
            `${rel}  ${C.grey}(${lang}, ${contentValue.split("\n").length}L)${C.reset}`);
          this.memory.logAction("file", "create", rel);

          if (this.memory.projectDir) {
            this.memory.registerFile(fp, `${lang} — ${path.basename(fp)}`, lang);
          }

          this.memory.markFileComplete(fp);
          this._filesCreated++;
          this.fileCtx.invalidate();

          const showExts = new Set(["js","jsx","ts","tsx","html","css","json","sh","md"]);
          if (showExts.has(ext) && contentValue.length > 0) {
            renderer.filePreview(rel, contentValue, PREVIEW_LINES);
          }
        } finally { release(); }
        return null;
      }

      // ── edit_file ─────────────────────────────────────────────────────────────
      case "edit_file": {
        const pathValue = pick("path", "file", "filename");
        const fp = this._resolvePath(pathValue);
        if (!fp) return null;

        if (!fs.existsSync(fp)) {
          return this._executeStep({
            action: "create_file",
            params: { path: pathValue, content: pick("content") || "" }
          });
        }

        const release = await this.mutex.acquire(fp);
        try {
          let content = fs.readFileSync(fp, "utf8");
          const rel   = path.relative(this.workDir, fp);
          const findV = pick("find");
          const replV = pick("replace");

          if (findV !== undefined && replV !== undefined) {
            if (content.includes(findV)) {
              content = content.replace(findV, replV);
              fs.writeFileSync(fp, content, "utf8");
              renderer.agentLog("file", "edit", `${rel}  ${C.grey}(find-replace)${C.reset}`);
            } else {
              renderer.agentLog("file", "warn", `edit_file: text not found in ${rel}`);
            }
          } else if (pick("line") !== undefined) {
            const lines = content.split(/\r?\n/);
            const ln    = parseInt(pick("line"));
            if (ln >= 1 && ln <= lines.length) {
              lines[ln - 1] = pick("content") || "";
              fs.writeFileSync(fp, lines.join("\n"), "utf8");
              renderer.agentLog("file", "edit", `${rel}  ${C.grey}line ${ln}${C.reset}`);
            }
          } else if (pick("content") !== undefined) {
            fs.writeFileSync(fp, pick("content"), "utf8");
            renderer.agentLog("file", "edit", `${rel}  ${C.grey}(full rewrite)${C.reset}`);
          }

          this.memory.logAction("file", "edit", rel);
          this.fileCtx.invalidate();
        } finally { release(); }

        const rel = path.relative(this.workDir, fp);
        const isFrontend = this._isFrontendFile(rel);
        if (isFrontend && this._frontendDone && this.procMgr.frontend.isRunning()) {
          renderer.agentLog("infra", "run", `Frontend file changed — restarting frontend…`);
          this.procMgr.frontend.restart().catch(() => {});
        } else if (!isFrontend && this._backendDone && this.procMgr.backend.isRunning()) {
          renderer.agentLog("infra", "run", `Backend file changed — restarting backend…`);
          this.procMgr.backend.restart().catch(() => {});
        }
        return null;
      }

      // ── append_file ───────────────────────────────────────────────────────────
      case "append_file": {
        const pathValue = pick("path", "file", "filename");
        const fp = this._resolvePath(pathValue);
        if (!fp) return null;
        if (!fs.existsSync(fp)) fs.writeFileSync(fp, "", "utf8");
        const release = await this.mutex.acquire(fp);
        try {
          const cur = fs.readFileSync(fp, "utf8");
          const sep = cur && !cur.endsWith("\n") ? "\n" : "";
          fs.appendFileSync(fp, sep + (pick("content") || "") + "\n", "utf8");
          renderer.agentLog("file", "edit",
            `${path.relative(this.workDir, fp)}  ${C.grey}(appended)${C.reset}`);
          this.fileCtx.invalidate();
        } finally { release(); }
        return null;
      }

      // ── delete_file ───────────────────────────────────────────────────────────
      case "delete_file": {
        const pathValue = pick("path", "file", "filename");
        const fp = this._resolvePath(pathValue);
        if (!fp || !fs.existsSync(fp)) return null;
        const release = await this.mutex.acquire(fp);
        try {
          fs.unlinkSync(fp);
          const rel = path.relative(this.workDir, fp);
          renderer.agentLog("file", "delete", rel);
          this.memory.logAction("file", "delete", rel);
          this.memory.removeFile(fp);
          this.fileCtx.invalidate();
        } finally { release(); }
        return null;
      }

      // ── read_file ─────────────────────────────────────────────────────────────
      case "read_file": {
        const pathValue = pick("path", "file", "filename");
        const fp = this._resolvePath(pathValue);
        if (!fp || !fs.existsSync(fp)) {
          renderer.agentLog("file", "warn", `read_file: ${pathValue} not found`);
          return null;
        }
        const from = pick("from_line") ? parseInt(pick("from_line")) : null;
        const to   = pick("to_line")   ? parseInt(pick("to_line"))   : null;
        let content;
        try {
          const lines = fs.readFileSync(fp, "utf8").split(/\r?\n/);
          const s = from ? Math.max(0, from - 1) : 0;
          const e = to   ? Math.min(lines.length, to) : lines.length;
          content = lines.slice(s, e).join("\n");
        } catch { return null; }
        const rel = path.relative(this.workDir, fp);
        renderer.agentLog("file", "read", rel);
        renderer.filePreview(rel, content, PREVIEW_LINES);
        return content;
      }

      // ── run_command ───────────────────────────────────────────────────────────
      case "run_command": {
        const cmd  = pick("cmd", "command");
        const args = pick("args") || [];
        if (!cmd) return null;
        if (pick("background")) { renderer.agentLog("infra","info","Server start queued"); return null; }

        const cwd = pick("cwd") ? path.resolve(this.workDir, pick("cwd")) : this.workDir;
        renderer.agentLog("system", "run", `${cmd} ${args.join(" ")}`);

        const result = await this.healer.run(
          cmd, Array.isArray(args) ? args : [args], cwd, pick("timeout_ms") || 300000);

        if (!result.success) {
          this.memory.logError(`${cmd} ${args.join(" ")}`,
            result.output?.slice(0,400) || "error");
        }

        if (cmd === "npm" && args[0] === "install" && this.mode === "fullstack") {
          await this._checkPhaseTransitions();
        }
        return null;
      }

      // ── web_fetch ─────────────────────────────────────────────────────────────
      case "web_fetch": {
        const q   = pick("query") || opts.query || "";
        const url = pick("url");
        if (!url && !q) return null;
        renderer.agentLog("web", "info",
          url ? `Fetch ${url}` : `Search: ${String(q).slice(0,80)}`);
        try {
          const out = url
            ? await WebAgent.fetchRelevant(url, q, { timeoutMs:15000, maxChars:8000 })
            : await WebAgent.searchAndRag(q, { timeoutMs:15000, maxChars:8000, maxSites:12 });
          renderer.agentLog("web", "ok", `${out.status} — ${out.text.length} chars`);
          return out.text;
        } catch (err) { renderer.agentLog("web", "error", err.message); return null; }
      }

      // ── memory_note ───────────────────────────────────────────────────────────
      case "memory_note": {
        this.memory.addNote(pick("note") || "");
        renderer.agentLog("memory", "memory", (pick("note") || "").slice(0,80));
        return null;
      }

      // ── ask_user ──────────────────────────────────────────────────────────────
      case "ask_user": {
        const question = pick("question") || "Please clarify:";
        renderer.aiMessage(question, this.provider);
        return question;
      }

      // ── deploy_app ────────────────────────────────────────────────────────────
      case "deploy_app": {
        await new InfrastructureAgent().run([
          "deploy", "--port", String(pick("port") || 3001),
          "--name", pick("appName") || "zerathapp", "--dir", pick("dir") || this.workDir,
        ]);
        return null;
      }

      // ── start_tunnel ──────────────────────────────────────────────────────────
      case "start_tunnel": {
        await new InfrastructureAgent().run(["tunnel", "--port", String(pick("port") || 3001)]);
        return null;
      }

      // ── security_scan ─────────────────────────────────────────────────────────
      case "security_scan": {
        await new SecurityAgent().run(["scan", pick("dir") || this.workDir]);
        return null;
      }

      // ── run_tests ─────────────────────────────────────────────────────────────
      case "run_tests": {
        await new QAAgent().run(["test", this.workDir]);
        return null;
      }

      // ── notify ────────────────────────────────────────────────────────────────
      case "notify": {
        await new AssistantAgent().run(["notify", pick("title") || "ZerathCode", pick("content") || ""]);
        return null;
      }

      // ── set_run_commands ──────────────────────────────────────────────────────
      case "set_run_commands": {
        const cmds = pick("commands");
        if (cmds) {
          this.memory.setRunCommands(Array.isArray(cmds) ? cmds : [cmds]);
        }
        return null;
      }

      default:
        renderer.agentLog("system", "warn", `Unknown step: "${action}"`);
        return null;
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  _isFrontendFile(rel) {
    const FRONTEND_PATTERNS = [
      /^src\//i, /^public\//i, /^index\.html$/, /^vite\.config\./,
      /\.jsx$/, /\.tsx$/, /\.css$/, /\.scss$/,
    ];
    return FRONTEND_PATTERNS.some(p => p.test(rel));
  }

  _readPkg() {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.workDir, "package.json"), "utf8"));
    } catch { return null; }
  }

  _buildSystemPrompt(userQuery = "") {
    const base     = SYSTEM_PROMPTS[this.mode] || SYSTEM_PROMPTS.chat;
    const memCtx   = this.memory.buildContextBlock();
    // Fix: use maxBytes (valid option) instead of tokenBudget/topK which don't exist
    const ragCtx   = (this.mode === "fullstack" || this.mode === "mobiledev")
      ? this.fileCtx.build(userQuery, { maxBytes: 4000 })
      : "";
    const completed = this.memory.getCompletedFiles();
    const completedNote = completed.length
      ? `\n\nCOMPLETED FILES (edit_file only):\n${completed.map(f => `  ✓ ${f}`).join("\n")}`
      : "";
    return [base, "\n\n" + memCtx, ragCtx ? "\n\n" + ragCtx : "", completedNote,
      "\n\nFINAL REMINDER: Respond with a valid JSON array only. [ ... ]",
      "\nAlways use { \"action\": \"create_file\", \"params\": { \"path\": \"...\", \"content\": \"...\" } }",
    ].join("");
  }

  _buildPrompt(userInput) {
    const h = this.memory.getHistory(8);
    if (h.length <= 1) return userInput;
    return h.slice(0,-1).map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n")
      + `\n\nUser: ${userInput}`;
  }

  _buildPromptWithResults(userInput, toolResults) {
    const h = this.memory.getHistory(6);
    const ht = h.length > 1
      ? h.slice(0,-1).map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n") + "\n\n"
      : "";
    const block = toolResults.map((r,i) => `[RESULT ${i+1}] ${r.url}\n${r.content}`).join("\n\n---\n\n");
    return `${ht}User: ${userInput}\n\n[WEB RESULTS]\n${block}\n[END]\n\nAnswer directly. JSON array with message action.`;
  }

  _parseSteps(raw) {
    if (!raw || typeof raw !== "string") {
      return { steps: null, error: "AI response was empty or not a string", warnings: [] };
    }

    let str = raw.trim();

    // Strip markdown fences
    const fence = str.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) str = fence[1].trim();

    // Find JSON array
    const s = str.indexOf("["), e = str.lastIndexOf("]");
    if (s === -1 || e === -1 || e <= s) {
      return {
        steps: null,
        error: "No JSON array found in response",
        warnings: [`Raw response start: "${raw.slice(0, 100)}..."`]
      };
    }

    let jsonStr = str.slice(s, e + 1);

    // Attempt 1: direct parse
    try {
      const p = JSON.parse(jsonStr);
      return this._validateAndReturnSteps(p);
    } catch (_) {}

    // Attempt 2: escape literal newlines inside JSON strings
    try {
      const fixed = this._escapeNewlinesInJson(jsonStr);
      const p = JSON.parse(fixed);
      return this._validateAndReturnSteps(p);
    } catch (_) {}

    // Attempt 3: aggressive cleanup
    try {
      const fixed = this._aggressiveJsonCleanup(jsonStr);
      const p = JSON.parse(fixed);
      return this._validateAndReturnSteps(p);
    } catch (err) {
      return {
        steps: null,
        error: `JSON parse failed after 3 attempts: ${err.message}`,
        warnings: []
      };
    }
  }

  _validateAndReturnSteps(obj) {
    if (!Array.isArray(obj)) {
      return { steps: null, error: `Expected JSON array, got ${typeof obj}`, warnings: [] };
    }
    const validSteps = obj.filter(x => x && typeof x.action === "string");
    const invalidCount = obj.length - validSteps.length;
    const warnings = invalidCount > 0
      ? [`Filtered ${invalidCount} invalid step(s)`]
      : [];
    return { steps: validSteps, error: null, warnings };
  }

  _escapeNewlinesInJson(jsonStr) {
    // Match JSON strings and escape any literal newlines inside them
    return jsonStr.replace(/"(?:[^"\\]|\\.)*"/g, match =>
      match.replace(/\r\n/g, "\\n").replace(/\r/g, "\\n").replace(/\n/g, "\\n")
    );
  }

  _aggressiveJsonCleanup(jsonStr) {
    return jsonStr
      .replace(/,(\s*[}\]])/g, "$1")
      .replace(/[""]/g, '"')
      .replace(/['']/g, "'");
  }

  _resolvePath(rawPath) {
    if (!rawPath || typeof rawPath !== "string") return null;
    try {
      const abs = rawPath.startsWith("/") ? rawPath : path.resolve(this.workDir, rawPath);
      if (!abs.startsWith(this.workDir)) {
        renderer.agentLog("file", "warn", `Path "${rawPath}" escapes project`);
        return null;
      }
      return abs;
    } catch { return null; }
  }
}

module.exports = Orchestrator;