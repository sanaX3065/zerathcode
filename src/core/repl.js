/**
 * src/core/repl.js
 * ZerathCode v1.0 — Interactive REPL
 * Author: sanaX3065
 *
 * Flow:
 *   zerath run
 *     → Provider menu
 *     → Mode menu  (chat / fullstack / mobiledev / infra / fullai)
 *
 *   If fullstack / mobiledev / infra:
 *     → Project menu  (new or existing)
 *     → Load memory if existing
 *
 *   If chat / fullai:
 *     → Ephemeral memory (nothing saved to disk)
 *
 *   → REPL loop  (❯❯ prompt — locked while AI is working)
 *   → exit → save memory → goodbye
 */

"use strict";

const readline          = require("readline");
const path              = require("path");
const fs                = require("fs");

const renderer          = require("../ui/renderer");
const { C }             = require("../ui/renderer");
const ApiKeyManager     = require("./apiKeyManager");
const PermissionManager = require("./permissionManager");
const MemoryManager     = require("./memoryManager");
const WorkspaceManager  = require("./workspaceManager");
const Orchestrator      = require("./orchestrator");
const SystemMonitor     = require("./systemMonitor");

// ── Mode definitions ──────────────────────────────────────────────────────────
const MODES = [
  {
    id:     "chat",
    label:  "💬  Chat Mode",
    desc:   "Ask coding questions, get help, write snippets  (ephemeral — nothing saved)",
    colour: C.bcyan,
  },
  {
    id:     "fullstack",
    label:  "🌐  Full Stack Mode",
    desc:   "Build complete web apps — HTML, CSS, Node.js, REST APIs",
    colour: C.byellow,
  },
  {
    id:     "mobiledev",
    label:  "📱  Mobile Dev Mode",
    desc:   "Build Android apps with Kotlin + Gradle",
    colour: C.bmagenta,
  },
  {
    id:     "infra",
    label:  "🚀  Infrastructure Mode",
    desc:   "Deploy apps — PM2, Nginx, Cloudflare tunnels, service monitoring",
    colour: C.bblue,
  },
  {
    id:     "fullai",
    label:  "🤖  Full AI Mode",
    desc:   "Direct AI control of your mobile device via WebSocket bridge",
    colour: C.bgreen,
  },
];

// ── Provider display info ─────────────────────────────────────────────────────
const PROVIDER_META = {
  claude: { label: "Claude  (Anthropic)", colour: C.bmagenta, icon: "🟣" },
  gemini: { label: "Gemini  (Google)",    colour: C.bblue,    icon: "🔵" },
  gpt:    { label: "GPT     (OpenAI)",    colour: C.bgreen,   icon: "🟢" },
  openai: { label: "GPT     (OpenAI)",    colour: C.bgreen,   icon: "🟢" },
};

class Repl {
  constructor() {
    this.keyManager   = new ApiKeyManager();
    this.permManager  = new PermissionManager();
    this.workspace    = new WorkspaceManager();
    this.monitor      = new SystemMonitor();
    this.provider     = null;
    this.mode         = null;
    this.memory       = null;
    this.orchestrator = null;
    this.rl           = null;
    this.projectMeta  = null;
    this._processing  = false;  // gate — prevents double-input while AI works
  }

  // ── Entry point ───────────────────────────────────────────────────────────
  async start() {
    renderer.banner();
    this._startMonitor();

    // Step 1: Check keys
    const available = this._getAvailableProviders();
    if (available.length === 0) {
      renderer.errorBox(
        "No API Keys Found",
        "Add at least one key before starting:\n\n" +
        "  zerath keys add claude   sk-ant-api03-...\n" +
        "  zerath keys add gemini   AIzaSy-...\n" +
        "  zerath keys add gpt      sk-proj-..."
      );
      process.exit(1);
    }

    // Step 2: Provider selection
    renderer.section("SELECT AI PROVIDER");
    console.log(`${C.grey}  Providers with keys stored:\n${C.reset}`);
    available.forEach((p, i) => {
      const m = PROVIDER_META[p] || { label: p, colour: C.white, icon: "⚪" };
      console.log(
        `  ${C.bgGrey}${C.white} ${i + 1} ${C.reset}  ${m.icon}  ${m.colour}${m.label}${C.reset}`
      );
    });
    console.log("");

    const pi = await this._pickNum(
      `${C.cyan}  Choose provider ${C.grey}(1–${available.length}):${C.reset} `,
      available.length
    );
    this.provider = available[pi];
    const pm = PROVIDER_META[this.provider] || {};
    console.log(`\n  ${C.bgreen}✔${C.reset}  ${pm.colour}${pm.label}${C.reset}\n`);

    // Step 3: Mode selection
    renderer.section("SELECT MODE");
    MODES.forEach((m, i) => {
      const soonTag = m.comingSoon ? `  ${C.grey}[Coming Soon]${C.reset}` : "";
      console.log(
        `  ${C.bgGrey}${C.white} ${i + 1} ${C.reset}  ${m.colour}${m.label}${C.reset}${soonTag}\n` +
        `       ${C.grey}${m.desc}${C.reset}\n`
      );
    });

    let mi;
    while (true) {
      mi = await this._pickNum(
        `${C.cyan}  Choose mode ${C.grey}(1–${MODES.length}):${C.reset} `,
        MODES.length
      );
      if (MODES[mi].comingSoon) {
        console.log(`\n  ${C.byellow}⚠${C.reset}  ${C.grey}Full AI Mode is coming in the next release. Choose another mode.${C.reset}\n`);
        continue;
      }
      break;
    }
    this.mode = MODES[mi].id;
    console.log(`\n  ${C.bgreen}✔${C.reset}  ${MODES[mi].colour}${MODES[mi].label}${C.reset} selected\n`);

    // Step 4: Workspace / project
    let workDir = process.cwd();
    if (this.mode !== "chat" && this.mode !== "fullai") {
      workDir = await this._projectMenu(this.mode);
    }

    // Step 5: Initialise memory
    if (this.mode === "chat" || this.mode === "fullai") {
      this.memory = new MemoryManager(null, "chat");
      this.memory.initProject({ name: "session", type: this.mode, stack: "" });
      console.log(
        `  ${C.bcyan}ℹ${C.reset}  ${C.grey}Ephemeral mode — nothing is saved to disk.${C.reset}\n`
      );
    } else {
      this.memory = new MemoryManager(workDir, "project");
    }

    // Step 6: Build orchestrator
    if (this.mode === "fullai") {
      const FullAiOrchestrator = require("./fullAiOrchestrator");
      const { getDeviceBridge } = require("./deviceBridge");
      
      // Start bridge server when entering fullai mode
      getDeviceBridge().start();
      
      this.orchestrator = new FullAiOrchestrator({
        provider:   this.provider,
        keyManager: this.keyManager,
        memory:     this.memory,
      });
    } else {
      this.orchestrator = new Orchestrator({
        provider:    this.provider,
        mode:        this.mode,
        keyManager:  this.keyManager,
        memory:      this.memory,
        permManager: this.permManager,
        workDir,
      });
    }

    // Step 7: Show badge + enter REPL
    renderer.divider();
    renderer.modeBadge(this.mode, this.provider);

    if (this.projectMeta && this.mode !== "chat" && this.mode !== "fullai") {
      console.log(
        `  ${C.byellow}📁${C.reset}  Project: ${C.white}${this.projectMeta.name}${C.reset}` +
        `  ${C.grey}${workDir}${C.reset}\n`
      );
    }

    this._printHelp();
    await this._runLoop();
  }

  // ── Project menu ──────────────────────────────────────────────────────────
  async _projectMenu(modeType) {
    const icon = { mobiledev: "📱", infra: "🚀", fullstack: "🌐" }[modeType] || "📁";
    renderer.section(`${icon} SELECT PROJECT`);

    const existing = this.workspace.listProjects(modeType);
    console.log(`  ${C.bgGrey}${C.white} 1 ${C.reset}  ${C.bgreen}＋  Create new project${C.reset}\n`);
    existing.forEach((p, i) => {
      const age = this._relativeTime(p.updated);
      console.log(
        `  ${C.bgGrey}${C.white} ${i + 2} ${C.reset}  ` +
        `${C.byellow}${p.name}${C.reset}  ${C.grey}${p.stack || ""}  •  ${age}${C.reset}`
      );
    });
    console.log("");

    const total  = existing.length + 1;
    const choice = await this._pickNum(`${C.cyan}  Choose ${C.grey}(1–${total}):${C.reset} `, total);

    // ── New project ──────────────────────────────────────────────────────────
    if (choice === 0) {
      const name = await this._askText(`${C.cyan}  Project name: ${C.reset}`);
      if (!name.trim()) {
        console.error(`${C.bred}  Name cannot be empty.${C.reset}`);
        process.exit(1);
      }
      const stack = await this._askText(
        `${C.cyan}  Tech stack ${C.grey}(e.g. "Node.js + HTML + CSS" or "Kotlin Android"):${C.reset} `
      );
      const desc = await this._askText(
        `${C.cyan}  Short description ${C.grey}(optional — press Enter to skip):${C.reset} `
      );

      let projDir;
      try {
        projDir = this.workspace.createProject(name, {
          type: modeType, stack: stack || "", description: desc || "", provider: this.provider,
        });
      } catch (err) {
        renderer.errorBox("Cannot create project", err.message);
        process.exit(1);
      }

      this.memory = new MemoryManager(projDir, "project");
      this.memory.initProject({
        name, type: modeType, stack: stack || "", description: desc || "", provider: this.provider,
      });
      this.projectMeta = { name, path: projDir, type: modeType };

      renderer.successBox(`Project "${name}" created`, [
        `Path:  ${projDir}`,
        `Stack: ${stack || "to be determined"}`,
      ]);
      return projDir;
    }

    // ── Existing project ─────────────────────────────────────────────────────
    const picked  = existing[choice - 1];
    renderer.agentLog("memory", "memory", `Loading memory for "${picked.name}"…`);

    const projDir = picked.path;
    this.memory   = new MemoryManager(projDir, "project");
    const snap    = this.memory.snapshot();
    this.workspace.touchProject(picked.slug, { provider: this.provider });
    this.projectMeta = { name: picked.name, path: projDir, type: modeType };

    const p = snap.project || {};
    renderer.successBox(`Memory loaded: "${picked.name}"`, [
      `Stack:    ${p.stack || "unknown"}`,
      `Status:   ${p.status || "active"}`,
      `Files:    ${Object.keys(snap.files || {}).length} tracked`,
      `Actions:  ${(snap.actionLog || []).length} recorded`,
      `Updated:  ${p.updated?.slice(0, 19) || "unknown"}`,
    ]);
    return projDir;
  }

  // ── Main REPL loop ─────────────────────────────────────────────────────────
  // Uses raw stdin data events so we can gate on this._processing
  async _runLoop() {
    const showPrompt = () => {
      process.stdout.write(`\n${C.bmagenta}❯❯${C.reset} `);
    };

    // Use readline just for line-editing / history on interactive terminals
    this.rl = readline.createInterface({
      input:     process.stdin,
      output:    process.stdout,
      terminal:  true,
    });

    this.rl.on("line", async (rawLine) => {
      const line = rawLine.trim();

      // While processing, swallow extra input silently
      if (this._processing) return;
      if (!line) { showPrompt(); return; }

      // Erase the echoed prompt so logs print cleanly below
      process.stdout.write("\r\x1b[K");

      // Meta / slash commands
      if (line.startsWith("/") || line.toLowerCase() === "exit") {
        await this._handleMeta(line.toLowerCase());
        if (line.toLowerCase() !== "exit") showPrompt();
        return;
      }

      // Thermal guard
      const safe = await this.monitor.isSafeToRun();
      if (!safe) {
        renderer.errorBox("System Paused", "Device too hot or battery critical.\nWait a moment, then retry.");
        showPrompt();
        return;
      }

      // Lock prompt, run, unlock
      this._processing = true;
      try {
        await this.orchestrator.process(line);
      } catch (err) {
        renderer.errorBox("Error", err.message);
        if (process.env.ZERATH_DEBUG) console.error(err.stack);
      } finally {
        renderer.divider();
        this._processing = false;
        showPrompt();
      }
    });

    this.rl.on("close", () => this._goodbye());
    process.on("SIGINT",  () => this._goodbye());

    showPrompt();
  }

  // ── Meta commands ──────────────────────────────────────────────────────────
  async _handleMeta(cmd) {
    switch (cmd) {

      case "exit": this._goodbye(); return;

      case "/memory":
      case "/mem": {
        const snap = this.memory.snapshot();
        const p    = snap.project || {};
        renderer.section("PROJECT MEMORY");
        console.log(`  ${C.bcyan}Project:${C.reset}  ${p.name || "session"}`);
        console.log(`  ${C.bcyan}Mode:${C.reset}     ${p.type || "-"}`);
        console.log(`  ${C.bcyan}Stack:${C.reset}    ${p.stack || "unknown"}`);
        console.log(`  ${C.bcyan}Status:${C.reset}   ${p.status || "active"}`);
        if (this.memory.tier === "project") {
          console.log(`  ${C.bcyan}Dir:${C.reset}      ${p.workDir || "-"}`);
        }
        const files = Object.keys(snap.files || {});
        if (files.length) {
          console.log(`\n  ${C.bcyan}Files (${files.length}):${C.reset}`);
          files.forEach((f) => {
            const m = snap.files[f];
            console.log(
              `    ${C.grey}•${C.reset}  ${C.yellow}${f}${C.reset}` +
              `  ${C.grey}${m.language || ""}  ${m.linesOfCode ? m.linesOfCode + "L" : ""}${C.reset}`
            );
          });
        }
        const errors = (snap.errors || []).filter((e) => !e.fixed);
        if (errors.length) {
          console.log(`\n  ${C.bred}Open errors (${errors.length}):${C.reset}`);
          errors.forEach((e) => {
            console.log(`    ${C.grey}•${C.reset}  ${C.bred}${e.source}${C.reset}  ${C.grey}${e.error.slice(0, 80)}${C.reset}`);
          });
        }
        const notes = (snap.notes || []).slice(-5);
        if (notes.length) {
          console.log(`\n  ${C.bcyan}Notes:${C.reset}`);
          notes.forEach((n) => console.log(`    ${C.grey}•  ${n.note}${C.reset}`));
        }
        if (this.memory.memoryFilePath) {
          console.log(`\n  ${C.grey}Memory: ${this.memory.memoryFilePath}${C.reset}`);
        }
        console.log("");
        break;
      }

      case "/files": {
        const files = this.memory.getFiles();
        const keys  = Object.keys(files);
        if (!keys.length) {
          console.log(`${C.grey}  No files tracked yet.${C.reset}\n`);
        } else {
          renderer.section(`FILES (${keys.length})`);
          keys.forEach((f) => {
            const m = files[f];
            console.log(
              `  ${C.yellow}${f}${C.reset}` +
              `  ${C.grey}${m.language || ""}  ${m.linesOfCode || "?"}L${C.reset}`
            );
          });
          console.log("");
        }
        break;
      }

      case "/debug": {
        console.log(`\n${C.bcyan}  DEBUG INFO${C.reset}\n`);
        console.log(`  ${C.yellow}Memory State${C.reset}`);
        console.log(`    projectDir:     ${this.memory.projectDir || C.grey + "NOT SET" + C.reset}`);
        console.log(`    memoryFilePath: ${this.memory.memoryFilePath || "N/A"}`);
        const files = this.memory.getFiles();
        console.log(`    tracked files:  ${Object.keys(files).length}`);
        console.log(`    completed:      ${(this.memory.getCompletedFiles() || []).length}`);
        
        console.log(`\n  ${C.yellow}Orchestrator State${C.reset}`);
        console.log(`    workDir:        ${this.orchestrator?.workDir || C.grey + "NOT SET" + C.reset}`);
        console.log(`    filesCreated:   ${this.orchestrator?._filesCreated || 0}`);
        
        console.log(`\n  ${C.yellow}File Details${C.reset}`);
        if (Object.keys(files).length === 0) {
          console.log(`    ${C.grey}(no files in memory)${C.reset}`);
        } else {
          Object.entries(files).forEach(([path, info]) => {
            console.log(`    ${path}`);
            console.log(`      language: ${info.language}, lines: ${info.linesOfCode}, created: ${info.created?.slice(0, 19)}`);
          });
        }
        console.log("");
        break;
      }

      case "/clear":
        console.clear();
        renderer.modeBadge(this.mode, this.provider);
        break;

      case "/history": {
        const hist = this.memory.getHistory(20);
        renderer.section("CONVERSATION HISTORY");
        hist.forEach((m) => {
          const lbl = m.role === "user" ? `${C.white}YOU${C.reset}` : `${C.bmagenta}AI ${C.reset}`;
          console.log(`  ${lbl}  ${C.grey}${(m.content || "").slice(0, 120)}${C.reset}`);
        });
        console.log("");
        break;
      }

      case "/clearhistory":
        this.memory.clearHistory();
        console.log(`${C.bgreen}  ✔  History cleared.${C.reset}\n`);
        break;

      case "/readme": {
        if (this.memory.tier !== "project") {
          console.log(`${C.grey}  README not available in ephemeral mode.${C.reset}\n`);
          break;
        }
        this.memory.writeReadme();
        const p  = this.memory.getProject();
        console.log(`${C.bgreen}  ✔  README.md → ${path.join(p.workDir || "", "README.md")}${C.reset}\n`);
        break;
      }

      case "/save": {
        if (this.memory.tier !== "project") {
          console.log(`${C.grey}  Nothing to save in ephemeral mode.${C.reset}\n`);
          break;
        }
        this.memory.writeReadme();
        const snap    = this.memory.snapshot();
        const outFile = `zerath-memory-${Date.now()}.json`;
        fs.writeFileSync(outFile, JSON.stringify(snap, null, 2), "utf8");
        console.log(`${C.bgreen}  ✔  Exported: ${outFile}${C.reset}\n`);
        break;
      }

      case "/projects": {
        const all = this.workspace.listProjects();
        if (!all.length) {
          console.log(`${C.grey}  No projects yet.${C.reset}\n`);
          break;
        }
        renderer.section(`ALL PROJECTS (${all.length})`);
        all.forEach((p) => {
          const clr = p.type === "mobiledev" ? C.bmagenta : p.type === "infra" ? C.bblue : C.byellow;
          console.log(`  ${clr}${p.name}${C.reset}  ${C.grey}[${p.type}]  ${p.stack || ""}  ${this._relativeTime(p.updated)}${C.reset}`);
          console.log(`    ${C.grey}${p.path}${C.reset}`);
        });
        console.log("");
        break;
      }

      case "/mode": {
        renderer.section("CHANGE MODE");
        MODES.forEach((m, i) => {
          const cur  = m.id === this.mode ? `  ${C.bgreen}← current${C.reset}` : "";
          const soon = m.comingSoon ? `  ${C.grey}[Soon]${C.reset}` : "";
          console.log(`  [${i + 1}]  ${m.colour}${m.label}${C.reset}${cur}${soon}`);
        });
        console.log("");
        let idx;
        while (true) {
          idx = await this._pickNum(`  Choose (1–${MODES.length}): `, MODES.length);
          if (MODES[idx].comingSoon) { console.log(`${C.grey}  Coming soon — choose another.${C.reset}\n`); continue; }
          break;
        }
        this.mode = MODES[idx].id;
        if (this.orchestrator) this.orchestrator.mode = this.mode;
        console.log(`${C.bgreen}  ✔  Mode → ${MODES[idx].label}${C.reset}\n`);
        break;
      }

      case "/monitor":
        await this.monitor.printLiveStats();
        break;

      case "/security": {
        const dir = this.orchestrator?.workDir || process.cwd();
        const SecurityAgent = require("../agents/securityAgent");
        await new SecurityAgent().run(["scan", dir]);
        break;
      }

      case "/deploy": {
        if (this.memory.tier !== "project") {
          console.log(`${C.grey}  /deploy is only available in project modes.${C.reset}\n`);
          break;
        }
        const port = await this._askText(`${C.cyan}  Port ${C.grey}(default 3000):${C.reset} `);
        const InfrastructureAgent = require("../agents/infrastructureAgent");
        await new InfrastructureAgent().run(["deploy", "--port", port || "3000"]);
        break;
      }

      case "/tunnel": {
        const port = await this._askText(`${C.cyan}  Local port ${C.grey}(default 3000):${C.reset} `);
        const InfrastructureAgent = require("../agents/infrastructureAgent");
        await new InfrastructureAgent().run(["tunnel", "--port", port || "3000"]);
        break;
      }

      case "/notify": {
        const msg = await this._askText(`${C.cyan}  Notification message:${C.reset} `);
        const AssistantAgent = require("../agents/assistantAgent");
        await new AssistantAgent().run(["notify", "ZerathCode", msg]);
        break;
      }

      case "/help":
      case "/?":
        this._printHelp();
        break;

      default:
        console.log(`${C.grey}  Unknown command: "${cmd}". Type /help for the list.${C.reset}\n`);
    }
  }

  // ── Help ───────────────────────────────────────────────────────────────────
  _printHelp() {
    console.log(
      `\n${C.grey}  ┌─ Commands ────────────────────────────────────┐${C.reset}\n` +
      `${C.grey}  │  /memory    Project memory snapshot            │${C.reset}\n` +
      `${C.grey}  │  /files     Tracked files                      │${C.reset}\n` +
      `${C.grey}  │  /debug     Memory & file tracking state       │${C.reset}\n` +
      `${C.grey}  │  /projects  All projects                       │${C.reset}\n` +
      `${C.grey}  │  /history   Conversation history               │${C.reset}\n` +
      `${C.grey}  │  /readme    Write README.md to project dir     │${C.reset}\n` +
      `${C.grey}  │  /save      Export memory snapshot to JSON     │${C.reset}\n` +
      `${C.grey}  │  /mode      Switch mode mid-session            │${C.reset}\n` +
      `${C.grey}  │  /clear     Clear terminal                     │${C.reset}\n` +
      `${C.grey}  │  /monitor   Battery + temperature panel        │${C.reset}\n` +
      `${C.grey}  │  /security  Scan project for hardcoded secrets │${C.reset}\n` +
      `${C.grey}  │  /deploy    PM2 + Nginx + Cloudflare tunnel    │${C.reset}\n` +
      `${C.grey}  │  /tunnel    Cloudflare tunnel only             │${C.reset}\n` +
      `${C.grey}  │  /notify    Device notification (Termux:API)   │${C.reset}\n` +
      `${C.grey}  │  exit       Save memory and quit               │${C.reset}\n` +
      `${C.grey}  └───────────────────────────────────────────────┘${C.reset}\n`
    );
  }

  // ── Goodbye ────────────────────────────────────────────────────────────────
  _goodbye() {
    console.log("");
    if (this.memory?.tier === "project") {
      try {
        this.memory.writeReadme();
        const p = this.memory.getProject();
        console.log(`${C.grey}  README.md updated: ${path.join(p.workDir || "", "README.md")}${C.reset}`);
      } catch {}
      if (this.memory.memoryFilePath) {
        console.log(`${C.grey}  Memory saved: ${this.memory.memoryFilePath}${C.reset}`);
      }
    } else {
      console.log(`${C.grey}  Session ended — ephemeral memory cleared.${C.reset}`);
    }
    if (this.orchestrator) this.orchestrator.shutdown();
    if (this.mode === "fullai") {
      const { getDeviceBridge } = require("./deviceBridge");
      getDeviceBridge().stop();
    }
    this.monitor.stop();
    console.log(`\n${C.bmagenta}  Goodbye from ZerathCode.${C.reset}\n`);
    if (this.rl) this.rl.close();
    process.exit(0);
  }

  // ── System monitor background ──────────────────────────────────────────────
  _startMonitor() {
    this.monitor.startWatching().catch(() => {});
    this.monitor.on("overheat", () => {
      process.stdout.write(`\n${C.byellow}⚠  Overheating — heavy tasks paused.${C.reset}\n`);
    });
    this.monitor.on("battery:critical", () => {
      process.stdout.write(`\n${C.bred}🔋 Battery critical — stopping tasks.${C.reset}\n`);
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  _getAvailableProviders() {
    return ["claude", "gemini", "gpt"].filter((p) => this.keyManager.getKey(p) !== null);
  }

  _pickNum(promptText, max) {
    return new Promise((resolve) => {
      const rl  = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ask = () => {
        rl.question(promptText, (ans) => {
          const n = parseInt(ans.trim());
          if (isNaN(n) || n < 1 || n > max) {
            process.stdout.write(`${C.bred}  Enter a number between 1 and ${max}.${C.reset}\n`);
            ask();
          } else {
            rl.close();
            resolve(n - 1);
          }
        });
      };
      ask();
    });
  }

  _askText(promptText) {
    return new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(promptText, (ans) => { rl.close(); resolve(ans.trim()); });
    });
  }

  _relativeTime(isoString) {
    if (!isoString) return "unknown";
    const diff  = Date.now() - new Date(isoString).getTime();
    const mins  = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days  = Math.floor(diff / 86400000);
    if (mins  < 1)  return "just now";
    if (mins  < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  }
}

module.exports = Repl;
