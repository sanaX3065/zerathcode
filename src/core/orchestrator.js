/**
 * src/core/orchestrator.js
 * ZerathCode v1.0 — Orchestrator
 * Author: sanaX3065
 *
 * Processes every user message:
 *   1. Build system prompt (mode-specific)
 *   2. Call AI (Claude / Gemini / GPT)
 *   3. Parse JSON step array
 *   4. Execute each step with rich agent logs
 *   5. Auto-run fullstack app after build
 *
 * CRITICAL: System prompts are written to force the AI
 * to ALWAYS return a JSON step array — never plain text.
 * Every example is explicit so Gemini doesn't shortcut.
 */

"use strict";

const fs               = require("fs");
const path             = require("path");
const { spawn }        = require("child_process");
const AiClient         = require("../utils/aiClient");
const SandboxManager   = require("./sandboxManager");
const SelfHealingAgent = require("./selfHealingAgent");
const renderer         = require("../ui/renderer");
const { C }            = require("../ui/renderer");

const PREVIEW_LINES = 25;

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPTS — explicit and strict to work with ALL providers
// ─────────────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPTS = {

  // ── CHAT ──────────────────────────────────────────────────────────────────
  chat: `You are ZerathCode Chat Agent — a precise, expert coding assistant running inside Termux on Android.

ABSOLUTE RULES:
1. You MUST respond with ONLY a valid JSON array. Nothing outside the array — no prose, no markdown, no explanation.
2. Every response starts with [ and ends with ].
3. Respond to exactly what the user asked. No unsolicited advice.
4. Do NOT create files unless the user explicitly says "create a file" or "save this".
5. Do NOT run commands unless asked.

RESPONSE FORMAT — always exactly this structure:

For a simple answer:
[
  { "action": "message", "params": { "text": "Your answer here" } }
]

For code with a file:
[
  { "action": "message",     "params": { "text": "Here is how it works..." } },
  { "action": "create_file", "params": { "path": "example.js", "content": "// full code here" } }
]

AVAILABLE ACTIONS:
  message, create_file, read_file, web_fetch

NEVER use: run_command, plan, memory_note, deploy_app, security_scan`,

  // ── FULL STACK ────────────────────────────────────────────────────────────
  fullstack: `You are ZerathCode Full Stack Agent — an autonomous web application builder running on Android/Termux.

YOUR ONLY JOB: Build complete, immediately runnable web applications.

ABSOLUTE RULES:
1. You MUST respond with ONLY a valid JSON array — no prose before or after it.
2. EVERY response MUST start with a "plan" action listing ALL steps.
3. Create EVERY file completely — zero placeholders, zero TODOs, zero "add your code here".
4. ONLY use these stacks (no complex build tools — this runs on Termux):
   - Frontend: vanilla HTML5 + CSS3 + vanilla JavaScript (NO React via npm, NO webpack, NO parcel)
   - Backend: Node.js with built-in 'http' module OR express (if user requests it)
   - React is OK ONLY via CDN <script> tags in HTML — never via npm
   - package.json must use "node server.js" as the start command — never "parcel" or "vite"
5. The LAST step MUST be a run_command that starts the server.
6. After run_command, add a memory_note describing what was built.
7. All file paths are relative to the project directory.
8. node_modules is NEVER committed — always add .gitignore.

REQUIRED RESPONSE STRUCTURE (every single response must follow this):
[
  {
    "action": "plan",
    "params": {
      "steps": [
        "Create package.json",
        "Create server.js with Express routes",
        "Create public/index.html",
        "Create public/style.css",
        "Create public/app.js",
        "Run: node server.js"
      ]
    }
  },
  {
    "action": "create_file",
    "params": {
      "path": "package.json",
      "content": "{\"name\":\"app\",\"version\":\"1.0.0\",\"scripts\":{\"start\":\"node server.js\"},\"dependencies\":{\"express\":\"^4.18.2\"}}"
    }
  },
  {
    "action": "create_file",
    "params": {
      "path": "server.js",
      "content": "const express = require('express');\nconst app = express();\nconst PORT = process.env.PORT || 3000;\napp.use(express.static('public'));\napp.use(express.json());\napp.get('/api/health', (req, res) => res.json({ ok: true }));\napp.listen(PORT, () => console.log('Server running on http://localhost:' + PORT));"
    }
  },
  {
    "action": "create_file",
    "params": {
      "path": "public/index.html",
      "content": "<!DOCTYPE html><html>...</html>"
    }
  },
  {
    "action": "run_command",
    "params": { "cmd": "npm", "args": ["install"], "cwd": "." }
  },
  {
    "action": "run_command",
    "params": { "cmd": "node", "args": ["server.js"], "cwd": "." }
  },
  {
    "action": "memory_note",
    "params": { "note": "Built todo app with Express + vanilla JS" }
  }
]

AVAILABLE ACTIONS:
  plan, message, create_file, edit_file, append_file, delete_file,
  read_file, run_command, memory_note, ask_user, web_fetch,
  deploy_app, security_scan`,

  // ── MOBILE DEV ────────────────────────────────────────────────────────────
  mobiledev: `You are ZerathCode Mobile Dev Agent — an autonomous Android app builder running on Termux.

YOUR ONLY JOB: Build complete, compilable Kotlin Android apps using Gradle.

ABSOLUTE RULES:
1. You MUST respond with ONLY a valid JSON array — no prose before or after it.
2. EVERY response MUST start with a "plan" action listing ALL steps.
3. Create EVERY file with COMPLETE working Kotlin/XML code — zero placeholders.
4. Use Kotlin exclusively (not Java) unless user asks for Java.
5. Use AppCompat + ConstraintLayout. No Jetpack Compose unless user asks.
6. Target SDK 34, minSdk 24, Java 17.
7. MANDATORY project file structure — create ALL of these:
   - settings.gradle
   - build.gradle          (project level)
   - gradle.properties
   - app/build.gradle      (module level)
   - app/src/main/AndroidManifest.xml
   - app/src/main/kotlin/<package/path>/MainActivity.kt
   - app/src/main/res/layout/activity_main.xml
   - app/src/main/res/values/strings.xml
   - app/src/main/res/values/themes.xml
   - gradle/wrapper/gradle-wrapper.properties
8. Build command: ./gradlew assembleDebug --no-daemon
9. After building, show install instructions in a message step.
10. Add a memory_note describing the app.

EXAMPLE — required structure for EVERY mobiledev response:
[
  {
    "action": "plan",
    "params": { "steps": ["Create settings.gradle", "Create build.gradle", "Create app/build.gradle", "Create MainActivity.kt", "Create layouts", "Run Gradle build"] }
  },
  {
    "action": "create_file",
    "params": {
      "path": "settings.gradle",
      "content": "pluginManagement {\n    repositories { google(); mavenCentral(); gradlePluginPortal() }\n}\ndependencyResolutionManagement {\n    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)\n    repositories { google(); mavenCentral() }\n}\nrootProject.name = \"MyApp\"\ninclude ':app'"
    }
  },
  {
    "action": "create_file",
    "params": {
      "path": "app/src/main/kotlin/com/zerath/myapp/MainActivity.kt",
      "content": "package com.zerath.myapp\n\nimport androidx.appcompat.app.AppCompatActivity\nimport android.os.Bundle\n\nclass MainActivity : AppCompatActivity() {\n    override fun onCreate(savedInstanceState: Bundle?) {\n        super.onCreate(savedInstanceState)\n        setContentView(R.layout.activity_main)\n    }\n}"
    }
  },
  {
    "action": "run_command",
    "params": { "cmd": "./gradlew", "args": ["assembleDebug", "--no-daemon"], "cwd": "." }
  },
  {
    "action": "message",
    "params": { "text": "Build complete! Install with: adb install app/build/outputs/apk/debug/app-debug.apk" }
  },
  {
    "action": "memory_note",
    "params": { "note": "Built Android calculator app with Kotlin" }
  }
]

AVAILABLE ACTIONS:
  plan, message, create_file, edit_file, append_file, delete_file,
  read_file, run_command, memory_note, ask_user, security_scan`,

  // ── INFRASTRUCTURE ────────────────────────────────────────────────────────
  infra: `You are ZerathCode Infrastructure Agent — an autonomous deployment system for Android/Termux.

YOUR ONLY JOB: Deploy and manage applications running on Termux.

ABSOLUTE RULES:
1. You MUST respond with ONLY a valid JSON array — no prose before or after it.
2. EVERY response MUST start with a "plan" action.
3. Use PM2 for process management when available.
4. Use Nginx as reverse proxy when available.
5. Use cloudflared for public tunnel exposure.
6. Always check if app is running before deploying.
7. Add a memory_note after each deployment.

RESPONSE STRUCTURE:
[
  { "action": "plan", "params": { "steps": ["Start with PM2", "Configure Nginx", "Start Cloudflare tunnel"] } },
  { "action": "deploy_app", "params": { "appName": "myapp", "port": 3000, "dir": "." } },
  { "action": "start_tunnel", "params": { "port": 3000 } },
  { "action": "memory_note", "params": { "note": "Deployed myapp on port 3000" } }
]

AVAILABLE ACTIONS:
  plan, message, create_file, edit_file, run_command,
  deploy_app, start_tunnel, memory_note, ask_user`,

  // ── FULL AI (placeholder — coming soon) ───────────────────────────────────
  fullai: `You are ZerathCode Full AI Agent.

This mode is coming soon. For now, respond with a friendly message.

[
  { "action": "message", "params": { "text": "Full AI Mode is coming in the next release of ZerathCode. Use Chat, Full Stack, Mobile Dev, or Infrastructure mode for now." } }
]`,

};

// ─────────────────────────────────────────────────────────────────────────────
// File reading helper
// ─────────────────────────────────────────────────────────────────────────────
function readFileContent(absPath, fromLine = null, toLine = null) {
  if (!fs.existsSync(absPath)) return null;
  const lines = fs.readFileSync(absPath, "utf8").split(/\r?\n/);
  const start = fromLine ? Math.max(0, fromLine - 1) : 0;
  const end   = toLine   ? Math.min(lines.length, toLine) : lines.length;
  return lines.slice(start, end).join("\n");
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

    // Track running dev servers in fullstack mode (port → child process)
    this._devServer  = null;
    this._devPort    = null;
  }

  // ── Process one user turn ─────────────────────────────────────────────────
  async process(userInput) {
    this.memory.addUserMessage(userInput);
    renderer.userMessage(userInput);

    const systemPrompt = this._buildSystemPrompt();
    const prompt       = this._buildPrompt(userInput);

    renderer.agentLog("ai", "info", `Thinking with ${this.provider}…`);

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

    // Parse steps
    const steps = this._parseSteps(raw);

    if (!steps || steps.length === 0) {
      // Gemini sometimes returns plain text — display it as a message
      renderer.aiMessage(raw.slice(0, 2000), this.provider);
      this.memory.addAssistantMessage(raw);
      return;
    }

    // Execute all steps, collect summary text
    let assistantSummary = "";
    for (const step of steps) {
      const result = await this._executeStep(step);
      if (step.action === "message" || step.action === "ask_user") {
        assistantSummary += (result || "") + "\n";
      }
    }

    // After all steps — refresh README
    if (this.mode !== "chat" && this.mode !== "fullai") {
      try { this.memory.writeReadme(); } catch {}
    }

    // Fullstack: auto-start dev server if not already running
    if (this.mode === "fullstack") {
      await this._ensureDevServer();
    }

    if (assistantSummary.trim()) {
      this.memory.addAssistantMessage(assistantSummary.trim());
    }
  }

  // ── Execute one step ───────────────────────────────────────────────────────
  async _executeStep(step) {
    const { action, params = {} } = step;

    switch (action) {

      // ── message ──────────────────────────────────────────────────────────
      case "message": {
        renderer.aiMessage(params.text || "", this.provider);
        return params.text;
      }

      // ── plan ──────────────────────────────────────────────────────────────
      case "plan": {
        if (Array.isArray(params.steps) && params.steps.length) {
          renderer.planBlock(params.steps);
        }
        return null;
      }

      // ── create_file ───────────────────────────────────────────────────────
      case "create_file": {
        const fp = this._resolvePath(params.path);
        if (!fp) return null;

        // Ensure parent dir exists
        const dir = path.dirname(fp);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
          renderer.agentLog("file", "create",
            `mkdir -p ${path.relative(this.workDir, dir) || "."}/`);
        }

        const content = params.content || "";
        fs.writeFileSync(fp, content, { encoding: "utf8", mode: 0o644 });

        const rel  = path.relative(this.workDir, fp);
        const ext  = path.extname(fp).slice(1).toLowerCase();
        const lang = {
          js: "JavaScript", ts: "TypeScript", kt: "Kotlin", java: "Java",
          py: "Python", html: "HTML", css: "CSS", json: "JSON",
          xml: "XML", gradle: "Gradle", sh: "Shell", md: "Markdown",
        }[ext] || ext.toUpperCase();

        renderer.agentLog("file", "create", `${rel}  ${C.grey}(${lang})${C.reset}`);
        this.memory.logAction("file", "create", rel);
        this.memory.registerFile(fp, `${lang} — ${path.basename(fp)}`, lang);

        // Show preview for code files
        const codeExts = new Set(["js","ts","kt","java","py","html","css","json","xml","gradle","sh","txt","md"]);
        if (codeExts.has(ext) && content.length > 0) {
          renderer.filePreview(rel, content, PREVIEW_LINES);
        }
        return null;
      }

      // ── edit_file ─────────────────────────────────────────────────────────
      case "edit_file": {
        const fp = this._resolvePath(params.path);
        if (!fp) return null;

        if (!fs.existsSync(fp)) {
          renderer.agentLog("file", "warn", `edit_file: "${params.path}" not found — creating`);
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
              `${rel}  ${C.grey}find→replace (${params.find.slice(0,25)})${C.reset}`);
          } else {
            renderer.agentLog("file", "warn", `edit_file: text not found in ${rel}`);
          }
        } else if (params.line) {
          const lines  = content.split(/\r?\n/);
          const lineNo = parseInt(params.line);
          if (lineNo >= 1 && lineNo <= lines.length) {
            lines[lineNo - 1] = params.content || "";
            fs.writeFileSync(fp, lines.join("\n"), "utf8");
            renderer.agentLog("file", "edit", `${rel}  ${C.grey}line ${lineNo}${C.reset}`);
          }
        } else if (params.from_line && params.to_line) {
          const lines    = content.split(/\r?\n/);
          const from     = parseInt(params.from_line) - 1;
          const to       = parseInt(params.to_line);
          const newLines = (params.content || "").split("\n");
          lines.splice(from, to - from, ...newLines);
          fs.writeFileSync(fp, lines.join("\n"), "utf8");
          renderer.agentLog("file", "edit",
            `${rel}  ${C.grey}lines ${params.from_line}–${params.to_line}${C.reset}`);
        } else if (params.content !== undefined) {
          // Full file replace
          fs.writeFileSync(fp, params.content, "utf8");
          renderer.agentLog("file", "edit", `${rel}  ${C.grey}(full replace)${C.reset}`);
        }

        this.memory.logAction("file", "edit", rel);
        return null;
      }

      // ── append_file ───────────────────────────────────────────────────────
      case "append_file": {
        const fp = this._resolvePath(params.path);
        if (!fp) return null;

        if (!fs.existsSync(fp)) fs.writeFileSync(fp, "", "utf8");
        const cur = fs.readFileSync(fp, "utf8");
        const sep = cur && !cur.endsWith("\n") ? "\n" : "";
        fs.appendFileSync(fp, sep + (params.content || "") + "\n", "utf8");

        const rel = path.relative(this.workDir, fp);
        renderer.agentLog("file", "edit", `${rel}  ${C.grey}(appended)${C.reset}`);
        this.memory.logAction("file", "append", rel);
        return null;
      }

      // ── delete_file ───────────────────────────────────────────────────────
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

      // ── read_file ─────────────────────────────────────────────────────────
      case "read_file": {
        const fp = this._resolvePath(params.path);
        if (!fp || !fs.existsSync(fp)) {
          renderer.agentLog("file", "warn", `read_file: "${params.path}" not found`);
          return null;
        }
        const from    = params.from_line ? parseInt(params.from_line) : null;
        const to      = params.to_line   ? parseInt(params.to_line)   : null;
        const content = readFileContent(fp, from, to);
        const rel     = path.relative(this.workDir, fp);
        const label   = (from && to) ? ` lines ${from}–${to}` : "";
        renderer.agentLog("file", "read", `${rel}${C.grey}${label}${C.reset}`);
        renderer.filePreview(rel + label, content, PREVIEW_LINES);
        this.memory.logAction("file", "read", rel);
        return content;
      }

      // ── run_command ───────────────────────────────────────────────────────
      case "run_command": {
        if (!params.cmd) return null;

        const cwd = params.cwd
          ? (path.isAbsolute(params.cwd)
              ? params.cwd
              : path.resolve(this.workDir, params.cwd))
          : this.workDir;

        const args   = Array.isArray(params.args) ? params.args : [];
        const cmdStr = `${params.cmd} ${args.join(" ")}`.trim();

        renderer.agentLog("system", "run", cmdStr);

        const result = await this.healer.run(
          params.cmd, args, cwd,
          params.timeout_ms || 300000
        );

        if (result.success) {
          renderer.agentLog("system", "ok", `${cmdStr}  ${C.grey}✔ done${C.reset}`);
        } else {
          renderer.agentLog("system", "warn",
            `${cmdStr}  ${C.grey}failed after ${result.attempts} attempt(s)${C.reset}`);
          this.memory.logError(cmdStr, result.output?.slice(0, 400) || "unknown error");
        }
        return null;
      }

      // ── web_fetch ─────────────────────────────────────────────────────────
      case "web_fetch": {
        if (!params.url) return null;
        renderer.agentLog("web", "info", `Fetching ${params.url}`);
        this.memory.logAction("web", "fetch", params.url);
        try {
          const res  = await fetch(params.url, {
            headers: { "User-Agent": "ZerathCode/1.0" },
            signal:  AbortSignal.timeout(15000),
          });
          const text = (await res.text())
            .replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim()
            .slice(0, 3000);
          renderer.agentLog("web", "ok", `${res.status} — ${text.length} chars`);
          return text;
        } catch (err) {
          renderer.agentLog("web", "error", err.message);
          return null;
        }
      }

      // ── git_clone ─────────────────────────────────────────────────────────
      case "git_clone": {
        if (!params.url) return null;
        const dest = params.dest
          ? this._resolvePath(params.dest) || this.workDir
          : this.workDir;
        renderer.agentLog("git", "run", `clone ${params.url}`);
        this.memory.logAction("git", "clone", params.url);
        await new Promise((resolve) => {
          const c = spawn("git", ["clone", params.url, dest],
            { stdio: "inherit", cwd: this.workDir });
          c.on("close", resolve);
        });
        return null;
      }

      // ── memory_note ───────────────────────────────────────────────────────
      case "memory_note": {
        const note = params.note || "";
        this.memory.addNote(note);
        renderer.agentLog("memory", "memory", note.slice(0, 80));
        return null;
      }

      // ── set_run_commands ──────────────────────────────────────────────────
      case "set_run_commands": {
        if (params.commands) {
          this.memory.setRunCommands(
            Array.isArray(params.commands) ? params.commands : [params.commands]
          );
          renderer.agentLog("memory", "info",
            `Run commands saved: ${(params.commands || []).join(", ")}`);
        }
        return null;
      }

      // ── ask_user ──────────────────────────────────────────────────────────
      case "ask_user": {
        const q = params.question || "Please clarify:";
        renderer.aiMessage(q, this.provider);
        return q;
      }

      // ── deploy_app (ZerathCode) ───────────────────────────────────────────
      case "deploy_app": {
        renderer.agentLog("infra", "deploy",
          `Deploying ${params.appName || "app"} on port ${params.port || 3000}`);
        const InfrastructureAgent = require("../agents/infrastructureAgent");
        const infra = new InfrastructureAgent();
        await infra.run([
          "deploy",
          "--port",  String(params.port || 3000),
          "--name",  params.appName || "zerathapp",
          "--dir",   params.dir    || this.workDir,
        ]);
        return null;
      }

      // ── start_tunnel (ZerathCode) ─────────────────────────────────────────
      case "start_tunnel": {
        renderer.agentLog("tunnel", "tunnel",
          `Cloudflare tunnel → port ${params.port || 3000}`);
        const InfrastructureAgent = require("../agents/infrastructureAgent");
        await new InfrastructureAgent().run(
          ["tunnel", "--port", String(params.port || 3000)]
        );
        return null;
      }

      // ── security_scan (ZerathCode) ────────────────────────────────────────
      case "security_scan": {
        const dir = params.dir || this.workDir;
        renderer.agentLog("security", "scan", `Scanning: ${dir}`);
        const SecurityAgent = require("../agents/securityAgent");
        await new SecurityAgent().run(["scan", dir]);
        this.memory.logAction("security", "scan", dir);
        return null;
      }

      // ── run_tests (ZerathCode) ────────────────────────────────────────────
      case "run_tests": {
        renderer.agentLog("qa", "run", `Tests: ${this.workDir}`);
        const QAAgent = require("../agents/qaAgent");
        await new QAAgent().run(["test", this.workDir]);
        return null;
      }

      // ── notify (ZerathCode) ───────────────────────────────────────────────
      case "notify": {
        const AssistantAgent = require("../agents/assistantAgent");
        await new AssistantAgent().run(
          ["notify", params.title || "ZerathCode", params.content || ""]
        );
        return null;
      }

      default:
        renderer.agentLog("system", "warn", `Unknown step: "${action}"`);
        return null;
    }
  }

  // ── Fullstack auto dev-server ─────────────────────────────────────────────
  async _ensureDevServer() {
    // Only auto-run if a server.js or index.js exists and no server is running
    if (this._devServer) return;

    const candidates = ["server.js", "index.js", "app.js"].map(f =>
      path.join(this.workDir, f)
    );
    const main = candidates.find(f => fs.existsSync(f));
    if (!main) return;

    // Also check for package.json start script
    const pkgFile = path.join(this.workDir, "package.json");
    let startCmd  = null;
    let startArgs = [];

    if (fs.existsSync(pkgFile)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
        if (pkg.scripts?.start) {
          startCmd  = "npm";
          startArgs = ["start"];
        }
      } catch {}
    }

    if (!startCmd) {
      startCmd  = "node";
      startArgs = [path.basename(main)];
    }

    const port = this._devPort || 3000;

    renderer.agentLog("infra", "run",
      `Auto-starting: ${startCmd} ${startArgs.join(" ")}  ${C.grey}(port ${port})${C.reset}`);

    // Kill existing if any
    if (this._devServer) {
      try { this._devServer.kill("SIGTERM"); } catch {}
    }

    this._devServer = spawn(startCmd, startArgs, {
      cwd:   this.workDir,
      env:   { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Stream server stdout briefly (5 lines max) to show it started
    let lineCount = 0;
    this._devServer.stdout.on("data", (chunk) => {
      if (lineCount >= 5) return;
      chunk.toString().split("\n").filter(Boolean).forEach((l) => {
        if (lineCount++ < 5) renderer.agentLog("infra", "ok", l.trim().slice(0, 80));
      });
    });
    this._devServer.stderr.on("data", (chunk) => {
      if (lineCount >= 5) return;
      chunk.toString().split("\n").filter(Boolean).forEach((l) => {
        if (lineCount++ < 5) renderer.agentLog("infra", "warn", l.trim().slice(0, 80));
      });
    });

    this._devServer.on("close", (code) => {
      renderer.agentLog("infra", code === 0 ? "ok" : "warn",
        `Dev server exited (${code})`);
      this._devServer = null;
    });

    // Wait briefly so startup logs appear
    await new Promise(r => setTimeout(r, 1500));

    console.log(
      `\n  ${C.bgreen}▶${C.reset}  Server running at ` +
      `${C.bcyan}http://localhost:${port}${C.reset}\n`
    );
  }

  // ── Build system prompt ────────────────────────────────────────────────────
  _buildSystemPrompt() {
    const base    = SYSTEM_PROMPTS[this.mode] || SYSTEM_PROMPTS.chat;
    const context = this.memory.buildContextBlock();

    return (
      base + "\n\n" + context +
      "\n\nFINAL REMINDER: Your entire response must be a JSON array starting with [ and ending with ]." +
      " Do not write anything outside the array."
    );
  }

  // ── Build user prompt with recent history ──────────────────────────────────
  _buildPrompt(userInput) {
    const history = this.memory.getHistory(8);
    if (history.length <= 1) return userInput;

    const histText = history
      .slice(0, -1)
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");

    return `${histText}\n\nUser: ${userInput}`;
  }

  // ── Parse AI response into step array ──────────────────────────────────────
  _parseSteps(raw) {
    if (!raw || typeof raw !== "string") return null;
    let str = raw.trim();

    // Strip markdown fences if present
    const fence = str.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) str = fence[1].trim();

    // Find outermost JSON array
    const s = str.indexOf("[");
    const e = str.lastIndexOf("]");
    if (s === -1 || e === -1 || e <= s) return null;

    try {
      const parsed = JSON.parse(str.slice(s, e + 1));
      if (!Array.isArray(parsed)) return null;
      return parsed.filter((x) => x && typeof x.action === "string");
    } catch {
      return null;
    }
  }

  // ── Safe path resolution ───────────────────────────────────────────────────
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
