# ZerathCode v2.0
### Multi-Agent AI Dev System for Termux / Android
**Author: sanaX3065 | Enhanced RAG Pipeline: March 2026**

---

## 🎯 **What's New in v2.0: RAG Pipeline Overhaul**

ZerathCode v2.0 includes a **comprehensive RAG (Retrieval-Augmented Generation) engine upgrade**:

✅ **Semantic retrieval** (vs keyword-only)  
✅ **Intelligent query decomposition** (vs heuristics)  
✅ **Source credibility ranking** (vs treating all equal)  
✅ **Grounding enforcement** (no hallucinations)  
✅ **Confidence scoring** (knows when data insufficient)  
✅ **Proper HTML structure** (vs regex stripping)  
✅ **Intermediate reasoning layer** (vs direct retrieval→answer)  
✅ **12 sources** instead of 5 (better diversity)  

**[→ See DELIVERABLES.md for complete list]**

---

## Table of Contents

1. [What is ZerathCode?](#what-is-zerathcode)
2. [What's New in v2.0](#whats-new-in-v20-rag-pipeline-overhaul)
3. [Installation](#installation)
4. [Quick Start](#quick-start)
5. [Documentation](#documentation)
6. [Full File Map — What Every File Does](#full-file-map)
7. [How the CLI Works](#how-the-cli-works)
8. [How the REPL Works](#how-the-repl-works)
9. [How the Orchestrator Works](#how-the-orchestrator-works)
10. [How Agents Work](#how-agents-work)
11. [How to Wire a New Agent](#how-to-wire-a-new-agent)
12. [API Key Management](#api-key-management)
13. [Memory System](#memory-system)
14. [Self-Healing Agent](#self-healing-agent)
15. [System Monitor](#system-monitor)
16. [Environment Variables](#environment-variables)
17. [Troubleshooting](#troubleshooting)
18. [Architecture Diagram](#architecture-diagram)

---

## Documentation (v2.0)

📄 **[DELIVERABLES.md](./DELIVERABLES.md)** — Complete v2.0 overhaul summary  
📄 **[PIPELINE_IMPROVEMENTS.md](./PIPELINE_IMPROVEMENTS.md)** — Detailed architecture improvements  
📄 **[FIX_SUMMARY.md](./FIX_SUMMARY.md)** — What was fixed and why  
📄 **[INSTALL_UPGRADE.md](./INSTALL_UPGRADE.md)** — Installation & upgrade guide  
📄 **[QUICK_REFERENCE.md](./QUICK_REFERENCE.md)** — v1.x to v2.0 comparison  

---

## What is ZerathCode?

ZerathCode is a **zero-dependency AI dev system** that runs entirely inside Termux on Android. It gives you a terminal interface where you describe what you want to build, and the AI agent creates the files, runs the commands, fixes errors automatically, and starts your app — all without leaving your phone.

It supports three AI providers (Claude, Gemini, GPT) and four modes:

| Mode | What it does |
|---|---|
| 💬 Chat | Ask coding questions, get code snippets (now with grounded answers!) |
| 🌐 Full Stack | Build complete Node.js + HTML/CSS/JS web apps |
| 📱 Mobile Dev | Build Android APKs with Kotlin + Gradle |
| 🚀 Infrastructure | Deploy apps with PM2 + Cloudflare tunnel |

---

## Installation

### Prerequisites

```bash
# Required
pkg install nodejs git

# For Mobile Dev mode
pkg install openjdk-17

# Optional but recommended
pkg install termux-api   # for notifications, battery, TTS
pkg install cloudflared  # for public URLs
# PM2 and nginx via npm if you want infra mode
```

### Install ZerathCode

```bash
# 1. Copy zerathcode folder to your Termux home
cp -r zerathcode ~/zerathcode

# 2. Run the installer
cd ~/zerathcode
bash install.sh

# 3. Reload your shell
source ~/.bashrc

# 4. Add at least one API key
zerath keys add gemini   AIzaSy-...
zerath keys add claude   sk-ant-api03-...
zerath keys add gpt      sk-proj-...

# 5. Launch
zerath run
```

The installer creates a `zerath` symlink in `~/.local/bin` and ensures that directory is in your PATH.

---

## Quick Start

```bash
zerath run
```

You will see:
1. **Provider selection** — choose which AI to use (only shows providers with keys stored)
2. **Mode selection** — Chat, Full Stack, Mobile Dev, or Infrastructure
3. **Project selection** — create a new project or resume an existing one
4. **REPL** — type your request and press Enter

**Example session (Full Stack):**
```
YOU ─────────────────────────────────────
│  Build me a todo app with Node.js, Express, and SQLite

[AI] Thinking with gemini…

📋 EXECUTION PLAN
  01. Create package.json
  02. Create server.js with Express + SQLite
  03. Create public/index.html
  04. Create public/style.css
  05. Create public/app.js
  06. npm install
  07. Start server

[FILE] ✚ package.json (JSON)
[FILE] ✚ server.js (JavaScript)
...
[INFRA] ▶ Starting dev server: node server.js (port 3000)
[INFRA] ✔ Server on http://localhost:3000

▶  App running at http://localhost:3000
```

**REPL Commands:**

| Command | What it does |
|---|---|
| `/memory` | Show project memory snapshot |
| `/files` | List tracked files |
| `/projects` | List all projects in workspace |
| `/history` | Show conversation history |
| `/readme` | Write README.md to project dir |
| `/save` | Export memory snapshot to JSON |
| `/mode` | Switch mode mid-session |
| `/clear` | Clear terminal |
| `/monitor` | Show battery + CPU temp |
| `/security` | Scan project for hardcoded secrets |
| `/deploy` | PM2 + Nginx + Cloudflare tunnel |
| `/tunnel` | Cloudflare tunnel only |
| `/notify` | Send device notification |
| `exit` | Save memory and quit |

---

## Full File Map

```
zerathcode/
├── bin/
│   └── zerathcode.js          CLI entry point
├── install.sh                 One-shot Termux installer
├── package.json               Project manifest (zero runtime npm deps)
├── README.md                  This file
└── src/
    ├── ui/
    │   └── renderer.js        Terminal UI — all ANSI colour output
    ├── core/
    │   ├── repl.js            Interactive REPL loop (the main interface)
    │   ├── orchestrator.js    Step executor — parses AI JSON → runs steps
    │   ├── agentManager.js    CLI dispatch — routes `zerath <agent>` commands
    │   ├── apiKeyManager.js   Multi-provider key storage + rotation
    │   ├── memoryManager.js   Per-project memory (history, files, notes)
    │   ├── workspaceManager.js  ~/hex-workspace/ project index
    │   ├── selfHealingAgent.js  Build error → AI fix → retry loop
    │   ├── sandboxManager.js    Path traversal protection
    │   ├── permissionManager.js ~/.zerathcode/grants.json
    │   └── systemMonitor.js     Thermal + battery guard (Termux:API)
    ├── agents/
    │   ├── baseAgent.js       Abstract base class all agents extend
    │   ├── fileAgent.js       File CRUD (`zerath file ...`)
    │   ├── gitAgent.js        Git operations (`zerath git ...`)
    │   ├── webAgent.js        Web fetch/scrape (`zerath web ...`)
    │   ├── androidAgent.js    APK builder (`zerath android ...`)
    │   ├── infrastructureAgent.js  PM2 + Nginx + Cloudflare
    │   ├── securityAgent.js   13-pattern secret scanner
    │   ├── qaAgent.js         npm/gradle test runner + debug loop
    │   └── assistantAgent.js  Termux:API (notify, TTS, SMS, battery)
    └── utils/
        ├── aiClient.js        Unified Claude/Gemini/GPT API client
        ├── fileWatcher.js     Debounced fs.watch (android `watch` cmd)
        ├── shell.js           spawn() wrappers + tool availability check
        ├── spinner.js         Terminal spinner for long operations
        ├── prompt.js          readline helpers (ask, confirm, secret, menu)
        └── logger.js          Levelled logger with ANSI colours
```

### What each file does in detail

#### `bin/zerathcode.js`
The CLI entry point. When you type `zerath run` or `zerath git clone ...`, Node runs this file first. It:
- Parses `process.argv` to determine the subcommand
- Loads `ApiKeyManager` and `AgentManager`
- For `zerath run` → launches the REPL
- For `zerath <agent> <command>` → calls `AgentManager.dispatch()`
- Catches top-level errors and prints them cleanly

#### `src/ui/renderer.js`
Every single coloured line you see in the terminal comes from here. It exports:
- `renderer.agentLog(category, type, message)` — the `[FILE] ✚ ...` lines
- `renderer.aiMessage(text, provider)` — the AI response box
- `renderer.planBlock(steps)` — the execution plan box
- `renderer.filePreview(name, content, maxLines)` — the code preview boxes
- `renderer.errorBox(title, message)` — red error boxes
- `renderer.userMessage(text)` — the `YOU ─────` box
- `C` — colour constants (C.grey, C.bcyan, C.bgreen, C.reset, etc.)

If you want to change how output looks, this is the only file you need to edit.

#### `src/core/repl.js`
The interactive loop. Flow:
1. Calls `WorkspaceManager` to let user pick or create a project
2. Calls `ApiKeyManager` to let user pick a provider
3. Creates an `Orchestrator` instance for the chosen mode + project
4. Opens a `readline` interface for line input
5. On each line: shows `YOU` box → passes text to `orchestrator.process()` → shows prompt again
6. Handles all `/commands` internally
7. On `exit` or SIGINT: calls `orchestrator.shutdown()` then `memory.save()`

#### `src/core/orchestrator.js`
The brain. For each user message it:
1. Appends message to memory history
2. Builds the system prompt (mode template + project context from memory)
3. Calls `AiClient.ask()` to get the AI response
4. Parses the response as a JSON step array
5. Loops through each step and calls the appropriate handler
6. For `create_file`: writes to disk, extracts port if it's a server file
7. For `run_command` without `background:true`: runs through `SelfHealingAgent`
8. For `run_command` with `background:true`: skips, queues for `_ensureDevServer`
9. After all steps: in fullstack mode, auto-starts the dev server if files were created
10. Kills dev server on `shutdown()` (called by REPL on exit)

Step types supported: `plan`, `message`, `create_file`, `edit_file`, `append_file`, `delete_file`, `read_file`, `run_command`, `web_fetch`, `git_clone`, `memory_note`, `set_run_commands`, `ask_user`, `deploy_app`, `start_tunnel`, `security_scan`, `run_tests`, `notify`

#### `src/core/agentManager.js`
Routes direct CLI commands like `zerath file create foo.txt`. It:
- Maps command names (`file`, `git`, `web`, `android`, etc.) to agent classes
- Instantiates the agent with `{ permManager, keyManager }` services
- Calls `agent.run(args)` with the remaining argv

#### `src/core/apiKeyManager.js`
Stores keys in `~/.zerathcode/keys.json` (chmod 600). Features:
- Multiple keys per provider (round-robin rotation on rate limits)
- Auto-rotation on 429/401/403 HTTP errors
- Falls back to env vars: `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`

#### `src/core/memoryManager.js`
Per-project memory stored at `<project>/.zerathcode/memory.json`. Tracks:
- Conversation history (last N messages)
- File registry (path → description + language)
- Action log (what was done when)
- Notes (important facts the AI wants to remember)
- Run commands (how to start the project)
- Error log

Also writes a human-readable `README.md` to the project root after each turn.

#### `src/core/workspaceManager.js`
Manages `~/hex-workspace/` — the single root for all projects. Uses a global index at `~/hex-workspace/.index.json`. Each project entry has: `name`, `slug`, `stack`, `description`, `createdAt`, `lastUsed`, `provider`.

#### `src/core/selfHealingAgent.js`
When a `run_command` step fails, this agent:
1. Captures stdout + stderr of the failed command
2. Sends the error to the AI: "here is the error, fix the code"
3. Applies the AI's fix (edits files, rewrites package.json, etc.)
4. Retries the command (max 3 attempts by default)

This is why you see `[SYSTEM] ✖ Exit 1 → [AI] 📋 Analysing error → [SYSTEM] ▶ retry` in the logs.

#### `src/core/sandboxManager.js`
Prevents path traversal. When an agent resolves a path, it ensures the result stays within `~/hex-workspace/` (or the current project dir). External paths require explicit permission from `PermissionManager`.

#### `src/core/permissionManager.js`
Stores user-granted access to external directories in `~/.zerathcode/grants.json`. If an agent tries to access a path outside the sandbox, it prompts: "Allow access to /sdcard/...? [y/N]". The answer is remembered for the session.

#### `src/core/systemMonitor.js`
Uses `termux-battery-status` and `termux-sensor` (Termux:API) to monitor:
- Battery: warn below 20%, stop below 10%
- CPU temperature: pause heavy agents above 42°C, stop all above 45°C

Falls back gracefully if Termux:API is not installed.

#### `src/agents/baseAgent.js`
Abstract base class. All CLI agents extend this and get:
- `this.permManager` — PermissionManager instance
- `this.keyManager` — ApiKeyManager instance
- `this.sandbox` — SandboxManager instance
- `this.log` — Logger instance
- `this.safePath(rawPath)` — resolve + permission-check a path
- `this.usageError(usage)` — print usage and exit

Every agent must implement `async run(args)`.

#### `src/utils/aiClient.js`
Unified API client for all three providers. `aiClient.ask(provider, prompt, opts)` handles:
- Building the correct request body per provider
- Managing API key rotation on errors
- Streaming is not used — waits for full response
- Returns the text content as a string

#### `src/utils/fileWatcher.js`
A debounced recursive file watcher built on Node's `fs.watch`. Used by `zerath android watch` to rebuild the APK automatically when source files change. Emits `change` events with `{ event, filename, path }`.

#### `src/utils/shell.js`
Safe wrappers around `child_process`. Key exports:
- `shell.run(cmd, args, opts)` — spawn + stream output, rejects on non-zero exit
- `shell.isAvailable(tool)` — checks if a CLI tool is in PATH
- `shell.requireTool(tool, installCmd)` — throws a friendly error if missing

#### `src/utils/logger.js`
Singleton logger. Levels: DEBUG, INFO, WARN, ERROR. Enable debug with `ZERATH_DEBUG=1`. Methods: `log.success()`, `log.fail()`, `log.note()`, `log.warn()`, `log.divider()`.

---

## How the CLI Works

When you type `zerath <command>`, Node runs `bin/zerathcode.js` with `process.argv`.

```
zerath run                     → repl.start()
zerath keys add claude sk-...  → apiKeyManager.addKey("claude", "sk-...")
zerath keys list               → apiKeyManager.listKeys()
zerath android build           → androidAgent.run(["build"])
zerath file create foo.txt hi  → fileAgent.run(["create", "foo.txt", "hi"])
zerath git clone <url>         → gitAgent.run(["clone", "<url>"])
zerath web fetch <url>         → webAgent.run(["fetch", "<url>"])
zerath infra deploy --port 3000 --name app --dir .
zerath security scan [dir]
zerath qa test [dir]
zerath assistant notify "Title" "Body"
zerath monitor
```

The dispatch happens in `agentManager.js`:

```javascript
const AGENT_MAP = {
  file:      FileAgent,
  git:       GitAgent,
  web:       WebAgent,
  android:   AndroidAgent,
  infra:     InfrastructureAgent,
  security:  SecurityAgent,
  qa:        QAAgent,
  assistant: AssistantAgent,
};

const AgentClass = AGENT_MAP[command];
const agent = new AgentClass({ permManager, keyManager });
await agent.run(args);
```

---

## How the REPL Works

```
zerath run
  │
  ├─ ApiKeyManager.getStoredProviders()    → show only providers with keys
  ├─ User picks provider
  ├─ User picks mode (Chat/FullStack/MobileDev/Infra)
  ├─ WorkspaceManager.listProjects()       → show existing projects
  ├─ User picks project or creates new
  ├─ MemoryManager.load(projectDir)        → load existing context
  ├─ Orchestrator.new({ provider, mode, memory, workDir })
  │
  └─ readline loop
       │
       ├─ show prompt "❯❯"
       ├─ wait for user line
       ├─ if /command → handle internally
       └─ else → orchestrator.process(line)
                  │
                  ├─ AI call
                  ├─ parse steps
                  ├─ execute steps
                  └─ auto-start dev server if fullstack
```

---

## How the Orchestrator Works

The orchestrator is the connection between the AI and the filesystem. Here's the exact flow for a fullstack request:

```
User: "build a todo app with SQLite"
         │
         ▼
orchestrator.process(userInput)
  │
  ├─ memory.addUserMessage(userInput)
  ├─ systemPrompt = SYSTEM_PROMPTS[mode] + memory.buildContextBlock()
  ├─ prompt = last 8 history messages + userInput
  │
  ├─ ai.ask(provider, prompt, { systemPrompt }) → raw JSON string
  │
  ├─ _parseSteps(raw)
  │    ├─ strip markdown fences if present
  │    ├─ find outermost [ ... ]
  │    └─ JSON.parse → array of { action, params }
  │
  ├─ for each step:
  │    ├─ "plan"        → renderer.planBlock(steps)
  │    ├─ "create_file" → fs.writeFileSync + track _filesCreated + extract port
  │    ├─ "run_command" → if background: queue; else: healer.run()
  │    ├─ "memory_note" → memory.addNote()
  │    └─ ... (all 18 step types)
  │
  ├─ memory.writeReadme()
  │
  └─ if fullstack && _filesCreated > 0:
       _ensureDevServer()
         ├─ find server.js / index.js / app.js
         ├─ spawn("node", ["server.js"], { env: { PORT: this._devPort } })
         ├─ stream first 6 lines of output
         └─ print "▶ App running at http://localhost:PORT"
```

### System Prompt Design

The key insight for Gemini compatibility: the system prompt must include a **complete, filled-in JSON example** that the model copies and fills in. Vague instructions like "respond with JSON" cause Gemini to return summaries in plain text.

Each mode prompt ends with:
```
FINAL REMINDER: Your ENTIRE response must be a valid JSON array.
Start with [ and end with ]. No text outside the array.
```

---

## How Agents Work

Every agent (for CLI use) extends `BaseAgent`:

```javascript
// src/agents/myAgent.js
const BaseAgent = require("./baseAgent");

class MyAgent extends BaseAgent {
  async run(args) {
    const command = args[0];
    switch (command) {
      case "hello": return this._hello(args.slice(1));
      default:
        this.log.fail(`Unknown command: ${command}`);
        process.exit(1);
    }
  }

  async _hello(args) {
    const name = args[0] || "world";
    this.log.success(`Hello, ${name}!`);
  }
}

module.exports = MyAgent;
```

Agents used by the **orchestrator** (inside REPL sessions) are simpler — they just need a `run(args)` method because they're instantiated directly with `new AgentClass()`:

```javascript
case "security_scan": {
  const sec = new SecurityAgent();
  await sec.run(["scan", dir]);
  break;
}
```

---

## How to Wire a New Agent

Let's say you want to add a `database` agent with `zerath database init` and `zerath database query`.

### Step 1 — Create the agent file

```javascript
// src/agents/databaseAgent.js
"use strict";

const BaseAgent = require("./baseAgent");
const shell     = require("../utils/shell");
const fs        = require("fs");
const path      = require("path");

class DatabaseAgent extends BaseAgent {
  async run(args) {
    const command = args[0];
    if (!command) { this._help(); return; }

    switch (command.toLowerCase()) {
      case "init":  return this._init(args.slice(1));
      case "query": return this._query(args.slice(1));
      default:
        this.log.fail(`Unknown database command: "${command}"`);
        this._help();
        process.exit(1);
    }
  }

  async _init(args) {
    // args[0] = db file path (optional)
    const dbPath  = args[0] || "database.sqlite";
    const resolved = await this.safePath(dbPath);  // sandbox + permission check

    if (fs.existsSync(resolved)) {
      this.log.note(`Database already exists: ${resolved}`);
      return;
    }

    // Use sqlite3 CLI if available
    shell.requireTool("sqlite3", "pkg install sqlite");
    await shell.run("sqlite3", [resolved, ".databases"]);
    this.log.success(`Created database: ${path.basename(resolved)}`);
  }

  async _query(args) {
    const dbPath = await this.safePath(args[0] || "database.sqlite");
    const sql    = args.slice(1).join(" ");
    if (!sql) this.usageError("zerath database query <db> <sql>");

    shell.requireTool("sqlite3", "pkg install sqlite");
    await shell.run("sqlite3", [dbPath, sql]);
  }

  _help() {
    console.log(`
\x1b[36mDatabase Agent Commands:\x1b[0m
  zerath database init [db.sqlite]
  zerath database query <db.sqlite> <SQL>
`);
  }
}

module.exports = DatabaseAgent;
```

### Step 2 — Register in agentManager.js

Open `src/core/agentManager.js`. Find the `AGENT_MAP` object and add your agent:

```javascript
// At the top of the file, add:
const DatabaseAgent = require("../agents/databaseAgent");

// In the AGENT_MAP:
const AGENT_MAP = {
  file:      FileAgent,
  git:       GitAgent,
  web:       WebAgent,
  android:   AndroidAgent,
  infra:     InfrastructureAgent,
  security:  SecurityAgent,
  qa:        QAAgent,
  assistant: AssistantAgent,
  database:  DatabaseAgent,   // ← add this
};
```

### Step 3 — Add CLI docs in bin/zerathcode.js

Find the `_showHelp()` or help text block and add:
```
  zerath database init [db.sqlite]     Init SQLite database
  zerath database query <db> <SQL>     Run SQL query
```

### Step 4 — (Optional) Add orchestrator step type

If you want the AI to be able to call your agent from inside the REPL, add a step handler in `orchestrator.js`:

```javascript
// At the top of orchestrator.js:
const DatabaseAgent = require("../agents/databaseAgent");

// Inside _executeStep():
case "database_init": {
  const db = new DatabaseAgent();
  await db.run(["init", params.dbPath || "database.sqlite"]);
  return null;
}
```

Then add `database_init` to the AVAILABLE ACTIONS section of the mode system prompts so the AI knows it exists.

### Step 5 — Test

```bash
zerath database init myapp.sqlite
zerath database query myapp.sqlite "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);"
zerath database query myapp.sqlite "INSERT INTO users (name) VALUES ('prasanna');"
zerath database query myapp.sqlite "SELECT * FROM users;"
```

---

## API Key Management

Keys are stored at `~/.zerathcode/keys.json` with `chmod 600`:

```json
{
  "gemini": ["AIzaSy-key1", "AIzaSy-key2"],
  "claude": ["sk-ant-api03-..."],
  "gpt":    ["sk-proj-..."]
}
```

**Commands:**
```bash
zerath keys add claude sk-ant-api03-...    # Add a key
zerath keys list                           # List all stored providers
zerath keys remove claude                  # Remove all keys for provider
```

**Env var fallback** (if no stored keys):
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `OPENAI_API_KEY`

**Auto-rotation:** If an API call returns 429 (rate limit), 401, or 403, the client automatically tries the next key for that provider. If all keys fail, it throws an error with a clear message.

---

## Memory System

Each project has its own memory at `<project>/.zerathcode/memory.json`.

### What gets remembered

| Category | What | Where used |
|---|---|---|
| History | Last 20 user+AI messages | Context window for next prompt |
| Files | All created files + language | `/files` command, README |
| Notes | `memory_note` step content | Context for next prompt |
| Actions | What was done + when | Debug, README timeline |
| Errors | Failed commands + output | Self-healer diagnosis |
| Run commands | How to start the project | README, infra agent |

### Context block injected into every prompt

```
=== PROJECT CONTEXT ===
Project: vicchat
Stack: React+vite+nodejs
Notes: Built todo app with Express + vanilla JS

Files:
  - package.json (JSON)
  - server.js (JavaScript)
  - public/index.html (HTML)
  - public/app.js (JavaScript)

Recent actions:
  [file/create] server.js
  [file/create] public/index.html
  [system/run] npm install
=== END CONTEXT ===
```

This is why the AI can say "I see you already have a server.js, let me add a new route to it" instead of recreating everything from scratch.

### Memory commands in REPL
```
/memory    → print current memory snapshot
/files     → list all tracked files
/save      → export memory to <project>.memory.json
/readme    → force-write README.md to project dir
```

---

## Self-Healing Agent

When a `run_command` step exits non-zero, the self-healer activates:

```
[SYSTEM] ▶  npm install  (attempt 1/3)
npm error code 1
npm error path .../sqlite3
...
[SYSTEM] ✖  Exit 1: ModuleNotFoundError: No module named 'distutils'
[AI]     📋 Analysing error and generating fix…
[SYSTEM] ℹ  Fix: sqlite3 needs prebuilt binaries — switching to better-sqlite3
[FILE]   ✎  package.json  (full replace)
[SYSTEM] 📦 [heal] npm install
[SYSTEM] ✖  Exit 1  ...
[SYSTEM] ▶  npm install  (attempt 2/3)
...
[SYSTEM] ✔  npm install  ✔ done
```

The healer sends this to the AI:
```
Command failed: npm install
Error output: <stderr here>

Current package.json:
<file content>

Fix the code and tell me exactly what to change.
Respond with a JSON array of edit_file or run_command steps.
```

The AI replies with fix steps, they get applied, and the command retries. Max 3 attempts by default. After 3 failures it prints "Max healing attempts reached — manual fix needed."

**What the healer can fix:**
- Wrong package versions (`sqlite3` → `better-sqlite3` for ARM/Termux)
- Missing dependencies (adds them to package.json)
- Gradle version mismatches
- Missing Python modules for node-gyp

**What it cannot fix:**
- Network errors (npm registry down)
- Corrupt node_modules (needs `rm -rf node_modules` — blocked by sandbox)
- Missing system tools (`openjdk not installed`)

---

## System Monitor

The system monitor runs in the background during REPL sessions. It polls every 30 seconds using Termux:API:

```bash
termux-battery-status   # JSON: { percentage, status, temperature }
termux-sensor -s "CPU Temperature"  # float degrees C
```

**Thresholds:**
| Condition | Action |
|---|---|
| Battery < 20% | Warning printed in REPL |
| Battery < 10% | All AI calls paused |
| CPU temp > 42°C | Warning, heavy agents paused |
| CPU temp > 45°C | All agents stopped |

If Termux:API is not installed, the monitor starts but all checks return `null` and no warnings fire.

**Manual check:** type `/monitor` in the REPL.

---

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `ZERATH_DEBUG` | Enable debug logging (verbose output) | off |
| `ANTHROPIC_API_KEY` | Claude API key fallback | none |
| `GEMINI_API_KEY` | Gemini API key fallback | none |
| `OPENAI_API_KEY` | GPT API key fallback | none |
| `PORT` | Override dev server port | 3000 |

Enable debug mode:
```bash
ZERATH_DEBUG=1 zerath run
```

---

## Troubleshooting

### "No API Keys Found"
```bash
zerath keys add gemini AIzaSy-...
```

### "vite not found" after fullstack build
The fullstack prompt explicitly forbids Vite builds (no npm-based bundlers in Termux). If the AI generates a Vite project anyway, just tell it:
```
fix it, don't use vite, use plain html/css/js in a public/ folder with node server.js
```

### sqlite3 fails to install on Termux
`sqlite3` (npm) requires native compilation via node-gyp which fails on Termux's Python 3.12 (no `distutils`). Solutions:
- Use `better-sqlite3` instead (self-healer usually catches this)
- Or use Node's built-in `fs` + a JSON file for small data
- Or tell the AI: "don't use sqlite3, use better-sqlite3"

### Gradle build hangs forever
```bash
# Kill it with Ctrl+C, then manually:
cd ~/hex-workspace/<yourproject>
./gradlew --stop
./gradlew assembleDebug --no-daemon
```

### Dev server auto-started but app isn't working
The orchestrator extracts port from `server.js` content. If your server uses a non-standard port variable, override manually:
```
PORT=8080 node server.js
```

### REPL shows garbled output (double lines)
This happens if your terminal emulator doesn't support the `\r\x1b[K` erase sequence. Try:
```bash
export TERM=xterm-256color
```

### `/deploy` fails — PM2 not found
```bash
npm install -g pm2
```

### Memory file corrupt
```bash
rm ~/hex-workspace/<project>/.zerathcode/memory.json
# Start fresh — history will be empty but files still exist
```

---

## Architecture Diagram

```
                            ┌──────────────────────────┐
    zerath run              │       bin/zerathcode.js   │
         │                  │   (CLI entry — arg parse) │
         └─────────────────▶│                          │
                            └──────────┬───────────────┘
                                       │
                            ┌──────────▼───────────────┐
                            │       core/repl.js        │
                            │  (readline loop + REPL    │
                            │   commands + project pick)│
                            └──────────┬───────────────┘
                                       │ orchestrator.process()
                            ┌──────────▼───────────────┐
                            │   core/orchestrator.js    │
                            │  ┌─────────────────────┐ │
                            │  │ Build system prompt  │ │
                            │  │ + memory context     │ │
                            │  └────────┬────────────┘ │
                            │           │ ai.ask()      │
                            │  ┌────────▼────────────┐ │
                            │  │   utils/aiClient.js  │ │
                            │  │ Claude/Gemini/GPT    │ │
                            │  └────────┬────────────┘ │
                            │           │ JSON steps    │
                            │  ┌────────▼────────────┐ │
                            │  │   _executeStep()     │ │
                            │  │ create_file          │ │
                            │  │ run_command ─────────┼─┼──▶ SelfHealingAgent
                            │  │ deploy_app  ─────────┼─┼──▶ InfrastructureAgent
                            │  │ security_scan ───────┼─┼──▶ SecurityAgent
                            │  │ ...                  │ │
                            │  └──────────────────────┘ │
                            └──────────┬───────────────┘
                                       │
                          ┌────────────┼────────────┐
                          │            │            │
                  ┌───────▼──┐  ┌──────▼──┐  ┌─────▼──────┐
                  │MemoryMgr │  │Renderer │  │SandboxMgr  │
                  │(per-proj │  │(all ANSI│  │(path check)│
                  │ JSON)    │  │ output) │  │            │
                  └──────────┘  └─────────┘  └────────────┘


  zerath file/git/web/android/...
         │
         └──▶ core/agentManager.js
                    │
                    └──▶ agents/<name>Agent.js extends BaseAgent
                                 │
                                 ├── this.safePath()   → sandboxManager
                                 ├── this.log          → logger
                                 └── shell.run()       → child_process
```

---

## Building ZerathCode from Scratch — Step by Step

If you want to rebuild it yourself without the zip:

### 1. Project scaffold
```bash
mkdir zerathcode && cd zerathcode
npm init -y
mkdir -p bin src/{core,agents,utils,ui}
```

### 2. Set package.json bin
```json
{
  "name": "zerathcode",
  "version": "1.0.0",
  "bin": { "zerath": "./bin/zerathcode.js" }
}
```

### 3. Build order (dependencies flow downward)

```
1. src/utils/logger.js          (no deps)
2. src/utils/spinner.js         (no deps)
3. src/utils/prompt.js          (readline only)
4. src/utils/shell.js           (child_process only)
5. src/utils/fileWatcher.js     (fs only)
6. src/utils/aiClient.js        (needs apiKeyManager → build together)
7. src/core/sandboxManager.js   (path, os)
8. src/core/permissionManager.js (prompt, logger)
9. src/core/apiKeyManager.js    (prompt, logger, fs)
10. src/agents/baseAgent.js     (sandboxManager, logger)
11. src/agents/*.js             (baseAgent, shell, prompt)
12. src/core/memoryManager.js   (fs, path, logger)
13. src/core/workspaceManager.js (fs, path, memoryManager)
14. src/core/selfHealingAgent.js (shell, aiClient)
15. src/core/systemMonitor.js   (shell)
16. src/ui/renderer.js          (no deps)
17. src/core/orchestrator.js    (all agents, aiClient, memory, renderer)
18. src/core/agentManager.js    (all agents, apiKeyManager, permissionManager)
19. src/core/repl.js            (orchestrator, workspaceManager, memory, renderer)
20. bin/zerathcode.js           (repl, agentManager, apiKeyManager)
```

### 4. The most critical design decision

Every AI prompt must end with a complete, filled-in JSON example and a FINAL REMINDER. Without this, Gemini returns plain text or empty message steps 80% of the time. Claude is more forgiving but also benefits from the examples.

### 5. The self-healer contract

The healer's AI prompt must include the exact error output, the current file content, and strict instructions to respond with edit_file/run_command JSON steps only — not explanations. Otherwise the AI will write a paragraph explaining the problem instead of fixing it.

---

*ZerathCode v1.0 — Built by sanaX3065*
