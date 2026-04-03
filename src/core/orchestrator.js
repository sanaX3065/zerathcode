/**
 * src/core/orchestrator.js
 * ZerathCode v4 — Full Stack Orchestrator
 *
 * Key changes from v3:
 *
 *  PHASE-AWARE EXECUTION
 *    The AI's plan step now includes a "phase" field:
 *      "phase": "frontend" | "backend" | "both"
 *    Execution flow:
 *      1. All frontend files created (parallel batches)
 *      2. npm install
 *      3. Frontend subprocess STARTED → logs to frontend.log
 *      4. AI STATUS REPORT: "Frontend ready at :5173. Starting backend…"
 *      5. All backend files created
 *      6. Backend subprocess STARTED → logs to backend.log
 *      7. AI STATUS REPORT: "Backend ready at :3001. Full stack running."
 *
 *  FILE MUTEX
 *    Same promise-chain FileMutex as v3.
 *    Shared with LogAgent — both agents serialize writes per file.
 *
 *  DUAL PROCESS MANAGER
 *    DualProcessManager owns frontend (port 5173) and backend (port 3001).
 *    Both have independent port-clearing restart (fuser/proc/lsof chain).
 *    LogAgent is attached after each subprocess starts.
 *
 *  RAG CONTEXT
 *    FileContextBuilder BM25 — same as v3.
 *    Index invalidated on every write.
 *
 *  STATUS REPORTS
 *    After each phase completes, the Orchestrator asks the AI:
 *    "The {phase} is running. Read the last 20 lines of {phase}.log
 *     and confirm what was built and that it's working."
 *    The AI's response is printed as a cyan status block.
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
// FILE MUTEX (same zero-dep implementation as v3)
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
- NO literal newlines inside JSON strings
- Escape all newlines as \\n in string values
- Use straight double quotes, not fancy quotes  
- Every string property must use \\n for line breaks, never actual newlines

JSON Rules - Valid: { "text": "Line 1\\nLine 2" }
JSON Rules - Invalid: { "text": "Line 1 [newline] Line 2" }

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
  This means the user sees the UI immediately.

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
  ask_user, deploy_app, start_tunnel, security_scan`,

  mobiledev: `You are ZerathCode Mobile Dev Agent.

⚠️  OUTPUT ONLY VALID JSON ARRAY. NO MARKDOWN, NO BACKTICKS. ⚠️️
- Start with [ and end with ]
- NO literal newlines in strings (use \\n instead)
- NO fancy quotes (use only "straight quotes")

Check [PROJECT FILES] first. Use search_files before editing.
AVAILABLE ACTIONS: plan, message, create_file, edit_file, search_files, read_file,
  run_command, memory_note, ask_user, security_scan`,

  infra: `You are ZerathCode Infrastructure Agent.

⚠️  OUTPUT ONLY VALID JSON ARRAY. NO MARKDOWN, NO BACKTICKS. ⚠️️
- Start with [ and end with ]
- NO literal newlines in strings (use \\n instead)
- NO fancy quotes (use only "straight quotes")

AVAILABLE ACTIONS: plan, message, create_file, run_command, deploy_app, start_tunnel, memory_note`,

  fullai: `[{ "action": "message", "params": { "text": "Full AI Mode ready." } }]`,
};

// ═════════════════════════════════════════════════════════════════════════════
// STATUS REPORT PROMPT
// Asked to AI after each phase completes
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
  { "action": "message", "params": { "text": "✅ ${phase.toUpperCase()} READY\\n\\nWhat was built:\\n- [list key files/features]\\n\\nRunning at: http://localhost:${port}\\n\\nStatus: [HEALTHY / HAS WARNINGS / describe any issues]\\n\\nNext: [what happens next, e.g. building backend]" } }
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

    // Mandate 1: shared mutex
    this.mutex = new FileMutex();

    // Mandate 3: RAG context
    this.fileCtx = new FileContextBuilder(this.workDir);

    // Mandate 2: dual process manager + log agent
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

    // Wire LogAgent events
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
    this._phases       = { frontend: [], backend: [] };  // files per phase
    this._currentPhase = null;   // "frontend" | "backend" | null
    this._frontendDone = false;
    this._backendDone  = false;

    // Detected ports from plan step
    this._frontendPort = 5173;
    this._backendPort  = 3001;
    this._frontendEntry = null;
    this._backendEntry  = null;
  }

  // ── Shutdown ───────────────────────────────────────────────────────────────
  async shutdown() {
    await this.procMgr.stopAll();
  }

  // Create run.sh script by asking AI
  async _ensureRunScript() {
    const runSh = path.join(this.workDir, "run.sh");
    
    // If run.sh already exists, use it
    if (fs.existsSync(runSh)) {
      renderer.agentLog("infra", "ok", `✓ run.sh found — ready to execute`);
      return;
    }

    renderer.agentLog("infra", "info", "Generating run.sh script…");

    try {
      // Ask AI to generate the run script
      const prompt = `You are the ZerathCode Shell Script Generator.

The project at ${this.workDir} has been set up with:
- Frontend: ${this._phases.frontend.length > 0 ? "Yes" : "No"}
- Backend: ${this._phases.backend.length > 0 ? "Yes" : "No"}
- Frontend port: ${this._frontendPort}
- Backend port: ${this._backendPort}

Generate ONLY a bash shell script (nothing else) that starts the project:
- For fullstack: start both frontend and backend as background processes
- For frontend-only: start frontend dev server
- For backend-only: start backend server
- Include error handling and logging to frontend.log and backend.log

The script should be production-ready for Termux/Android.

Start with: #!/bin/bash

DO NOT include any markdown, backticks, or explanation. Just the raw bash script.`;

      const raw = await this.ai.ask(this.provider, prompt, { maxTokens: 800 });
      
      // Extract just the bash script (remove markdown if present)
      let scriptContent = raw.trim();
      const fence = scriptContent.match(/```(?:bash)?\s*([\s\S]*?)```/);
      if (fence) {
        scriptContent = fence[1].trim();
      }
      
      // Ensure it starts with shebang
      if (!scriptContent.startsWith("#!")) {
        scriptContent = "#!/bin/bash\n" + scriptContent;
      }

      // Save script
      fs.writeFileSync(runSh, scriptContent + "\n", { encoding: "utf8", mode: 0o755 });
      
      renderer.agentLog("infra", "create", `✓ run.sh created (${scriptContent.split("\n").length} lines)`);
      this.memory.logAction("file", "create", "run.sh");
      
      // Show first few lines
      const preview = scriptContent.split("\n").slice(0, 3).join("\n");
      console.log(`\n  ${C.bgreen}run.sh${C.reset}\n  ${C.grey}${preview}...\n`);
      
    } catch (err) {
      renderer.agentLog("infra", "warn", `Could not generate run.sh: ${err.message}`);
      
      // Fallback: create basic script
      const fallback = [
        "#!/bin/bash",
        'cd "$(dirname "$0")"',
        "echo '🚀 Starting ZerathCode project...'",
        this._phases.backend.length > 0 ? "npm start 2>&1 | tee project.log &" : "npm run dev 2>&1 | tee project.log",
        "echo '✓ Project started'",
      ].join("\n") + "\n";
      
      fs.writeFileSync(runSh, fallback, { encoding: "utf8", mode: 0o755 });
      renderer.agentLog("infra", "ok", `✓ Fallback run.sh created`);
    }
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

      // Parse and validate AI response
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

      // Execute plan with phase awareness
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

        // After each batch, check if a phase just completed
        await this._checkPhaseTransitions();
      }

      if (!hasToolCall && !gotAnswer && suppressedText.trim()) {
        renderer.aiMessage(suppressedText.trim(), this.provider);
        summary += suppressedText.trim() + "\n";
        gotAnswer = true;
      }
      if (!hasToolCall && !gotAnswer) break;
    }

    // Phase transitions after files created (fullstack mode)
    if (this.mode === "fullstack" && this._filesCreated > 0) {
      renderer.agentLog("infra", "info", "Phase transition: Finalizing frontend and backend setup…");
      
      // Try to install dependencies and start frontend
      const hasPkg = fs.existsSync(path.join(this.workDir, "package.json"));
      if (hasPkg && !this._frontendDone) {
        renderer.agentLog("infra", "run", "🔧 Installing dependencies…");
        const installOk = await this.procMgr.runNpmInstall();
        if (installOk) {
          renderer.agentLog("infra", "ok", "✓ npm install completed");
        } else {
          renderer.agentLog("infra", "warn", "npm install had issues but continuing…");
        }
        
        // Start frontend after deps installed
        await this._startFrontend();
      }
      
      // Then start backend if frontend completed
      if (this._frontendDone && !this._backendDone &&
          fs.existsSync(path.join(this.workDir, "server.js"))) {
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

    // Try to start frontend
    if (!this._frontendDone && hasNpmModules) {
      const frontendReady = this._frontendEntry ||
        ["src/App.jsx","src/main.jsx","index.html"].some(f =>
          fs.existsSync(path.join(this.workDir, f)));

      if (frontendReady || force) {
        await this._startFrontend();
      }
    }

    // Try to start backend (only after frontend)
    if (this._frontendDone && !this._backendDone && hasNpmModules) {
      const backendReady = this._backendEntry ||
        ["server.js","index.js","app.js"].some(f =>
          fs.existsSync(path.join(this.workDir, f)));

      if (backendReady || force) {
        await this._startBackend();
      }
    }
  }

  async _startFrontend() {
    if (this._frontendDone) return;
    this._frontendDone = true;

    this.procMgr.frontend.port = this._frontendPort;

    // Detect start command
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

    // AI status report
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

    // AI status report
    await this._statusReport("backend", this._backendPort);
  }

  // ── AI confirmation after each phase ───────────────────────────────────────
  async _confirmPhaseCompletion(phase, action) {
    renderer.agentLog("ai", "info", `Confirming ${phase} completion…`);
    
    try {
      const prompt = `You are the ZerathCode confirmation agent.

The developer has just ${action}.

Respond with ONLY this exact JSON array format:
[
  { "action": "message", "params": { "text": "✅ ${phase.toUpperCase()} SETUP COMPLETE\\n\\nWhat was changed:\\n- [list the files and changes made]\\n\\nFiles created: [list file names]\\n\\nNext: [what happens next]" } }
]`;

      const raw = await this.ai.ask(this.provider, prompt, { maxTokens: 300 });
      const parseResult = this._parseSteps(raw);
      
      if (parseResult.steps?.length) {
        for (const s of parseResult.steps) {
          if (s.action === "message") {
            renderer.aiMessage(s.params?.text || "", this.provider);
          }
        }
      }
    } catch (err) {
      renderer.agentLog("system", "warn", `Phase confirmation skipped: ${err.message}`);
    }
  }

  // ── AI status report after phase start ────────────────────────────────────
  async _statusReport(phase, port) {
    const logLines = this.procMgr.readLog(phase, 20);
    const projName = this.memory?.getProject?.()?.name || "project";

    renderer.agentLog("ai", "info",
      `Generating ${phase} status report…`);

    try {
      const raw = await this.ai.ask(
        this.provider,
        statusPrompt(phase, logLines, port, projName),
        { maxTokens: 400 }
      );

      const parseResult = this._parseSteps(raw);
      
      if (parseResult.error) {
        renderer.agentLog("ai", "warn", `Status report JSON error: ${parseResult.error}`);
        // Still print basic info
        console.log(
          `\n${C.bcyan}  ╔${"═".repeat(54)}╗${C.reset}\n` +
          `${C.bcyan}  ║  ${C.white}PHASE STATUS: ${phase.toUpperCase().padEnd(39)}${C.bcyan}║${C.reset}\n` +
          `${C.bcyan}  ╠${"═".repeat(54)}╣${C.reset}\n` +
          `${C.bcyan}  ║  ✔ ${phase.toUpperCase()} RUNNING at http://localhost:${port}${C.reset}\n` +
          `${C.bcyan}  ║  Logs: ${path.basename(phase)}.log${C.reset}\n` +
          `${C.bcyan}  ╚${"═".repeat(54)}╝${C.reset}\n`
        );
      } else if (parseResult.steps?.length) {
        for (const s of parseResult.steps) {
          if (s.action === "message") {
            // Print as a distinct status block
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
      renderer.agentLog("system", "warn",
        `Status report skipped: ${err.message}`);
      // Still print basic info
      console.log(
        `\n${C.bcyan}  ╔${"═".repeat(54)}╗${C.reset}\n` +
        `${C.bcyan}  ║  ${C.white}PHASE STATUS: ${phase.toUpperCase().padEnd(39)}${C.bcyan}║${C.reset}\n` +
        `${C.bcyan}  ╠${"═".repeat(54)}╣${C.reset}\n` +
        `${C.bcyan}  ║  ✔ ${phase.toUpperCase()} RUNNING at http://localhost:${port}${C.reset}\n` +
        `${C.bcyan}  ║  Check logs: ${phase}.log${C.reset}\n` +
        `${C.bcyan}  ╚${"═".repeat(54)}╝${C.reset}\n`
      );
    }
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
  async _executeStep(step, opts = {}) {
    const { action, params = {} } = step;

    switch (action) {

      case "message": {
        if (!opts.silent) renderer.aiMessage(params.text || "", this.provider);
        return params.text;
      }

      case "plan": {
        if (Array.isArray(params.steps)) renderer.planBlock(params.steps);

        // Extract phase metadata from plan
        if (params.frontend_port) this._frontendPort = parseInt(params.frontend_port) || 5173;
        if (params.backend_port)  this._backendPort  = parseInt(params.backend_port)  || 3001;
        if (params.frontend_entry) this._frontendEntry = params.frontend_entry;
        if (params.backend_entry)  this._backendEntry  = params.backend_entry;

        // Update process manager ports
        this.procMgr.frontend.port = this._frontendPort;
        this.procMgr.backend.port  = this._backendPort;

        // Register which files belong to which phase
        if (Array.isArray(params.phases)) {
          for (const ph of params.phases) {
            if (ph.name === "frontend" && Array.isArray(ph.files)) {
              this._phases.frontend = ph.files;
            }
            if (ph.name === "backend" && Array.isArray(ph.files)) {
              this._phases.backend = ph.files;
            }
          }
        }

        // Print phase summary
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

      case "search_files": {
        const op = params.op || "find";
        const pattern = params.pattern || params.query || params.path || "";
        let result = "";
        if (op === "grep") {
          const hits = this.fileCtx.grep(pattern);
          result = hits.length === 0
            ? `No matches: ${pattern}`
            : hits.slice(0,20).map(h => `${h.rel}:${h.lineNo}  ${h.content}`).join("\n");
        } else if (op === "read") {
          const content = this.fileCtx.readFile(params.path || pattern);
          result = content ? `--- ${params.path || pattern} ---\n${content}` : `Not found: ${params.path || pattern}`;
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

      case "create_file": {
        const fp = this._resolvePath(params.path);
        if (!fp) return null;
        const rel = path.relative(this.workDir, fp);

        if (fs.existsSync(fp) && this.memory.isFileComplete(fp)) {
          renderer.agentLog("file", "warn", `${rel}  ${C.grey}SKIPPED (completed)${C.reset}`);
          return null;
        }

        const release = await this.mutex.acquire(fp);
        try {
          const dir = path.dirname(fp);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const content = params.content || "";
          fs.writeFileSync(fp, content, { encoding: "utf8", mode: 0o644 });

          const ext  = path.extname(fp).slice(1).toLowerCase();
          const lang = { js:"JS",jsx:"JSX",ts:"TS",tsx:"TSX",
            kt:"Kotlin",html:"HTML",css:"CSS",json:"JSON",
            sh:"Shell",md:"MD" }[ext] || ext.toUpperCase();

          renderer.agentLog("file", "create",
            `${rel}  ${C.grey}(${lang}, ${content.split("\n").length}L)${C.reset}`);
          this.memory.logAction("file", "create", rel);
          this.memory.registerFile(fp, `${lang} — ${path.basename(fp)}`, lang);
          this.memory.markFileComplete(fp);
          this._filesCreated++;
          this.fileCtx.invalidate();

          const showExts = new Set(["js","jsx","ts","tsx","html","css","json","sh","md"]);
          if (showExts.has(ext) && content.length > 0) {
            renderer.filePreview(rel, content, PREVIEW_LINES);
          }
        } finally { release(); }
        return null;
      }

      case "edit_file": {
        const fp = this._resolvePath(params.path);
        if (!fp) return null;

        if (!fs.existsSync(fp)) {
          return this._executeStep({ action:"create_file", params: { path: params.path, content: params.content || "" } });
        }

        const release = await this.mutex.acquire(fp);
        try {
          let content = fs.readFileSync(fp, "utf8");
          const rel   = path.relative(this.workDir, fp);

          if (params.find !== undefined && params.replace !== undefined) {
            if (content.includes(params.find)) {
              content = content.replace(params.find, params.replace);
              fs.writeFileSync(fp, content, "utf8");
              renderer.agentLog("file", "edit", `${rel}  ${C.grey}(find-replace)${C.reset}`);
            } else {
              renderer.agentLog("file", "warn", `edit_file: text not found in ${rel}`);
            }
          } else if (params.line) {
            const lines = content.split(/\r?\n/);
            const ln    = parseInt(params.line);
            if (ln >= 1 && ln <= lines.length) {
              lines[ln - 1] = params.content || "";
              fs.writeFileSync(fp, lines.join("\n"), "utf8");
              renderer.agentLog("file", "edit", `${rel}  ${C.grey}line ${ln}${C.reset}`);
            }
          } else if (params.content !== undefined) {
            fs.writeFileSync(fp, params.content, "utf8");
            renderer.agentLog("file", "edit", `${rel}  ${C.grey}(full rewrite)${C.reset}`);
          }

          this.memory.logAction("file", "edit", rel);
          this.fileCtx.invalidate();
        } finally { release(); }

        // Restart the appropriate subprocess
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

      case "append_file": {
        const fp = this._resolvePath(params.path);
        if (!fp) return null;
        if (!fs.existsSync(fp)) fs.writeFileSync(fp, "", "utf8");
        const release = await this.mutex.acquire(fp);
        try {
          const cur = fs.readFileSync(fp, "utf8");
          const sep = cur && !cur.endsWith("\n") ? "\n" : "";
          fs.appendFileSync(fp, sep + (params.content || "") + "\n", "utf8");
          renderer.agentLog("file", "edit",
            `${path.relative(this.workDir, fp)}  ${C.grey}(appended)${C.reset}`);
          this.fileCtx.invalidate();
        } finally { release(); }
        return null;
      }

      case "delete_file": {
        const fp = this._resolvePath(params.path);
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

      case "read_file": {
        const fp = this._resolvePath(params.path);
        if (!fp || !fs.existsSync(fp)) {
          renderer.agentLog("file", "warn", `read_file: ${params.path} not found`);
          return null;
        }
        const from = params.from_line ? parseInt(params.from_line) : null;
        const to   = params.to_line   ? parseInt(params.to_line)   : null;
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

      case "run_command": {
        if (!params.cmd) return null;
        if (params.background) { renderer.agentLog("infra","info","Server start queued"); return null; }

        const cwd  = params.cwd ? path.resolve(this.workDir, params.cwd) : this.workDir;
        const args = Array.isArray(params.args) ? params.args : [];

        renderer.agentLog("system", "run", `${params.cmd} ${args.join(" ")}`);

        const result = await this.healer.run(
          params.cmd, args, cwd, params.timeout_ms || 300000);

        if (!result.success) {
          this.memory.logError(`${params.cmd} ${args.join(" ")}`,
            result.output?.slice(0,400) || "error");
        }

        // After npm install: attempt phase transitions
        if (params.cmd === "npm" && args[0] === "install" && this.mode === "fullstack") {
          await this._checkPhaseTransitions();
        }
        return null;
      }

      case "web_fetch": {
        const q = params.query || opts.query || "";
        if (!params.url && !q) return null;
        renderer.agentLog("web", "info",
          params.url ? `Fetch ${params.url}` : `Search: ${String(q).slice(0,80)}`);
        try {
          const out = params.url
            ? await WebAgent.fetchRelevant(params.url, q, { timeoutMs:15000, maxChars:8000 })
            : await WebAgent.searchAndRag(q, { timeoutMs:15000, maxChars:8000, maxSites:12 });
          renderer.agentLog("web", "ok", `${out.status} — ${out.text.length} chars`);
          return out.text;
        } catch (err) { renderer.agentLog("web", "error", err.message); return null; }
      }

      case "memory_note": {
        this.memory.addNote(params.note || "");
        renderer.agentLog("memory", "memory", (params.note || "").slice(0,80));
        return null;
      }

      case "ask_user": {
        renderer.aiMessage(params.question || "Please clarify:", this.provider);
        return params.question;
      }

      case "deploy_app": {
        await new InfrastructureAgent().run([
          "deploy", "--port", String(params.port || 3001),
          "--name", params.appName || "zerathapp", "--dir", params.dir || this.workDir,
        ]);
        return null;
      }

      case "start_tunnel": {
        await new InfrastructureAgent().run(["tunnel", "--port", String(params.port || 3001)]);
        return null;
      }

      case "security_scan": {
        await new SecurityAgent().run(["scan", params.dir || this.workDir]);
        return null;
      }

      case "run_tests": {
        await new QAAgent().run(["test", this.workDir]);
        return null;
      }

      case "notify": {
        await new AssistantAgent().run(["notify", params.title || "ZerathCode", params.content || ""]);
        return null;
      }

      case "set_run_commands": {
        if (params.commands) {
          this.memory.setRunCommands(
            Array.isArray(params.commands) ? params.commands : [params.commands]);
        }
        return null;
      }

      default:
        renderer.agentLog("system", "warn", `Unknown step: "${action}"`);
        return null;
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Detect if a relative file path belongs to the frontend phase */
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
    const ragCtx   = (this.mode === "fullstack" || this.mode === "mobiledev")
      ? this.fileCtx.build(userQuery, { tokenBudget: 1500, topK: 6 })
      : "";
    const completed = this.memory.getCompletedFiles();
    const completedNote = completed.length
      ? `\n\nCOMPLETED FILES (edit_file only):\n${completed.map(f => `  ✓ ${f}`).join("\n")}`
      : "";
    return [base, "\n\n" + memCtx, ragCtx ? "\n\n" + ragCtx : "", completedNote,
      "\n\nFINAL REMINDER: Respond with a valid JSON array only. [ ... ]"].join("");
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
    
    // Try to extract JSON from markdown code fence
    const fence = str.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) {
      str = fence[1].trim();
    }
    
    // Find JSON array boundaries
    const s = str.indexOf("["), e = str.lastIndexOf("]");
    if (s === -1 || e === -1 || e <= s) {
      return { 
        steps: null, 
        error: "No JSON array found in response", 
        warnings: [`Raw response start: "${raw.slice(0, 100)}..."`]
      };
    }
    
    let jsonStr = str.slice(s, e + 1);
    
    try {
      // Try direct parse first
      const p = JSON.parse(jsonStr);
      return this._validateAndReturnSteps(p);
    } catch (err) {
      // If direct parse fails, try to fix common issues
      renderer.agentLog("ai", "warn", `JSON parse attempt 1 failed, trying cleanup…`);
      
      try {
        // Fix 1: Escape unescaped newlines in string values
        jsonStr = this._escapeNewlinesInJson(jsonStr);
        const p = JSON.parse(jsonStr);
        return this._validateAndReturnSteps(p);
      } catch (err2) {
        renderer.agentLog("ai", "warn", `JSON parse attempt 2 failed, trying aggressive cleanup…`);
        
        try {
          // Fix 2: More aggressive cleanup - remove trailing commas, fix quotes
          jsonStr = this._aggressiveJsonCleanup(jsonStr);
          const p = JSON.parse(jsonStr);
          return this._validateAndReturnSteps(p);
        } catch (err3) {
          return {
            steps: null,
            error: `JSON parse failed: ${err.message}. Attempted 3 fixes, all failed.`,
            warnings: [
              `Position ${s}-${e}`,
              `Original error: ${err.message}`,
              `After newline escape: ${err2.message}`,
              `After aggressive cleanup: ${err3.message}`
            ]
          };
        }
      }
    }
  }

  _validateAndReturnSteps(obj) {
    if (!Array.isArray(obj)) {
      return {
        steps: null,
        error: `Expected JSON array, got ${typeof obj}`,
        warnings: []
      };
    }
    
    const validSteps = obj.filter(x => x && typeof x.action === "string");
    const invalidCount = obj.length - validSteps.length;
    const warnings = invalidCount > 0 
      ? [`Filtered ${invalidCount} invalid step(s) from response`]
      : [];
    
    return { steps: validSteps, error: null, warnings };
  }

  _escapeNewlinesInJson(jsonStr) {
    // This is conservative: only escape newlines that appear inside quoted strings
    // Split by quotes, escape newlines only in non-quoted sections
    let result = "";
    let inString = false;
    let escape = false;
    let i = 0;
    
    while (i < jsonStr.length) {
      const char = jsonStr[i];
      const nextChar = jsonStr[i + 1];
      
      // Handle escape sequences
      if (escape) {
        result += char;
        escape = false;
        i++;
        continue;
      }
      
      if (char === "\\") {
        escape = true;
        result += char;
        i++;
        continue;
      }
      
      // Track if we're inside a string
      if (char === '"') {
        inString = !inString;
        result += char;
        i++;
        continue;
      }
      
      // If inside a string and we hit a literal newline, escape it
      if (inString && (char === "\n" || char === "\r")) {
        if (char === "\r" && nextChar === "\n") {
          result += "\\n";
          i += 2;
        } else {
          result += "\\n";
          i++;
        }
        continue;
      }
      
      result += char;
      i++;
    }
    
    return result;
  }

  _aggressiveJsonCleanup(jsonStr) {
    // Remove trailing commas before ] or }
    let result = jsonStr
      .replace(/,(\s*[}\]])/g, "$1")    // trailing commas
      .replace(/([}\]])\s*,\s*([}\]])/g, "$1$2");  // commas between closing braces
    
    // Fix common quote issues: replace fancy quotes with straight quotes
    result = result
      .replace(/[""]/g, '"')  // curly quotes to straight
      .replace(/['']/g, "'");  // fancy apostrophes to straight
    
    return result;
  }

  _resolvePath(rawPath) {
    if (!rawPath) return null;
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
