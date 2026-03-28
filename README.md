# ZerathCode v1

> **ZerathCode — Multi-Agent AI Dev System for Termux**

ZerathCode v1 is a unified CLI tool providing interactive development workflows and autonomous agent commands.

- **Interactive REPL** (`zerath run`) — the interactive chat/project UI, memory system, self-healing agent, workspace manager
- **Multiple Agents** — infrastructure deployment, security scanning, system monitor, QA testing, Android builds

**All tools fully integrated.** Every workflow is production-ready and optimized for Termux.

---

## Key Features

| Feature | Status |
|---|---|
| Interactive REPL (`zerath run`) | ✓ |
| Provider selection menu | ✓ |
| Chat / Full Stack / Mobile Dev modes | ✓ |
| Project memory (`.zerathcode/memory.json`) | ✓ |
| README auto-generation | ✓ |
| Self-healing build agent | ✓ |
| `/memory /files /history /projects` | ✓ |
| `androidAgent` (APK builder) | ✓ |
| `fileAgent` `gitAgent` `webAgent` | ✓ |
| Multi-key API rotation (Claude/Gemini/GPT) | ✓ |
| Workspace manager (`~/hex-workspace/`) | ✓ |
| Infrastructure mode (Deploy/Nginx/PM2/Cloudflare) | ✓ |
| System monitor (battery + temperature guard) | ✓ |
| Security scanner (13 secret patterns) | ✓ |
| QA agent (npm test / gradle test / debug loop) | ✓ |
| Personal assistant (Termux:API notifications, TTS, SMS) | ✓ |
| `/monitor /security /deploy /tunnel /notify` REPL commands | ✓ |

---

## Folder Structure

```
zerathcode/
├── bin/
│   └── zerathcode.js          ← CLI entry (zerath run / zerath <agent>)
├── src/
│   ├── ui/
│   │   └── renderer.js        ← Terminal UI renderer
│   ├── core/
│   │   ├── repl.js            ← Interactive REPL
│   │   ├── orchestrator.js    ← Step execution engine
│   │   ├── agentManager.js    ← Agent registry
│   │   ├── apiKeyManager.js   ← API key management
│   │   ├── memoryManager.js   ← Project memory
│   │   ├── workspaceManager.js← Workspace management
│   │   ├── selfHealingAgent.js← Self-healing build agent
│   │   ├── sandboxManager.js  ← Sandbox execution
│   │   ├── permissionManager.js← Permission control
│   │   └── systemMonitor.js   ← Thermal + battery guard
│   ├── agents/
│   │   ├── androidAgent.js    ← Android APK builder
│   │   ├── fileAgent.js       ← File operations
│   │   ├── gitAgent.js        ← Git operations
│   │   ├── webAgent.js        ← Web fetching
│   │   ├── baseAgent.js       ← Base agent class
│   │   ├── infrastructureAgent.js ← PM2 + Nginx + Cloudflare
│   │   ├── securityAgent.js   ← Secret scanner
│   │   ├── qaAgent.js         ← Test runner + debug loop
│   │   └── assistantAgent.js  ← Termux:API
│   └── utils/
│       ├── aiClient.js        ← Claude / Gemini / GPT rotation
│       ├── shell.js           ← Shell execution
│       ├── spinner.js         ← Loading spinner
│       ├── prompt.js          ← User prompts
│       └── logger.js          ← Logging
├── install.sh
└── package.json
```

---

## Installation

```bash
# 1. Install Termux packages
pkg update -y
pkg install nodejs openjdk-17 git wget unzip

# 2. Optional (recommended)
pkg install termux-api cloudflared nginx android-tools

# 3. Run install script
bash install.sh

# 4. Reload shell
source ~/.bashrc
```

---

## Adding API Keys

```bash
zerath keys add claude   sk-ant-api03-...   # Anthropic Claude
zerath keys add gemini   AIzaSy-...         # Google Gemini
zerath keys add gpt      sk-proj-...        # OpenAI GPT

zerath keys list                            # See all keys
zerath keys rotate claude                   # Manually rotate key
```

Multiple keys per provider are supported. ZerathCode auto-rotates on rate-limit or auth error.

---

## Interactive REPL (Primary Mode)

```bash
zerath run
```

You will see:

```
SELECT AI PROVIDER
  [1]  🟣  Claude  (Anthropic)
  [2]  🔵  Gemini  (Google)
  [3]  🟢  GPT     (OpenAI)

SELECT MODE
  [1]  💬  Chat Mode          — ephemeral, no memory saved
  [2]  🌐  Full Stack Mode    — build web apps
  [3]  📱  Mobile Dev Mode    — build Android APKs
  [4]  🚀  Infrastructure Mode — deploy + tunnels    ← ZerathCode addition

❯❯
```

---

## REPL Meta-Commands

| Command | Action |
|---|---|
| `/memory` | Show project memory snapshot |
| `/files` | List tracked files |
| `/projects` | All projects across modes |
| `/history` | Conversation history |
| `/readme` | Write README.md to project dir |
| `/save` | Export memory to JSON |
| `/mode` | Switch mode in-session |
| `/clear` | Clear terminal |
| `/monitor` | Live battery + temperature panel |
| `/security` | Scan current project for secrets |
| `/deploy` | Deploy with PM2 + Nginx + Cloudflare tunnel |
| `/tunnel` | Start Cloudflare tunnel only |
| `/notify` | Send a device notification via Termux:API |
| `exit` | Save memory and quit |

---

## Direct Agent Commands

```bash
# ── Android Agent ─────────────────────────────────────────────────
zerath android init MyApp --kotlin --package com.example.myapp
zerath android build [--release]
zerath android install
zerath android check

# ── File Agent ────────────────────────────────────────────────────
zerath file create myfile.js
zerath file read myfile.js
zerath file append myfile.js

# ── Git Agent ─────────────────────────────────────────────────────
zerath git clone https://github.com/user/repo
zerath git pull
zerath git status

# ── Web Agent ─────────────────────────────────────────────────────
zerath web fetch https://example.com

# ── API Keys ──────────────────────────────────────────────────────
zerath keys add claude sk-ant-...
zerath keys list
zerath keys remove claude

# ── Infrastructure Agent ──────────────────────────────────────────
zerath infra deploy --port 3000
zerath infra deploy --port 3000 --name myapp --dir ~/hex-workspace/myapp
zerath infra tunnel --port 3000
zerath infra status
zerath infra stop --name myapp

# ── Security Agent ────────────────────────────────────────────────
zerath security scan [dir]
zerath security audit [dir]

# ── QA Agent ──────────────────────────────────────────────────────
zerath qa test [dir]
zerath qa lint [dir]
zerath qa debug [dir]
```

zerath assistant notify "Title" "Message"
zerath assistant battery
zerath assistant tts "Hello from ZerathCode"
zerath assistant vibrate 500
zerath assistant sms 20
zerath assistant location

zerath monitor        # Battery + temperature live panel
```

---

## Example Workflows

### 1. Chat with AI (ephemeral)
```
zerath run
→ Select provider: Claude
→ Select mode: Chat Mode
❯❯ How do I reverse a string in Kotlin?
```

### 2. Build a full-stack web app
```
zerath run
→ Select provider: GPT
→ Select mode: Full Stack Mode
→ New project: "todo-app"
→ Stack: Node.js + HTML + CSS

❯❯ Build a todo list app with localStorage and a REST API
```
ZerathCode will: plan → create all files → start the server → show preview.

### 3. Build an Android APK
```
zerath run
→ Mobile Dev Mode
→ New project: "Calculator"

❯❯ Build a scientific calculator Android app with dark theme
```
ZerathCode will: generate Kotlin files → create Gradle config → run assembleDebug → show install command.

### 4. Deploy and expose publicly
```bash
# After building your app:
zerath infra deploy --port 3000 --name myapp

# Output:
# ✔  PM2: myapp started on :3000
# ✔  Nginx: :8080 → :3000
# 🌐  https://abc123.trycloudflare.com
```

Or from inside the REPL:
```
❯❯ /deploy
  Port: 3000
# → deploys automatically
```

### 5. Security scan before deploying
```bash
zerath security scan ~/hex-workspace/myapp

# Or from REPL:
❯❯ /security
```

### 6. Resume a project from a previous session
```
zerath run
→ Full Stack Mode
→ Select existing: "todo-app"
→ Memory loaded: 3 files tracked, 12 actions recorded
❯❯ Add user authentication with JWT
```
ZerathCode picks up exactly where you left off.

---

## How the AI Orchestrator Works

Every user message goes through this flow:

```
User message
     │
     ▼
Orchestrator._buildSystemPrompt()  ← mode-specific rules + project memory
     │
     ▼
AI Provider (Claude / Gemini / GPT)
     │
     ▼
JSON step array:
  [
    { "action": "plan",        "params": { "steps": [...] } },
    { "action": "create_file", "params": { "path": "...", "content": "..." } },
    { "action": "run_command", "params": { "cmd": "node", "args": ["server.js"] } },
    { "action": "deploy_app",  "params": { "port": 3000 } },      ← ZerathCode
    { "action": "security_scan","params": { "dir": "." } },        ← ZerathCode
    { "action": "memory_note", "params": { "note": "Built X" } }
  ]
     │
     ▼
SelfHealingAgent (on run_command failure → AI fix → retry, up to 3×)
     │
     ▼
MemoryManager.writeReadme()  ← auto-updated on every turn
```

---

## System Monitor (Thermal Guard)

ZerathCode automatically monitors your device:

| Condition | Action |
|---|---|
| Temperature > 42°C | Pauses tasks, shows warning |
| Temperature > 45°C | Stops all agents |
| Battery < 20% | Warns user |
| Battery < 10% | Stops tasks |
| Returns to safe | Auto-resumes |

The monitor runs in the background during `zerath run`. Check live stats anytime:
```bash
zerath monitor
# Or inside REPL: /monitor
```

---

## Memory System

Each project stores memory in `~/hex-workspace/<project>/.zerathcode/memory.json`.

The memory contains:
- Project metadata (name, stack, status)
- Every file created (with language and summary)
- Action log (last 150 actions)
- Conversation history (last 30 turns)
- Error log (with fixed/unfixed status)
- Dev notes

This memory is injected into every AI prompt, so the AI always knows the full project state.

**Chat mode** is ephemeral — nothing is written to disk.

---

## Extending ZerathCode

### Add a new agent

```javascript
// src/agents/myAgent.js
const renderer = require("../ui/renderer");

class MyAgent {
  constructor(opts = {}) {
    this.permManager = opts.permManager;
    this.keyManager  = opts.keyManager;
  }

  async run(args = []) {
    const sub = args[0];
    renderer.agentLog("system", "info", `MyAgent: ${sub}`);
    // Your logic here
  }
}

module.exports = MyAgent;
```

Register in `src/core/agentManager.js`:
```javascript
const AGENT_REGISTRY = {
  // ... existing agents
  myagent: "../agents/myAgent",
};
```

Now use it:
```bash
zerath myagent doSomething
```

### Add a new orchestrator step type

In `src/core/orchestrator.js`, add a case to `_executeStep()`:
```javascript
case "my_step": {
  renderer.agentLog("system", "run", `My step: ${params.input}`);
  // Your logic
  return null;
}
```

The AI can now emit `{ "action": "my_step", "params": { "input": "..." } }`.

---

## Troubleshooting

**`zerath: command not found`**
```bash
source ~/.bashrc
# or
export PATH=$PATH:$HOME/bin
```

**No API keys**
```bash
zerath keys add claude sk-ant-api03-...
```

**Gradle build fails in Mobile Dev mode**
```bash
export ANDROID_SDK_ROOT=$HOME/android-sdk
export JAVA_HOME=$(dirname $(dirname $(readlink -f $(which java))))
```

**Cloudflare tunnel not found**
```bash
pkg install cloudflared
```

**Termux:API not working**
- Install the **Termux:API** app from F-Droid (not Google Play)
- Then: `pkg install termux-api`
- Grant permissions when Android prompts

**Enable debug logging**
```bash
ZERATH_DEBUG=1 zerath run
```

---

## Key Files

| Path | Purpose |
|---|---|
| `~/.zerathcode/keys.json` | API keys (chmod 600) |
| `~/.zerathcode/grants.json` | Permission grants |
| `~/hex-workspace/` | All projects |
| `~/hex-workspace/<project>/.zerathcode/memory.json` | Project memory |
| `~/hex-workspace/<project>/README.md` | Auto-generated README |
| `~/hex-workspace/.index.json` | Project index |

---

*ZerathCode v1 — Full-featured Multi-Agent AI Development System*
