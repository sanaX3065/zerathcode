/**
 * src/core/orchestrator.js
 * ZerathCode v1.0 — Orchestrator
 * Author: sanaX3065
 *
 * Processes every user message:
 *   1. Build system prompt (mode-specific + project memory)
 *   2. Call AI provider (Claude / Gemini / GPT)
 *   3. Parse JSON step array from response
 *   4. Execute each step with rich terminal logs
 *   5. Auto-start dev server after fullstack builds
 *
 * SYSTEM PROMPT DESIGN:
 *   Each mode prompt is very explicit with a real JSON example.
 *   This is critical for Gemini, which will return empty or plain-text
 *   responses if the prompt is vague. Every prompt ends with a
 *   "FINAL REMINDER" that the response must be a JSON array.
 */

"use strict";

const fs               = require("fs");
const path             = require("path");
const { spawn }        = require("child_process");

// ── Core deps (required at top — never lazy inside steps) ────────────────────
const AiClient         = require("../utils/aiClient");
const SandboxManager   = require("./sandboxManager");
const SelfHealingAgent = require("./selfHealingAgent");
const renderer         = require("../ui/renderer");
const { C }            = require("../ui/renderer");

// ── Agent deps (required at top to catch missing files early) ────────────────
const InfrastructureAgent = require("../agents/infrastructureAgent");
const SecurityAgent       = require("../agents/securityAgent");
const QAAgent             = require("../agents/qaAgent");
const AssistantAgent      = require("../agents/assistantAgent");

const PREVIEW_LINES = 25;

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPTS
// Explicit JSON examples are required — especially for Gemini which will
// short-circuit to plain text if the instructions are not concrete enough.
// ─────────────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPTS = {

  // ── CHAT ──────────────────────────────────────────────────────────────────
  chat: `You are ZerathCode Chat Agent — a knowledgeable assistant and coding expert running in Termux on Android.
You have access to a web_fetch tool that lets you retrieve live data from the internet.

TOOL USE RULES:
- For questions about real-time data (stock prices, live news, current events, weather, crypto prices, sports scores) — ALWAYS use web_fetch FIRST to get current information before answering.
- For questions about recent events you may not know (past 1-2 years) — use web_fetch to verify.
- For stable facts (code concepts, math, history, general knowledge) — answer directly without web_fetch.
- After receiving web_fetch results, synthesise them into a clear, direct answer. NEVER say "I cannot access real-time data" — you CAN via web_fetch.

HOW TO SEARCH THE WEB:
Use Google search URLs to find information:
  web_fetch("https://www.google.com/search?q=QUERY")
Use direct URLs when you know them:
  web_fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot")
  web_fetch("https://finance.yahoo.com/quote/NVDA")

RESPONSE FORMAT — ONLY valid JSON arrays, nothing else:

To answer directly:
[
  { "action": "message", "params": { "text": "Your complete answer here." } }
]

To search first, then answer:
[
  { "action": "web_fetch", "params": { "url": "https://www.google.com/search?q=bitcoin+price+INR+today" } }
]
Then in the NEXT turn (after results are injected), answer:
[
  { "action": "message", "params": { "text": "Based on the search results: Bitcoin is currently trading at ₹X..." } }
]

To create a file when asked:
[
  { "action": "message",     "params": { "text": "Here is the code:" } },
  { "action": "create_file", "params": { "path": "example.js", "content": "// full code here" } }
]

RULES:
1. Respond with ONLY a valid JSON array — nothing before or after the [ ].
2. Do NOT create files unless user explicitly asks to save/create a file.
3. Do NOT run commands unless asked.
4. When web results are injected into your context as [WEB RESULTS], use them to answer — do not search again.
5. Be concise and direct. Answer the actual question asked.

AVAILABLE ACTIONS: message, create_file, read_file, web_fetch`,

  // ── FULL STACK ────────────────────────────────────────────────────────────
  fullstack: `You are ZerathCode Full Stack Agent — an autonomous web application builder for Termux/Android.

YOUR ONLY JOB: Build complete, immediately runnable web applications.

ABSOLUTE RULES:
1. Respond with ONLY a valid JSON array — no text before or after it.
2. EVERY response MUST start with a "plan" action listing ALL files you will create.
3. Create EVERY file with 100% complete code — no placeholders, no TODOs.
4. Tech stack rules (Termux has no complex build tools):
   - Frontend: vanilla HTML5 + CSS3 + vanilla JavaScript ONLY
   - Backend:  Node.js with built-in http module OR express
   - React: ONLY via CDN <script> tags in HTML. Never via npm install.
   - Start command: ALWAYS "node server.js" — never parcel, vite, or webpack
5. Last steps MUST be: npm install (if express used) then node server.js
6. Add .gitignore that excludes node_modules
7. End with a memory_note describing what was built
8. All paths are relative to the project directory

REQUIRED STRUCTURE (copy this pattern every time):
[
  {
    "action": "plan",
    "params": { "steps": ["Create package.json", "Create server.js", "Create public/index.html", "Create public/style.css", "Create public/app.js", "npm install", "Start server"] }
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
      "content": "const express = require('express');\nconst path = require('path');\nconst app = express();\nconst PORT = process.env.PORT || 3000;\napp.use(express.static(path.join(__dirname, 'public')));\napp.use(express.json());\napp.listen(PORT, () => console.log('Server on http://localhost:' + PORT));"
    }
  },
  {
    "action": "create_file",
    "params": { "path": "public/index.html", "content": "<!DOCTYPE html><html lang='en'><head><meta charset='UTF-8'><title>App</title><link rel='stylesheet' href='style.css'></head><body><h1>Hello</h1><script src='app.js'></script></body></html>" }
  },
  {
    "action": "create_file",
    "params": { "path": "public/style.css", "content": "* { box-sizing: border-box; margin: 0; padding: 0; } body { font-family: sans-serif; padding: 2rem; }" }
  },
  {
    "action": "create_file",
    "params": { "path": "public/app.js", "content": "console.log('App loaded');" }
  },
  {
    "action": "create_file",
    "params": { "path": ".gitignore", "content": "node_modules/\n.env\n" }
  },
  {
    "action": "run_command",
    "params": { "cmd": "npm", "args": ["install"], "cwd": "." }
  },
  {
    "action": "run_command",
    "params": { "cmd": "node", "args": ["server.js"], "cwd": ".", "background": true }
  },
  {
    "action": "memory_note",
    "params": { "note": "Built Express web app with vanilla JS frontend" }
  }
]

AVAILABLE ACTIONS: plan, message, create_file, edit_file, append_file, delete_file,
  read_file, run_command, web_fetch, memory_note, ask_user, deploy_app, security_scan`,

  // ── MOBILE DEV ────────────────────────────────────────────────────────────
  mobiledev: `You are ZerathCode Mobile Dev Agent — an autonomous Android app builder for Termux.

YOUR ONLY JOB: Build complete, compilable Kotlin Android apps with Gradle.

ABSOLUTE RULES:
1. Respond with ONLY a valid JSON array — no text before or after it.
2. EVERY response MUST start with a "plan" action.
3. Create EVERY file with COMPLETE, working code — zero placeholders.
4. Use Kotlin (not Java) unless user explicitly asks for Java.
5. Use AppCompat + ConstraintLayout. Jetpack Compose only if user asks.
6. Always use: compileSdk 34, minSdk 24, targetSdk 34, Java 17.
7. Default package: com.zerath.<appname_lowercase>
8. YOU MUST CREATE ALL OF THESE FILES — every single one:
   - settings.gradle
   - build.gradle                   (project root)
   - gradle.properties
   - app/build.gradle               (app module)
   - gradle/wrapper/gradle-wrapper.properties
   - app/src/main/AndroidManifest.xml
   - app/src/main/kotlin/com/zerath/<app>/MainActivity.kt
   - app/src/main/res/layout/activity_main.xml
   - app/src/main/res/values/strings.xml
   - app/src/main/res/values/themes.xml
9. Build command: ./gradlew assembleDebug --no-daemon
10. After build step, show install command in a message step.
11. End with memory_note.

COMPLETE EXAMPLE (use as template — fill in real app content):
[
  {
    "action": "plan",
    "params": { "steps": ["Create settings.gradle", "Create root build.gradle", "Create gradle.properties", "Create app/build.gradle", "Create gradle wrapper", "Create AndroidManifest.xml", "Create MainActivity.kt", "Create layout", "Create string resources", "Create theme", "Build APK"] }
  },
  {
    "action": "create_file",
    "params": {
      "path": "settings.gradle",
      "content": "pluginManagement {\n    repositories {\n        google()\n        mavenCentral()\n        gradlePluginPortal()\n    }\n}\ndependencyResolutionManagement {\n    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)\n    repositories {\n        google()\n        mavenCentral()\n    }\n}\nrootProject.name = \"Calculator\"\ninclude ':app'"
    }
  },
  {
    "action": "create_file",
    "params": {
      "path": "build.gradle",
      "content": "plugins {\n    id 'com.android.application' version '8.2.0' apply false\n    id 'org.jetbrains.kotlin.android' version '1.9.22' apply false\n}"
    }
  },
  {
    "action": "create_file",
    "params": {
      "path": "gradle.properties",
      "content": "org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8\nandroid.useAndroidX=true\nkotlin.code.style=official"
    }
  },
  {
    "action": "create_file",
    "params": {
      "path": "app/build.gradle",
      "content": "plugins {\n    id 'com.android.application'\n    id 'org.jetbrains.kotlin.android'\n}\n\nandroid {\n    namespace 'com.zerath.calculator'\n    compileSdk 34\n    defaultConfig {\n        applicationId 'com.zerath.calculator'\n        minSdk 24\n        targetSdk 34\n        versionCode 1\n        versionName '1.0'\n    }\n    buildTypes {\n        release {\n            minifyEnabled false\n            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'\n        }\n    }\n    compileOptions {\n        sourceCompatibility JavaVersion.VERSION_17\n        targetCompatibility JavaVersion.VERSION_17\n    }\n    kotlinOptions { jvmTarget = '17' }\n}\n\ndependencies {\n    implementation 'androidx.core:core-ktx:1.12.0'\n    implementation 'androidx.appcompat:appcompat:1.6.1'\n    implementation 'com.google.android.material:material:1.11.0'\n    implementation 'androidx.constraintlayout:constraintlayout:2.1.4'\n}"
    }
  },
  {
    "action": "create_file",
    "params": {
      "path": "gradle/wrapper/gradle-wrapper.properties",
      "content": "distributionBase=GRADLE_USER_HOME\ndistributionPath=wrapper/dists\ndistributionUrl=https\\://services.gradle.org/distributions/gradle-8.4-bin.zip\nzipStoreBase=GRADLE_USER_HOME\nzipStorePath=wrapper/dists"
    }
  },
  {
    "action": "create_file",
    "params": {
      "path": "app/src/main/AndroidManifest.xml",
      "content": "<?xml version='1.0' encoding='utf-8'?>\n<manifest xmlns:android='http://schemas.android.com/apk/res/android'>\n    <application\n        android:allowBackup='true'\n        android:icon='@mipmap/ic_launcher'\n        android:label='@string/app_name'\n        android:theme='@style/Theme.App'\n        android:supportsRtl='true'>\n        <activity\n            android:name='.MainActivity'\n            android:exported='true'>\n            <intent-filter>\n                <action android:name='android.intent.action.MAIN' />\n                <category android:name='android.intent.category.LAUNCHER' />\n            </intent-filter>\n        </activity>\n    </application>\n</manifest>"
    }
  },
  {
    "action": "create_file",
    "params": {
      "path": "app/src/main/kotlin/com/zerath/calculator/MainActivity.kt",
      "content": "package com.zerath.calculator\n\nimport androidx.appcompat.app.AppCompatActivity\nimport android.os.Bundle\nimport android.widget.TextView\n\nclass MainActivity : AppCompatActivity() {\n    override fun onCreate(savedInstanceState: Bundle?) {\n        super.onCreate(savedInstanceState)\n        setContentView(R.layout.activity_main)\n    }\n}"
    }
  },
  {
    "action": "create_file",
    "params": {
      "path": "app/src/main/res/layout/activity_main.xml",
      "content": "<?xml version='1.0' encoding='utf-8'?>\n<androidx.constraintlayout.widget.ConstraintLayout\n    xmlns:android='http://schemas.android.com/apk/res/android'\n    xmlns:app='http://schemas.android.com/apk/res-auto'\n    android:layout_width='match_parent'\n    android:layout_height='match_parent'>\n\n    <TextView\n        android:id='@+id/text'\n        android:layout_width='wrap_content'\n        android:layout_height='wrap_content'\n        android:text='@string/app_name'\n        android:textSize='24sp'\n        app:layout_constraintBottom_toBottomOf='parent'\n        app:layout_constraintEnd_toEndOf='parent'\n        app:layout_constraintStart_toStartOf='parent'\n        app:layout_constraintTop_toTopOf='parent' />\n\n</androidx.constraintlayout.widget.ConstraintLayout>"
    }
  },
  {
    "action": "create_file",
    "params": {
      "path": "app/src/main/res/values/strings.xml",
      "content": "<resources>\n    <string name='app_name'>Calculator</string>\n</resources>"
    }
  },
  {
    "action": "create_file",
    "params": {
      "path": "app/src/main/res/values/themes.xml",
      "content": "<resources>\n    <style name='Theme.App' parent='Theme.MaterialComponents.DayNight.DarkActionBar'>\n        <item name='colorPrimary'>@color/purple_500</item>\n        <item name='colorPrimaryVariant'>@color/purple_700</item>\n        <item name='colorOnPrimary'>@color/white</item>\n    </style>\n</resources>"
    }
  },
  {
    "action": "run_command",
    "params": { "cmd": "./gradlew", "args": ["assembleDebug", "--no-daemon"], "cwd": "." }
  },
  {
    "action": "message",
    "params": { "text": "Build complete!\\n\\nInstall the APK:\\n  adb install app/build/outputs/apk/debug/app-debug.apk\\n\\nOr copy to device and install manually." }
  },
  {
    "action": "memory_note",
    "params": { "note": "Built Android Calculator app with Kotlin + Gradle" }
  }
]

AVAILABLE ACTIONS: plan, message, create_file, edit_file, append_file, delete_file,
  read_file, run_command, memory_note, ask_user, security_scan`,

  // ── INFRASTRUCTURE ────────────────────────────────────────────────────────
  infra: `You are ZerathCode Infrastructure Agent — an autonomous deployment system for Termux/Android.

YOUR ONLY JOB: Deploy and manage Node.js applications running on Termux.

ABSOLUTE RULES:
1. Respond with ONLY a valid JSON array — no text before or after it.
2. EVERY response MUST start with a "plan" action.
3. Use PM2 for process management.
4. Use cloudflared for public URL exposure.
5. End with memory_note.

RESPONSE STRUCTURE:
[
  { "action": "plan",        "params": { "steps": ["Deploy with PM2", "Start Cloudflare tunnel"] } },
  { "action": "deploy_app",  "params": { "appName": "myapp", "port": 3000, "dir": "." } },
  { "action": "start_tunnel","params": { "port": 3000 } },
  { "action": "memory_note", "params": { "note": "Deployed myapp on port 3000" } }
]

AVAILABLE ACTIONS: plan, message, create_file, run_command, deploy_app, start_tunnel, memory_note, ask_user`,

  // ── FULL AI (coming soon) ─────────────────────────────────────────────────
  fullai: `[
  { "action": "message", "params": { "text": "Full AI Mode is coming in the next release of ZerathCode. Use Chat, Full Stack, Mobile Dev, or Infrastructure mode for now." } }
]`,
};

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

    // Dev server tracking
    this._devServer      = null;
    this._devPort        = 3000;
    this._filesCreated   = 0;  // track so we don't auto-start if nothing was built
  }

  // ── Public: kill dev server on REPL exit ────────────────────────────────
  shutdown() {
    if (this._devServer) {
      try { this._devServer.kill("SIGTERM"); } catch {}
      this._devServer = null;
      renderer.agentLog("infra", "info", "Dev server stopped");
    }
  }

  // ── Process one user turn — agentic loop ─────────────────────────────────
  // For chat mode: model can call web_fetch tools, results are injected back,
  // and model gets another chance to synthesise a final answer.
  // For all other modes: single-pass execution (model returns full plan at once).
  async process(userInput) {
    this.memory.addUserMessage(userInput);
    renderer.userMessage(userInput);

    const isChatMode = this.mode === "chat" || this.mode === "fullai";
    const MAX_AGENT_LOOPS = isChatMode ? 5 : 1;

    const systemPrompt  = this._buildSystemPrompt();
    this._filesCreated  = 0;

    // Tool results accumulate across loops (url → content)
    const toolResults   = [];
    let assistantSummary = "";
    let loopCount       = 0;
    let gotFinalAnswer  = false;

    while (loopCount < MAX_AGENT_LOOPS && !gotFinalAnswer) {
      loopCount++;

      // Build prompt — inject tool results into context on subsequent loops
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
        // Plain text fallback
        renderer.aiMessage(raw.slice(0, 3000), this.provider);
        this.memory.addAssistantMessage(raw.slice(0, 500));
        return;
      }

      // Execute each step — collect tool results for next loop
      let thisLoopHasToolCalls = false;

      for (const step of steps) {
        const result = await this._executeStep(step);

        if (step.action === "web_fetch" && result) {
          toolResults.push({
            url:     step.params.url || "",
            content: String(result).slice(0, 3000),
          });
          thisLoopHasToolCalls = true;
          renderer.agentLog("web", "ok",
            `Result captured (${String(result).length} chars) — feeding back to ${this.provider}`);
        }

        if (step.action === "message" || step.action === "ask_user") {
          assistantSummary += (result || "") + "\n";
          gotFinalAnswer = true;   // model gave a real answer — stop looping
        }
      }

      // If this loop only made tool calls and no message yet — continue looping
      // If no tool calls AND no message — model returned only plan/file steps — stop
      if (!thisLoopHasToolCalls && !gotFinalAnswer) break;
    }

    // Post-processing (only for non-ephemeral modes)
    if (this.mode !== "chat" && this.mode !== "fullai") {
      try { this.memory.writeReadme(); } catch {}
    }

    // Always ensure run.sh exists in project modes
    if (this.mode === "fullstack" || this.mode === "mobiledev" || this.mode === "infra") {
      this._ensureRunScript();
    }

    // Auto-start dev server in fullstack mode if files were created this turn
    if (this.mode === "fullstack" && this._filesCreated > 0) {
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

        const rel = path.relative(this.workDir, fp);

        // ── Completed file guard: block full rewrites of stable files ────────
        if (fs.existsSync(fp) && this.memory.isFileComplete(fp)) {
          renderer.agentLog("file", "warn",
            `${rel}  ${C.grey}SKIPPED — file is completed. Use edit_file for targeted changes.${C.reset}`);
          return null;
        }

        const dir = path.dirname(fp);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
          renderer.agentLog("file", "create",
            `mkdir ${path.relative(this.workDir, dir) || "."}/`);
        }

        const content = params.content || "";
        fs.writeFileSync(fp, content, { encoding: "utf8", mode: 0o644 });

        const ext  = path.extname(fp).slice(1).toLowerCase();
        const lang = {
          js: "JavaScript", ts: "TypeScript", kt: "Kotlin", java: "Java",
          py: "Python", html: "HTML", css: "CSS", json: "JSON",
          xml: "XML", gradle: "Gradle", sh: "Shell", md: "Markdown",
          txt: "Text", properties: "Properties",
        }[ext] || ext.toUpperCase() || "file";

        renderer.agentLog("file", "create", `${rel}  ${C.grey}(${lang}, ${content.split("\n").length} lines)${C.reset}`);
        this.memory.logAction("file", "create", rel);
        this.memory.registerFile(fp, `${lang} — ${path.basename(fp)}`, lang);
        // Auto-mark as completed so future AI turns can't blindly rewrite it
        this.memory.markFileComplete(fp);
        this._filesCreated++;

        // Extract port from server files for auto-run
        if ((ext === "js") && (rel === "server.js" || rel === "index.js" || rel === "app.js")) {
          const portMatch = content.match(/PORT\s*=\s*(?:process\.env\.PORT\s*\|\|\s*)?(\d{4,5})/);
          if (portMatch) this._devPort = parseInt(portMatch[1]);
        }

        const codeExts = new Set(["js","ts","kt","java","py","html","css","json","xml","gradle","sh","txt","md","properties"]);
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
          renderer.agentLog("file", "warn", `edit_file: "${params.path}" not found — creating it`);
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
              `${rel}  ${C.grey}find-replace (${params.find.slice(0, 30)})${C.reset}`);
          } else {
            renderer.agentLog("file", "warn", `edit_file: find text not found in ${rel}`);
          }
        } else if (params.line) {
          const lines  = content.split(/\r?\n/);
          const lineNo = parseInt(params.line);
          if (lineNo >= 1 && lineNo <= lines.length) {
            lines[lineNo - 1] = params.content || "";
            fs.writeFileSync(fp, lines.join("\n"), "utf8");
            renderer.agentLog("file", "edit",
              `${rel}  ${C.grey}line ${lineNo}${C.reset}`);
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
          fs.writeFileSync(fp, params.content, "utf8");
          renderer.agentLog("file", "edit", `${rel}  ${C.grey}(full rewrite)${C.reset}`);
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
        renderer.agentLog("file", "edit",
          `${path.relative(this.workDir, fp)}  ${C.grey}(appended)${C.reset}`);
        this.memory.logAction("file", "append", path.relative(this.workDir, fp));
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

        const cwd    = params.cwd
          ? (path.isAbsolute(params.cwd) ? params.cwd : path.resolve(this.workDir, params.cwd))
          : this.workDir;
        const args   = Array.isArray(params.args) ? params.args : [];
        const cmdStr = `${params.cmd} ${args.join(" ")}`.trim();

        // If marked as background — hand off to _ensureDevServer instead
        if (params.background) {
          renderer.agentLog("infra", "info",
            `Server start queued: ${cmdStr}  ${C.grey}(will auto-start)${C.reset}`);
          return null;
        }

        renderer.agentLog("system", "run", cmdStr);

        const result = await this.healer.run(
          params.cmd, args, cwd,
          params.timeout_ms || 300000
        );

        if (result.success) {
          renderer.agentLog("system", "ok",
            `${cmdStr}  ${C.grey}exited 0${C.reset}`);
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
        const dest = params.dest ? this._resolvePath(params.dest) || this.workDir : this.workDir;
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
            `Run commands: ${(params.commands || []).join(", ")}`);
        }
        return null;
      }

      // ── ask_user ──────────────────────────────────────────────────────────
      case "ask_user": {
        const q = params.question || "Please clarify:";
        renderer.aiMessage(q, this.provider);
        return q;
      }

      // ── deploy_app ────────────────────────────────────────────────────────
      case "deploy_app": {
        renderer.agentLog("infra", "deploy",
          `Deploying: ${params.appName || "app"} on :${params.port || 3000}`);
        const infra = new InfrastructureAgent();
        await infra.run([
          "deploy",
          "--port",  String(params.port  || 3000),
          "--name",  params.appName || "zerathapp",
          "--dir",   params.dir    || this.workDir,
        ]);
        return null;
      }

      // ── start_tunnel ──────────────────────────────────────────────────────
      case "start_tunnel": {
        renderer.agentLog("tunnel", "tunnel",
          `Cloudflare tunnel → :${params.port || 3000}`);
        const infra = new InfrastructureAgent();
        await infra.run(["tunnel", "--port", String(params.port || 3000)]);
        return null;
      }

      // ── security_scan ─────────────────────────────────────────────────────
      case "security_scan": {
        const dir = params.dir || this.workDir;
        renderer.agentLog("security", "scan", `Scanning: ${dir}`);
        const sec = new SecurityAgent();
        await sec.run(["scan", dir]);
        this.memory.logAction("security", "scan", dir);
        return null;
      }

      // ── run_tests ─────────────────────────────────────────────────────────
      case "run_tests": {
        renderer.agentLog("qa", "run", `Tests in: ${this.workDir}`);
        const qa = new QAAgent();
        await qa.run(["test", this.workDir]);
        return null;
      }

      // ── notify ────────────────────────────────────────────────────────────
      case "notify": {
        const asst = new AssistantAgent();
        await asst.run(["notify", params.title || "ZerathCode", params.content || ""]);
        return null;
      }

      default:
        renderer.agentLog("system", "warn", `Unknown step action: "${action}" — skipping`);
        return null;
    }
  }

  // ── Auto dev server for fullstack mode ─────────────────────────────────────
  async _ensureDevServer() {
    // If already running, skip
    if (this._devServer) {
      renderer.agentLog("infra", "info",
        `Dev server already running on :${this._devPort}`);
      return;
    }

    // Find entry point
    const candidates = ["server.js", "index.js", "app.js"]
      .map(f => path.join(this.workDir, f));
    const main = candidates.find(f => fs.existsSync(f));
    if (!main) return;

    // Decide start command
    const pkgFile = path.join(this.workDir, "package.json");
    let cmd  = "node";
    let args = [path.basename(main)];

    if (fs.existsSync(pkgFile)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
        if (pkg.scripts?.start) { cmd = "npm"; args = ["start"]; }
      } catch {}
    }

    renderer.agentLog("infra", "run",
      `Starting dev server: ${cmd} ${args.join(" ")}  ${C.grey}(port ${this._devPort})${C.reset}`);

    this._devServer = spawn(cmd, args, {
      cwd:   this.workDir,
      env:   { ...process.env, PORT: String(this._devPort) },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let linesShown = 0;
    const onOut = (chunk) => {
      if (linesShown >= 6) return;
      chunk.toString().split("\n").filter(Boolean).forEach((l) => {
        if (linesShown++ < 6) renderer.agentLog("infra", "ok", l.trim().slice(0, 80));
      });
    };
    this._devServer.stdout.on("data", onOut);
    this._devServer.stderr.on("data", onOut);

    this._devServer.on("close", (code) => {
      renderer.agentLog("infra", code === 0 ? "ok" : "warn",
        `Dev server exited (code ${code})`);
      this._devServer = null;
    });

    // Let it breathe for 1.5s before showing the URL
    await new Promise(r => setTimeout(r, 1500));

    console.log(
      `\n  ${C.bgreen}▶${C.reset}  App running at ` +
      `${C.bcyan}http://localhost:${this._devPort}${C.reset}\n`
    );
  }

  // ── Build system prompt ────────────────────────────────────────────────────
  _buildSystemPrompt() {
    const base    = SYSTEM_PROMPTS[this.mode] || SYSTEM_PROMPTS.chat;
    const context = this.memory.buildContextBlock();
    const completed = this.memory.getCompletedFiles();
    const completedRule = completed.length
      ? `\n\nCOMPLETED FILES — CRITICAL RULE:\nThese files are stable. You MUST NOT use create_file on them.\nUse ONLY edit_file with find/replace for targeted changes:\n${completed.map(f => `  ✓ ${f}`).join("\n")}`
      : "";
    return (
      base + "\n\n" + context + completedRule +
      "\n\nFINAL REMINDER: Your ENTIRE response must be a valid JSON array." +
      " Start with [ and end with ]. No text outside the array."
    );
  }

  // ── Build prompt with recent history ──────────────────────────────────────
  _buildPrompt(userInput) {
    const history = this.memory.getHistory(8);
    if (history.length <= 1) return userInput;
    const histText = history
      .slice(0, -1)
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");
    return `${histText}\n\nUser: ${userInput}`;
  }

  // ── Build prompt injecting web/tool results back to the model ─────────────
  // Called on loop 2+ in chat mode after tool calls return results.
  _buildPromptWithResults(userInput, toolResults) {
    const history = this.memory.getHistory(6);
    let histText = "";
    if (history.length > 1) {
      histText = history
        .slice(0, -1)
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
        .join("\n\n") + "\n\n";
    }

    const resultsBlock = toolResults
      .map((r, i) =>
        `[WEB RESULTS ${i + 1}] Source: ${r.url}\n${r.content}`
      )
      .join("\n\n---\n\n");

    return (
      histText +
      `User: ${userInput}\n\n` +
      `[WEB RESULTS — use these to answer the user's question directly]\n\n` +
      resultsBlock +
      `\n\n[END WEB RESULTS]\n\n` +
      `Now provide a complete, direct answer using the web results above. ` +
      `Return a JSON array with a "message" action containing your answer.`
    );
  }

  // ── Parse AI response into step array ──────────────────────────────────────
  _parseSteps(raw) {
    if (!raw || typeof raw !== "string") return null;
    let str = raw.trim();

    // Strip markdown fences
    const fence = str.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) str = fence[1].trim();

    // Find outermost array
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

  // ── Resolve path within workDir ────────────────────────────────────────────
  _resolvePath(rawPath) {
    if (!rawPath) return null;
    try {
      const abs = rawPath.startsWith("/")
        ? rawPath
        : path.resolve(this.workDir, rawPath);
      if (!abs.startsWith(this.workDir)) {
        renderer.agentLog("file", "warn",
          `Path "${rawPath}" escapes project dir — blocked`);
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