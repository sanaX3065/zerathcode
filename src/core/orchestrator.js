/**
 * src/core/orchestrator.js
 * ZerathCode v2.0 — Enhanced Orchestrator
 * Author: sanaX3065
 *
 * Key upgrades over v1:
 *
 *  1. FILE CONTEXT INJECTION
 *     Before every AI call, the existing project files are scanned
 *     and injected into the system prompt. The AI always knows what
 *     already exists and can modify rather than recreate.
 *
 *  2. PARALLEL FILE CREATION
 *     Independent file steps are batched and written concurrently
 *     using Promise.all. Batch size: 4. This makes large scaffold
 *     operations 3-4x faster.
 *
 *  3. RUN-FIRST APPROACH
 *     As soon as package.json + a server entry point exist, the dev
 *     server is started immediately — even if other files are still
 *     being created. The user sees output ASAP, just like Replit.
 *
 *  4. LOG AGENT
 *     LogAgent watches the running server's stdout/stderr. Any runtime
 *     error triggers an independent AI fix+restart cycle. This never
 *     blocks the REPL and never fails silently.
 *
 *  5. SEARCH STEP
 *     New step type `search_files` lets the AI ask to find/grep files
 *     and get the results back before writing code.
 */

"use strict";

const fs               = require("fs");
const path             = require("path");
const { spawn }        = require("child_process");

const AiClient         = require("../utils/aiClient");
const SandboxManager   = require("./sandboxManager");
const SelfHealingAgent = require("./selfHealingAgent");
const LogAgent         = require("./logAgent");
const FileContextBuilder = require("./fileContextBuilder");
const renderer         = require("../ui/renderer");
const { C }            = require("../ui/renderer");

const InfrastructureAgent = require("../agents/infrastructureAgent");
const SecurityAgent       = require("../agents/securityAgent");
const QAAgent             = require("../agents/qaAgent");
const AssistantAgent      = require("../agents/assistantAgent");
const WebAgent            = require("../agents/webAgent");

const PREVIEW_LINES = 20;
const PARALLEL_BATCH = 4;  // files to create concurrently per batch

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPTS
// ─────────────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPTS = {

  chat: `You are ZerathCode Chat Agent — a knowledgeable assistant running in Termux on Android.

TOOL USE RULES:
- For real-time data, recent events, version-specific questions → use web_fetch FIRST
- After web_fetch results injected as [WEB RESULTS], answer directly

RESPONSE FORMAT — valid JSON arrays only:
[
  { "action": "message", "params": { "text": "answer here" } }
]
Or to search first:
[
  { "action": "web_fetch", "params": { "query": "search query" } }
]

GROUNDING: All claims must be based on retrieved context or training knowledge.
Report confidence: (high/medium/low confidence)

AVAILABLE ACTIONS: message, create_file, read_file, search_files, web_fetch`,

  fullstack: `You are ZerathCode Full Stack Agent — an autonomous web app builder for Termux/Android.

CRITICAL RULES:
1. Output ONLY a valid JSON array — nothing before or after [].
2. FIRST step is always "plan" listing everything you will do.
3. Every file must have 100% complete code — no placeholders, no TODOs.
4. Tech stack (Termux constraints):
   - Frontend: vanilla HTML5 + CSS3 + vanilla JS only
   - Backend: Node.js with express OR built-in http
   - React/Vue: ONLY via CDN <script> tags in HTML — NEVER via npm
   - Start command: ALWAYS "node server.js" — never vite/webpack/parcel
5. EXISTING FILES: The [PROJECT FILES] section shows what already exists.
   - If a file exists → EDIT it with edit_file (find+replace), don't recreate
   - If building on existing project → read the files first, understand the structure
6. After files are ready → run npm install → the server auto-starts immediately
7. Use "search_files" step if you need to find or read existing code before writing
8. All paths are relative to the project directory

PARALLEL CREATION: You can list many create_file steps back to back — they run in parallel.
The server starts as soon as server.js + package.json exist, even while other files are created.

REQUIRED PLAN STRUCTURE (every response):
[
  {
    "action": "plan",
    "params": {
      "steps": ["What file 1 does", "What file 2 does", "..."],
      "entry_point": "server.js",
      "port": 3000
    }
  },
  { "action": "search_files", "params": { "pattern": "server.js" } },
  { "action": "create_file", "params": { "path": "package.json", "content": "..." } },
  { "action": "create_file", "params": { "path": "server.js", "content": "..." } },
  { "action": "create_file", "params": { "path": "public/index.html", "content": "..." } },
  { "action": "create_file", "params": { "path": "public/style.css", "content": "..." } },
  { "action": "create_file", "params": { "path": "public/app.js", "content": "..." } },
  { "action": "create_file", "params": { "path": ".gitignore", "content": "node_modules/\n.env\n" } },
  { "action": "run_command", "params": { "cmd": "npm", "args": ["install"], "cwd": "." } },
  { "action": "memory_note", "params": { "note": "Built express app with vanilla JS frontend" } }
]

AVAILABLE ACTIONS: plan, message, create_file, edit_file, append_file, delete_file,
  read_file, search_files, run_command, web_fetch, memory_note, ask_user,
  deploy_app, security_scan`,

  mobiledev: `You are ZerathCode Mobile Dev Agent — an autonomous Android app builder for Termux.

ABSOLUTE RULES:
1. Output ONLY a valid JSON array.
2. Every response starts with "plan".
3. Create EVERY file with COMPLETE working code.
4. Use Kotlin unless user asks for Java.
5. compileSdk 34, minSdk 24, targetSdk 34, Java 17.
6. Check [PROJECT FILES] first — if files exist, edit them.
7. Use "search_files" to find existing code before writing.

AVAILABLE ACTIONS: plan, message, create_file, edit_file, search_files, read_file,
  run_command, memory_note, ask_user, security_scan`,

  infra: `You are ZerathCode Infrastructure Agent — deploy and manage Node.js apps on Termux.

ABSOLUTE RULES:
1. Output ONLY a valid JSON array.
2. Every response starts with "plan".

AVAILABLE ACTIONS: plan, message, create_file, run_command, deploy_app, start_tunnel, memory_note, ask_user`,

  fullai: `[
  { "action": "message", "params": { "text": "Full AI Mode ready. Describe what you want to do on your device." } }
]`,
};

// ─────────────────────────────────────────────────────────────────────────────
function readFileContent(absPath, from = null, to = null) {
  if (!fs.existsSync(absPath)) return null;
  const lines = fs.readFileSync(absPath, "utf8").split(/\r?\n/);
  const s = from ? Math.max(0, from - 1) : 0;
  const e = to   ? Math.min(lines.length, to) : lines.length;
  return lines.slice(s, e).join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
class Orchestrator {
  constructor(opts) {
    this.provider    = opts.provider;
    this.mode        = opts.mode;
    this.keyManager  = opts.keyManager;
    this.memory      = opts.memory;
    this.permManager = opts.permManager;
    this.workDir     = opts.workDir || process.cwd();
    this.sandbox     = new SandboxManager();
    this.ai          = new AiClient(opts.keyManager);
    this.healer      = new SelfHealingAgent({
      memory:   this.memory,
      ai:       this.ai,
      provider: this.provider,
      workDir:  this.workDir,
    });

    // File context builder for project scanning
    this.fileCtx = new FileContextBuilder(this.workDir);

    // Log agent — watches running server and auto-fixes errors
    this.logAgent = new LogAgent({
      workDir:  this.workDir,
      provider: this.provider,
      ai:       this.ai,
      memory:   this.memory,
    });

    this._devPort    = 3000;
    this._filesCreated = 0;
    this._serverStarted = false;
  }

  // ── Public: shutdown ───────────────────────────────────────────────────────
  shutdown() {
    if (this.logAgent.isRunning()) {
      this.logAgent.stop();
      renderer.agentLog("infra", "info", "Dev server + log agent stopped");
    }
  }

  // ── Process one user turn ──────────────────────────────────────────────────
  async process(userInput) {
    this.memory.addUserMessage(userInput);
    renderer.userMessage(userInput);

    const isChatMode  = this.mode === "chat" || this.mode === "fullai";
    const MAX_LOOPS   = isChatMode ? 5 : 1;

    this._filesCreated = 0;

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
        loopCount === 1
          ? `Thinking with ${this.provider}…`
          : `${this.provider} processing results (loop ${loopCount})…`);

      let raw;
      try {
        raw = await this.ai.ask(this.provider, prompt, {
          systemPrompt,
          maxTokens: 8192,
        });
      } catch (err) {
        renderer.errorBox("AI Error", err.message);
        this.memory.logError("ai", err.message);
        return;
      }

      const steps = this._parseSteps(raw);
      if (!steps || steps.length === 0) {
        renderer.aiMessage(raw.slice(0, 3000), this.provider);
        this.memory.addAssistantMessage(raw.slice(0, 500));
        return;
      }

      // Chat auto-web-fetch
      if (isChatMode && !forcedWeb && toolResults.length === 0
          && WebAgent.shouldAutoFetch(userInput)) {
        const hasWebFetch = steps.some(s => s.action === "web_fetch");
        const hasMessage  = steps.some(s => s.action === "message" || s.action === "ask_user");
        if (hasMessage && !hasWebFetch) {
          forcedWeb = true;
          const text = await this._executeStep({ action: "web_fetch", params: { query: userInput } });
          if (text) {
            toolResults.push({ url: `query: ${userInput}`.slice(0, 140), content: String(text).slice(0, 3000) });
          }
          continue;
        }
      }

      // ── Execute steps — parallel where possible ──────────────────────────
      const loopHasWebFetch = steps.some(s => s.action === "web_fetch");
      const suppressMessages = isChatMode && loopHasWebFetch;
      let   hasToolCall  = false;
      let   suppressedText = "";

      // Separate create_file steps (run in parallel), keep others sequential
      const batches = this._buildExecutionPlan(steps);

      for (const batch of batches) {
        if (batch.parallel) {
          // Run this batch of file creations in parallel
          await this._executeParallel(batch.steps);
        } else {
          // Sequential step
          const step   = batch.steps[0];
          const silent = suppressMessages && step.action === "message";
          const result = await this._executeStep(step, { silent, query: userInput });

          if (step.action === "web_fetch" && result) {
            const metaUrl = step.params.url
              || (step.params.query ? `query: ${String(step.params.query).slice(0, 140)}` : "web_fetch");
            toolResults.push({ url: metaUrl, content: String(result).slice(0, 3000) });
            hasToolCall = true;
          }
          if ((step.action === "message" && !silent) || step.action === "ask_user") {
            summary += (result || "") + "\n";
            gotAnswer = true;
          }
          if (step.action === "message" && silent) {
            suppressedText += (result || "") + "\n";
          }
        }

        // RUN-FIRST: start server as soon as entry point is ready
        if (!this._serverStarted && this.mode === "fullstack") {
          this._tryEarlyStart();
        }
      }

      if (!hasToolCall && !gotAnswer && suppressedText.trim()) {
        renderer.aiMessage(suppressedText.trim(), this.provider);
        summary += suppressedText.trim() + "\n";
        gotAnswer = true;
      }

      if (!hasToolCall && !gotAnswer) break;
    }

    // Post-processing
    if (this.mode !== "chat" && this.mode !== "fullai") {
      try { this.memory.writeReadme(); } catch {}
    }

    // Final server start (if not already started)
    if (this.mode === "fullstack" && this._filesCreated > 0 && !this._serverStarted) {
      await this._startServerWithLogAgent();
    }

    if (summary.trim()) {
      this.memory.addAssistantMessage(summary.trim());
    }
  }

  // ── Parallel execution plan ────────────────────────────────────────────────
  /**
   * Groups consecutive create_file steps into parallel batches.
   * Other step types remain sequential.
   */
  _buildExecutionPlan(steps) {
    const batches = [];
    let   pending = [];

    const flush = () => {
      if (pending.length === 0) return;
      // Split into sub-batches of PARALLEL_BATCH size
      for (let i = 0; i < pending.length; i += PARALLEL_BATCH) {
        batches.push({ parallel: true, steps: pending.slice(i, i + PARALLEL_BATCH) });
      }
      pending = [];
    };

    for (const step of steps) {
      if (step.action === "create_file") {
        pending.push(step);
      } else {
        flush();
        batches.push({ parallel: false, steps: [step] });
      }
    }
    flush();

    return batches;
  }

  async _executeParallel(steps) {
    renderer.agentLog("file", "info",
      `Creating ${steps.length} file(s) in parallel…`);
    await Promise.all(steps.map(step => this._executeStep(step)));
  }

  // ── Execute one step ───────────────────────────────────────────────────────
  async _executeStep(step, opts = {}) {
    const { action, params = {} } = step;

    switch (action) {

      // ── message ────────────────────────────────────────────────────────────
      case "message": {
        if (!opts.silent) renderer.aiMessage(params.text || "", this.provider);
        return params.text;
      }

      // ── plan ───────────────────────────────────────────────────────────────
      case "plan": {
        if (Array.isArray(params.steps) && params.steps.length) {
          renderer.planBlock(params.steps);
        }
        if (params.port) this._devPort = parseInt(params.port) || 3000;
        return null;
      }

      // ── search_files ───────────────────────────────────────────────────────
      // NEW: lets the AI search the project before writing code
      case "search_files": {
        const pattern = params.pattern || params.query || "";
        const op      = params.op || "find";  // "find" | "grep" | "read"
        let result    = "";

        if (op === "grep") {
          const hits = this.fileCtx.grep(pattern);
          if (hits.length === 0) {
            result = `No matches found for: ${pattern}`;
          } else {
            result = hits.slice(0, 20)
              .map(h => `${h.rel}:${h.lineNo}  ${h.content}`)
              .join("\n");
          }
        } else if (op === "read") {
          const content = this.fileCtx.readFile(params.path || pattern);
          result = content
            ? `--- ${params.path || pattern} ---\n${content}`
            : `File not found: ${params.path || pattern}`;
        } else {
          // find
          const files = pattern
            ? this.fileCtx.find(pattern)
            : this.fileCtx._scan().slice(0, 30);
          result = files.length === 0
            ? `No files found matching: ${pattern}`
            : files.map(f => `${f.rel}  (${f.size}B)`).join("\n");
        }

        renderer.agentLog("file", "read", `search_files(${op}: ${pattern}) → ${
          result.split("\n").length} result(s)`);
        return result;
      }

      // ── create_file ────────────────────────────────────────────────────────
      case "create_file": {
        const fp = this._resolvePath(params.path);
        if (!fp) return null;

        const rel = path.relative(this.workDir, fp);

        if (fs.existsSync(fp) && this.memory.isFileComplete(fp)) {
          renderer.agentLog("file", "warn",
            `${rel}  ${C.grey}SKIPPED (completed) — use edit_file${C.reset}`);
          return null;
        }

        const dir = path.dirname(fp);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const content = params.content || "";
        fs.writeFileSync(fp, content, { encoding: "utf8", mode: 0o644 });

        const ext  = path.extname(fp).slice(1).toLowerCase();
        const lang = {
          js:"JavaScript",ts:"TypeScript",kt:"Kotlin",java:"Java",
          py:"Python",html:"HTML",css:"CSS",json:"JSON",xml:"XML",
          gradle:"Gradle",sh:"Shell",md:"Markdown",txt:"Text",
        }[ext] || ext.toUpperCase() || "file";

        renderer.agentLog("file", "create",
          `${rel}  ${C.grey}(${lang}, ${content.split("\n").length}L)${C.reset}`);
        this.memory.logAction("file", "create", rel);
        this.memory.registerFile(fp, `${lang} — ${path.basename(fp)}`, lang);
        this.memory.markFileComplete(fp);
        this._filesCreated++;

        // Extract port from server entry
        if (ext === "js" && ["server.js","index.js","app.js"].includes(path.basename(fp))) {
          const pm = content.match(/PORT\s*=\s*(?:process\.env\.PORT\s*\|\|\s*)?(\d{4,5})/);
          if (pm) this._devPort = parseInt(pm[1]);
        }

        const showExts = new Set(["js","ts","kt","java","py","html","css","json","xml","sh","md"]);
        if (showExts.has(ext) && content.length > 0) {
          renderer.filePreview(rel, content, PREVIEW_LINES);
        }

        // RUN-FIRST: check if we can start now
        if (!this._serverStarted && this.mode === "fullstack") {
          this._tryEarlyStart();
        }

        return null;
      }

      // ── edit_file ──────────────────────────────────────────────────────────
      case "edit_file": {
        const fp = this._resolvePath(params.path);
        if (!fp) return null;

        if (!fs.existsSync(fp)) {
          renderer.agentLog("file", "warn", `edit_file: ${params.path} not found — creating`);
          const dir = path.dirname(fp);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(fp, params.content || "", "utf8");
          return null;
        }

        let content = fs.readFileSync(fp, "utf8");
        const rel   = path.relative(this.workDir, fp);

        if (params.find !== undefined && params.replace !== undefined) {
          if (content.includes(params.find)) {
            content = content.replace(params.find, params.replace);
            fs.writeFileSync(fp, content, "utf8");
            renderer.agentLog("file", "edit",
              `${rel}  ${C.grey}(find-replace)${C.reset}`);
          } else {
            renderer.agentLog("file", "warn", `edit_file: find text not found in ${rel}`);
          }
        } else if (params.line) {
          const lines = content.split(/\r?\n/);
          const lineNo = parseInt(params.line);
          if (lineNo >= 1 && lineNo <= lines.length) {
            lines[lineNo - 1] = params.content || "";
            fs.writeFileSync(fp, lines.join("\n"), "utf8");
            renderer.agentLog("file", "edit", `${rel}  ${C.grey}line ${lineNo}${C.reset}`);
          }
        } else if (params.from_line && params.to_line) {
          const lines = content.split(/\r?\n/);
          const from  = parseInt(params.from_line) - 1;
          const to    = parseInt(params.to_line);
          lines.splice(from, to - from, ...(params.content || "").split("\n"));
          fs.writeFileSync(fp, lines.join("\n"), "utf8");
          renderer.agentLog("file", "edit",
            `${rel}  ${C.grey}lines ${params.from_line}–${params.to_line}${C.reset}`);
        } else if (params.content !== undefined) {
          fs.writeFileSync(fp, params.content, "utf8");
          renderer.agentLog("file", "edit", `${rel}  ${C.grey}(full rewrite)${C.reset}`);
        }

        this.memory.logAction("file", "edit", rel);

        // If server is running, restart to pick up changes
        if (this._serverStarted && this.logAgent.isRunning()) {
          this._restartDevServer();
        }

        return null;
      }

      // ── append_file ────────────────────────────────────────────────────────
      case "append_file": {
        const fp = this._resolvePath(params.path);
        if (!fp) return null;
        if (!fs.existsSync(fp)) fs.writeFileSync(fp, "", "utf8");
        const cur = fs.readFileSync(fp, "utf8");
        const sep = cur && !cur.endsWith("\n") ? "\n" : "";
        fs.appendFileSync(fp, sep + (params.content || "") + "\n", "utf8");
        renderer.agentLog("file", "edit",
          `${path.relative(this.workDir, fp)}  ${C.grey}(appended)${C.reset}`);
        return null;
      }

      // ── delete_file ────────────────────────────────────────────────────────
      case "delete_file": {
        const fp = this._resolvePath(params.path);
        if (!fp) return null;
        if (fs.existsSync(fp)) {
          fs.unlinkSync(fp);
          const rel = path.relative(this.workDir, fp);
          renderer.agentLog("file", "delete", rel);
          this.memory.logAction("file", "delete", rel);
          this.memory.removeFile(fp);
        }
        return null;
      }

      // ── read_file ──────────────────────────────────────────────────────────
      case "read_file": {
        const fp = this._resolvePath(params.path);
        if (!fp || !fs.existsSync(fp)) {
          renderer.agentLog("file", "warn", `read_file: ${params.path} not found`);
          return null;
        }
        const content = readFileContent(fp, params.from_line, params.to_line);
        const rel = path.relative(this.workDir, fp);
        renderer.agentLog("file", "read", rel);
        renderer.filePreview(rel, content, PREVIEW_LINES);
        return content;
      }

      // ── run_command ────────────────────────────────────────────────────────
      case "run_command": {
        if (!params.cmd) return null;
        const cwd = params.cwd
          ? (path.isAbsolute(params.cwd) ? params.cwd : path.resolve(this.workDir, params.cwd))
          : this.workDir;
        const args = Array.isArray(params.args) ? params.args : [];

        if (params.background) {
          renderer.agentLog("infra", "info",
            `Server start queued: ${params.cmd} ${args.join(" ")}`);
          return null;
        }

        renderer.agentLog("system", "run", `${params.cmd} ${args.join(" ")}`);

        const result = await this.healer.run(
          params.cmd, args, cwd, params.timeout_ms || 300000);

        if (!result.success) {
          this.memory.logError(`${params.cmd} ${args.join(" ")}`,
            result.output?.slice(0, 400) || "unknown error");
        }

        // After npm install, try starting the server
        if (params.cmd === "npm" && args[0] === "install"
            && !this._serverStarted && this.mode === "fullstack") {
          await this._startServerWithLogAgent();
        }

        return null;
      }

      // ── web_fetch ──────────────────────────────────────────────────────────
      case "web_fetch": {
        const q     = params.query || opts.query || "";
        const label = params.url ? params.url : `query: ${String(q).slice(0, 80)}`;
        if (!params.url && !q) return null;

        renderer.agentLog("web", "info",
          params.url ? `Fetching ${params.url}` : `Searching: ${String(q).slice(0, 80)}`);

        try {
          const out = params.url
            ? await WebAgent.fetchRelevant(params.url, q, { timeoutMs:15000, maxChars:8000 })
            : await WebAgent.searchAndRag(q, { timeoutMs:15000, maxChars:8000, maxSites:12 });

          renderer.agentLog("web", "ok",
            `${out.status} — ${out.text.length} chars`);
          return out.text;
        } catch (err) {
          renderer.agentLog("web", "error", err.message);
          return null;
        }
      }

      // ── memory_note ────────────────────────────────────────────────────────
      case "memory_note": {
        this.memory.addNote(params.note || "");
        renderer.agentLog("memory", "memory", (params.note || "").slice(0, 80));
        return null;
      }

      // ── ask_user ───────────────────────────────────────────────────────────
      case "ask_user": {
        renderer.aiMessage(params.question || "Please clarify:", this.provider);
        return params.question;
      }

      // ── deploy_app ─────────────────────────────────────────────────────────
      case "deploy_app": {
        const infra = new InfrastructureAgent();
        await infra.run([
          "deploy",
          "--port",  String(params.port  || 3000),
          "--name",  params.appName || "zerathapp",
          "--dir",   params.dir    || this.workDir,
        ]);
        return null;
      }

      // ── start_tunnel ───────────────────────────────────────────────────────
      case "start_tunnel": {
        const infra = new InfrastructureAgent();
        await infra.run(["tunnel", "--port", String(params.port || 3000)]);
        return null;
      }

      // ── security_scan ──────────────────────────────────────────────────────
      case "security_scan": {
        await new SecurityAgent().run(["scan", params.dir || this.workDir]);
        return null;
      }

      // ── run_tests ──────────────────────────────────────────────────────────
      case "run_tests": {
        await new QAAgent().run(["test", this.workDir]);
        return null;
      }

      // ── notify ─────────────────────────────────────────────────────────────
      case "notify": {
        await new AssistantAgent().run([
          "notify", params.title || "ZerathCode", params.content || ""]);
        return null;
      }

      // ── set_run_commands ────────────────────────────────────────────────────
      case "set_run_commands": {
        if (params.commands) {
          this.memory.setRunCommands(
            Array.isArray(params.commands) ? params.commands : [params.commands]);
        }
        return null;
      }

      // ── git_clone ──────────────────────────────────────────────────────────
      case "git_clone": {
        if (!params.url) return null;
        renderer.agentLog("git", "run", `clone ${params.url}`);
        const dest = params.dest
          ? (this._resolvePath(params.dest) || this.workDir)
          : this.workDir;
        await new Promise(r => {
          const c = spawn("git", ["clone", params.url, dest],
            { stdio:"inherit", cwd:this.workDir });
          c.on("close", r);
        });
        return null;
      }

      default:
        renderer.agentLog("system", "warn", `Unknown step: "${action}" — skipping`);
        return null;
    }
  }

  // ── RUN-FIRST: try starting server as soon as possible ───────────────────
  _tryEarlyStart() {
    const hasPkg    = fs.existsSync(path.join(this.workDir, "package.json"));
    const entryFile = ["server.js","index.js","app.js"]
      .find(f => fs.existsSync(path.join(this.workDir, f)));

    if (!hasPkg || !entryFile) return;  // not ready yet

    // Has node_modules too? Start immediately.
    const hasModules = fs.existsSync(path.join(this.workDir, "node_modules"));
    if (hasModules) {
      // fire and forget — don't await
      this._startServerWithLogAgent().catch(() => {});
    }
    // If no node_modules, will be started after npm install completes
  }

  // ── Start dev server through LogAgent ─────────────────────────────────────
  async _startServerWithLogAgent() {
    if (this._serverStarted) return;
    this._serverStarted = true;

    const entryFile = ["server.js","index.js","app.js"]
      .find(f => fs.existsSync(path.join(this.workDir, f)));

    if (!entryFile) {
      this._serverStarted = false;
      return;
    }

    // Decide start cmd
    let cmd  = "node";
    let args = [entryFile];

    const pkgPath = path.join(this.workDir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        if (pkg.scripts?.start && !pkg.scripts.start.includes("vite")) {
          cmd  = "npm";
          args = ["start"];
        }
      } catch {}
    }

    renderer.agentLog("infra", "run",
      `Starting dev server: ${cmd} ${args.join(" ")}  ${C.grey}(port ${this._devPort})${C.reset}`);

    this.logAgent.port = this._devPort;
    this.logAgent.start(cmd, args);

    // Wire up LogAgent events for visibility
    this.logAgent.on("error_detected", ({ errorLines }) => {
      renderer.agentLog("system", "warn",
        `[LogAgent] Runtime error detected — attempting auto-fix…`);
    });

    this.logAgent.on("fix_applied", ({ description }) => {
      renderer.agentLog("system", "ok",
        `[LogAgent] ✔ Fixed: ${description.slice(0, 100)}`);
    });

    this.logAgent.on("fix_failed", (msg) => {
      renderer.agentLog("system", "error",
        `[LogAgent] Could not auto-fix: ${msg}  (manual fix may be needed)`);
    });

    // Give it 1.5s to show startup output
    await new Promise(r => setTimeout(r, 1500));

    console.log(
      `\n  ${C.bgreen}▶${C.reset}  App running at ` +
      `${C.bcyan}http://localhost:${this._devPort}${C.reset}` +
      `  ${C.grey}(LogAgent watching for errors)${C.reset}\n`
    );
  }

  // ── Restart dev server (after edit) ───────────────────────────────────────
  _restartDevServer() {
    renderer.agentLog("infra", "run", "Restarting server to apply file changes…");
    // LogAgent handles the restart internally
    if (this.logAgent.isRunning()) {
      this.logAgent._restart();
    }
  }

  // ── Build system prompt ───────────────────────────────────────────────────
  _buildSystemPrompt(userInput = "") {
    const base      = SYSTEM_PROMPTS[this.mode] || SYSTEM_PROMPTS.chat;
    const memCtx    = this.memory.buildContextBlock();

    // Inject live file context so AI knows what already exists
    const fileCtx   = (this.mode === "fullstack" || this.mode === "mobiledev")
      ? this.fileCtx.build(userInput, { maxBytes: 5000 })
      : "";

    const completed = this.memory.getCompletedFiles();
    const completedRule = completed.length
      ? `\n\nCOMPLETED FILES (STABLE — use edit_file only, not create_file):\n${
          completed.map(f => `  ✓ ${f}`).join("\n")}`
      : "";

    return [
      base,
      "\n\n" + memCtx,
      fileCtx ? "\n\n" + fileCtx : "",
      completedRule,
      "\n\nFINAL REMINDER: Your ENTIRE response must be a valid JSON array.",
      " Start with [ and end with ]. No text outside the array.",
    ].join("");
  }

  // ── Build prompt ──────────────────────────────────────────────────────────
  _buildPrompt(userInput) {
    const history = this.memory.getHistory(8);
    if (history.length <= 1) return userInput;
    const histText = history
      .slice(0, -1)
      .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");
    return `${histText}\n\nUser: ${userInput}`;
  }

  _buildPromptWithResults(userInput, toolResults) {
    const history = this.memory.getHistory(6);
    let histText = history.length > 1
      ? history.slice(0, -1)
          .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
          .join("\n\n") + "\n\n"
      : "";

    const resultsBlock = toolResults
      .map((r, i) => `[RESULT ${i + 1}] Source: ${r.url}\n${r.content}`)
      .join("\n\n---\n\n");

    return `${histText}User: ${userInput}\n\n` +
      `[WEB RESULTS — use these to answer]\n\n${resultsBlock}\n\n[END]\n\n` +
      `Now provide a direct answer. Return a JSON array with a "message" action.`;
  }

  // ── Parse AI response ──────────────────────────────────────────────────────
  _parseSteps(raw) {
    if (!raw || typeof raw !== "string") return null;
    let str = raw.trim();
    const fence = str.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) str = fence[1].trim();
    const s = str.indexOf("[");
    const e = str.lastIndexOf("]");
    if (s === -1 || e === -1 || e <= s) return null;
    try {
      const parsed = JSON.parse(str.slice(s, e + 1));
      if (!Array.isArray(parsed)) return null;
      return parsed.filter(x => x && typeof x.action === "string");
    } catch { return null; }
  }

  // ── Resolve path ───────────────────────────────────────────────────────────
  _resolvePath(rawPath) {
    if (!rawPath) return null;
    try {
      const abs = rawPath.startsWith("/")
        ? rawPath
        : path.resolve(this.workDir, rawPath);
      if (!abs.startsWith(this.workDir)) {
        renderer.agentLog("file", "warn", `Path "${rawPath}" escapes project dir — blocked`);
        return null;
      }
      return abs;
    } catch (err) {
      renderer.agentLog("file", "error", `Bad path "${rawPath}": ${err.message}`);
      return null;
    }
  }
}

module.exports = Orchestrator;
