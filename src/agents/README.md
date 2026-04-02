# Agents Module
**ZerathCode v1.0 — Modular AI Agent System**

---

## Overview

The agents module provides a plugin-based architecture where each agent is a standalone class implementing specialized domain tasks. All agents extend `BaseAgent` and receive dependency-injected services (permissions manager, API key manager, sandbox manager, logger).

Agent Types:

| Category | Agent | Purpose |
|----------|-------|---------|
| **Core** | FileAgent | CRUD operations, security sandboxing |
| | WebAgent | Full-stack app generation (Node.js + HTML/CSS/JS) |
| | GitAgent | Version control (clone, commit, push, branch) |
| **Extended** | AndroidAgent | APK build & deployment |
| | InfrastructureAgent | PM2, process management, tunneling |
| | SecurityAgent | Vulnerability scanning, secret detection |
| | QAAgent | Automated testing, coverage analysis |
| | AssistantAgent | Conversational AI, code explanation |

---

## Architecture

```
┌──────────────────────────────────────────┐
│   AgentManager (src/core/agentManager.js)│
│   • Parses CLI: zerath <agent> <args>    │
│   • Loads agent by name                  │
│   • Injects services (PermManager,      │
│     KeyManager, SandboxManager, Logger)  │
└──────────────────────────┬────────────────┘
                           │
        ┌──────────────────┴──────────────────┐
        ▼                                     ▼
   ┌─────────────────┐             ┌──────────────────┐
   │   BaseAgent     │             │ Dependency Inject│
   │ (Abstract Base) │             │                  │
   │                 │             │ • permManager    │
   │ Methods:        │             │ • keyManager     │
   │ • run(args)     │             │ • sandbox        │
   │ • safePath()    │             │ • log            │
   │ • usageError()  │             └──────────────────┘
   └────────┬────────┘
            │
   ┌────────┴────────────────────────────────┐
   │         All Agents Extend BaseAgent     │
   │                                         │
   ├─ FileAgent     (file CRUD)             │
   ├─ WebAgent      (web app generation)    │
   ├─ GitAgent      (version control)       │
   ├─ AndroidAgent  (mobile builds)         │
   ├─ InfraAgent    (deployment)            │
   ├─ SecurityAgent (vulnerability scan)    │
   ├─ QAAgent       (test automation)       │
   └─ AssistantAgent(chat/explain)          │
```

---

## BaseAgent Class

All agents inherit from this foundation:

```javascript
// src/agents/baseAgent.js

class BaseAgent {
  constructor(services = {}) {
    this.permManager = services.permManager;
    this.keyManager  = services.keyManager;
    this.sandbox     = new SandboxManager();
    this.log         = logger;
  }

  // Abstract method - must implement
  async run(args) { }

  // Safely resolve file paths and check permissions
  async safePath(rawPath) { }

  // Print error and exit
  usageError(usage) { }
}
```

---

## Core Agents

### FileAgent

**Location:** `src/agents/fileAgent.js`

**Purpose:** Secure file I/O with sandboxing and permission checks

**Commands:**
```bash
zerath file create  <path> <content>           # Create file
zerath file read    <path>                     # Read file
zerath file write   <path> <content>           # Overwrite file
zerath file append  <path> <content>           # Append to file
zerath file delete  <path>                     # Delete file
zerath file list    <path>                     # List directory
zerath file chmod   <path> <permissions>       # Change permissions
```

**Architecture:**
```
FileAgent
├── Security Layer (SandboxManager)
│   └── Validates paths (no ../../../ escapes)
├── Permission Layer (PermissionManager)
│   └── Requests user approval for external paths
└── Operation Handlers
    ├── read() → fs.readFileSync
    ├── write() → fs.writeFileSync
    ├── create() → fails if exists
    ├── append() → fs.appendFileSync
    └── delete() → fs.unlinkSync or rmdirSync
```

**Example Implementation:**
```javascript
async run(args) {
  const [command, pathArg, ...rest] = args;
  
  const path = await this.safePath(pathArg);  // Check perms
  
  switch (command) {
    case "read":
      const content = await this.sandbox.read(path);
      this.log.info(content);
      break;
    case "create":
      const newContent = rest.join(" ");
      await this.sandbox.write(path, newContent, { createOnly: true });
      this.log.success("File created");
      break;
    // handle other commands
  }
}
```

### WebAgent

**Location:** `src/agents/webAgent.js`

**Purpose:** Full-stack web application generation

**Commands:**
```bash
zerath web build    <description>              # Generate web app
zerath web server   <port>                     # Start dev server
zerath web deploy                              # Deploy to infrastructure
```

**Architecture:**
```
WebAgent
├── AI Prompt Builder
│   └── Generates scaffolding instructions
├── Component Generator
│   ├── Create package.json
│   ├── Build Express/Node.js server
│   ├── Generate initial HTML/CSS/JS
│   └── Create test files
├── Server Lifecycle
│   ├── Start (spawn Node.js)
│   ├── Watch (reload on file change)
│   └── Stop (clean shutdown)
└── Integration
    └── Hooks into LogAgent for runtime errors
```

**Workflow:**
1. User: `zerath web build "Chat app with Socket.io"`
2. Agent sends description to AI
3. AI returns JSON steps:
   ```json
   {
     "steps": [
       {"action": "create_file", "path": "package.json", "content": "..."},
       {"action": "create_file", "path": "server.js", "content": "..."},
       {"action": "create_file", "path": "public/index.html", "content": "..."},
       {"action": "run_command", "cmd": "npm install"}
     ]
   }
   ```
4. Agent executes each step via FileAgent + shell
5. Starts dev server immediately
6. LogAgent watches for errors + triggers auto-fixes

### GitAgent

**Location:** `src/agents/gitAgent.js`

**Purpose:** Version control operations

**Commands:**
```bash
zerath git status                               # Show git status
zerath git clone   <repo> [local]              # Clone repository
zerath git commit  <message>                   # Commit changes
zerath git push    [remote] [branch]           # Push to remote
zerath git pull    [remote] [branch]           # Pull from remote
zerath git branch  <name>                      # Create branch
zerath git checkout <branch>                   # Switch branch
zerath git merge   <branch>                    # Merge branch
```

**Architecture:**
```
GitAgent
├── Git Wrapper (executes git commands)
├── Repository State Parser
│   ├── Parse git status output
│   ├── Extract commit log
│   └── List branches
└── Safe Operations
    ├── Dirty working tree detection
    ├── Merge conflict handling
    └── Rollback on error
```

**Example:**
```javascript
async run(args) {
  const [command, ...params] = args;
  
  switch (command) {
    case "status":
      const status = await this.sandbox.shell("git status --porcelain");
      this.log.info(status);
      break;
    case "commit":
      const msg = params.join(" ");
      await this.sandbox.shell(`git add -A && git commit -m "${msg}"`);
      this.log.success("Committed");
      break;
  }
}
```

---

## Extended Agents

### AndroidAgent

**Location:** `src/agents/androidAgent.js`

**Purpose:** Build & deploy Android APKs

**Commands:**
```bash
zerath android build    <project_path>         # Build APK
zerath android deploy                          # Push to device
zerath android emulate                         # Run in emulator
zerath android logs                            # Show logcat
```

**Integration with Bridge:**
- Detects when bridge is connected
- Deploys directly to connected Android device
- Forwards logcat through orchestrator for error detection

### InfrastructureAgent

**Location:** `src/agents/infrastructureAgent.js`

**Purpose:** Deployment and process management

**Commands:**
```bash
zerath infra deploy                            # Deploy via PM2
zerath infra tunnel                            # Expose via Cloudflare
zerath infra logs                              # Show process logs
zerath infra restart  <app>                    # Restart process
```

### SecurityAgent

**Location:** `src/agents/securityAgent.js`

**Purpose:** Security scanning and vulnerability detection

**Commands:**
```bash
zerath security scan   <path>                  # Scan for vulnerabilities
zerath security secrets [project]              # Detect exposed secrets
zerath security audit  [dependencies]          # Check dependencies
```

### QAAgent

**Location:** `src/agents/qaAgent.js`

**Purpose:** Test automation and coverage analysis

**Commands:**
```bash
zerath qa test     <pattern>                   # Run tests
zerath qa coverage <path>                      # Check coverage
zerath qa generate <unit|integration|e2e>      # Generate test template
```

### AssistantAgent

**Location:** `src/agents/assistantAgent.js`

**Purpose:** Interactive AI assistance

**Commands:**
```bash
zerath assistant explain <code_file>           # Explain code
zerath assistant debug   <error_message>       # Debug error
zerath assistant suggest <context>             # Suggest improvements
```

---

## Creating a New Agent

### Step 1: Create Agent File

Create `src/agents/myAgent.js`:

```javascript
"use strict";

const BaseAgent = require("./baseAgent");
const { C } = require("../ui/renderer");

/**
 * MyAgent
 * 
 * CAPABILITIES:
 * - Capability 1: Description
 * - Capability 2: Description
 * 
 * COMMANDS:
 * zerath myagent <command> [args]
 * 
 * DEPENDENCIES:
 * - permManager: For file access
 * - keyManager: For API secrets (if needed)
 * - sandbox: For shell execution
 * - log: For output
 */
class MyAgent extends BaseAgent {
  
  /**
   * Entry point for command execution
   * @param {string[]} args - Command arguments from CLI
   */
  async run(args) {
    const [command, ...params] = args;

    switch (command) {
      case "action1":
        return await this.action1(params);
      case "action2":
        return await this.action2(params);
      case "help":
        return this.printHelp();
      default:
        this.usageError(
          `myagent <action1|action2|help> [args]\n` +
          `Examples:\n` +
          `  zerath myagent action1 param1\n` +
          `  zerath myagent action2 param1 param2`
        );
    }
  }

  /**
   * Action 1 implementation
   */
  async action1(params) {
    if (params.length === 0) {
      this.usageError("myagent action1 <required_param>");
    }

    const [param1] = params;

    try {
      this.log.pending(`Processing ${param1}...`);

      // Check permission if accessing files
      const safePath = await this.safePath(param1);

      // Perform action
      const result = await this.performAction(safePath);

      this.log.success(`Action completed: ${result}`);
      console.log(result);
    } catch (error) {
      this.log.fail(`Error: ${error.message}`);
      process.exit(1);
    }
  }

  /**
   * Action 2 implementation
   */
  async action2(params) {
    const [param1, param2] = params;
    
    if (!param1 || !param2) {
      this.usageError("myagent action2 <param1> <param2>");
    }

    try {
      // Execute shell command
      const output = await this.sandbox.shell(
        `echo "Processing ${param1} and ${param2}"`
      );
      this.log.info(output);
    } catch (error) {
      this.log.fail(`Shell error: ${error.message}`);
      process.exit(1);
    }
  }

  /**
   * Helper method
   */
  async performAction(path) {
    return `Action performed on ${path}`;
  }

  /**
   * Print help
   */
  printHelp() {
    console.log(`
${C.bold}MyAgent${C.reset}

${C.dim}DESCRIPTION${C.reset}
  Performs my specialized tasks

${C.dim}COMMANDS${C.reset}
  action1 <param>        Description of action1
  action2 <p1> <p2>      Description of action2
  help                   Show this help

${C.dim}EXAMPLES${C.reset}
  zerath myagent action1 file.txt
  zerath myagent action2 src dest
    `);
  }
}

module.exports = MyAgent;
```

### Step 2: Register in AgentManager

Edit `src/core/agentManager.js`:

```javascript
const AGENT_REGISTRY = {
  file:      "../agents/fileAgent",
  web:       "../agents/webAgent",
  git:       "../agents/gitAgent",
  android:   "../agents/androidAgent",
  infra:     "../agents/infrastructureAgent",
  security:  "../agents/securityAgent",
  qa:        "../agents/qaAgent",
  assistant: "../agents/assistantAgent",
  myagent:   "../agents/myAgent",  // ← Add here
};
```

### Step 3: Test the Agent

```bash
zerath myagent help
zerath myagent action1 test.txt
zerath myagent action2 src dest
```

### Step 4: Enable in Orchestrator (Optional)

To allow the AI to auto-invoke your agent, add to `src/core/orchestrator.js`:

```javascript
const SYSTEM_PROMPTS = {
  fullai: `
    ...existing prompt...
    
    AVAILABLE AGENTS:
    - zerath myagent action1 [param]
    - zerath myagent action2 [p1] [p2]
  `
};
```

---

## Agent State Management

### Accessing Services

All services are injected and available:

```javascript
class MyAgent extends BaseAgent {
  async run(args) {
    // File path validation + permission check
    const safePath = await this.safePath("/some/path");

    // API key retrieval
    const apiKey = await this.keyManager.get("claude");

    // Sandboxed shell execution
    const output = await this.sandbox.shell("npm install");

    // Logging with colors
    this.log.pending("Working...");
    this.log.success("Done!");
    this.log.fail("Error!");
  }
}
```

### SandboxManager API

```javascript
// File operations
await this.sandbox.read(path)              // Read file
await this.sandbox.write(path, content)    // Write file
await this.sandbox.resolve(path)           // Resolve to absolute path

// Shell execution
await this.sandbox.shell(command)          // Execute shell command
await this.sandbox.shellAsync(command)     // For long-running commands
```

### PermissionManager API

```javascript
// Request access to external paths
const allowed = await this.permManager.requestAccess("/sdcard/MyProject");
if (!allowed) throw new Error("Access denied");

// Check if path is safe (workspace-relative)
const { isExternal } = this.sandbox.resolve(path);
```

---

## Error Handling

Best practices:

```javascript
async run(args) {
  try {
    // Validate input
    if (!args.length) {
      this.usageError("command <required_arg>");
    }

    // Operate
    const result = await this.performAction(args[0]);

    // Report success
    this.log.success("Operation completed");
    console.log(result);

  } catch (error) {
    // Report error
    this.log.fail(error.message);
    
    // Exit with error code
    process.exit(1);
  }
}
```

---

## Testing Agents

Create test file `test/myAgent.test.js`:

```javascript
"use strict";

const MyAgent = require("../src/agents/myAgent");
const PermissionManager = require("../src/core/permissionManager");
const ApiKeyManager = require("../src/core/apiKeyManager");

describe("MyAgent", () => {
  let agent;

  beforeEach(() => {
    agent = new MyAgent({
      permManager: new PermissionManager(),
      keyManager: new ApiKeyManager(),
    });
  });

  test("action1 should complete successfully", async () => {
    await agent.run(["action1", "test.txt"]);
    // Assert expected behavior
  });

  test("action2 should require two parameters", () => {
    expect(() => agent.run(["action2", "p1"])).toThrow();
  });
});
```

Run tests:
```bash
npm test test/myAgent.test.js
```

---

## Agent Patterns

### Pattern 1: File Processing

```javascript
async processFiles(globPattern) {
  const files = await this.sandbox.glob(globPattern);
  
  for (const file of files) {
    const content = await this.sandbox.read(file);
    const processed = this.process(content);
    await this.sandbox.write(file, processed);
  }
  
  this.log.success(`Processed ${files.length} files`);
}
```

### Pattern 2: Async Shell Commands

```javascript
async runServer(command) {
  this.log.pending("Starting server...");
  
  const proc = await this.sandbox.shellAsync(command);
  
  proc.stdout.on("data", (data) => {
    this.log.info(data.toString());
  });
  
  proc.on("close", (code) => {
    this.log.success(`Server stopped (code ${code})`);
  });
}
```

### Pattern 3: User Input Validation

```javascript
async run(args) {
  const [command, param] = args;
  
  if (!command) {
    this.usageError("command <required> [optional]");
  }
  
  if (command === "create" && !param) {
    this.usageError('command create <name>');
  }
  
  // Proceed with confidence that inputs are valid
}
```

---

## Scaling Considerations

- **Performance:** Keep agent operations under 30 seconds or provide progress feedback
- **Concurrency:** Multiple agents can run simultaneously; use locks for shared resources
- **Error Recovery:** Always catch and report errors gracefully
- **Logging:** Use `this.log` for consistent formatted output
- **Permissions:** Always call `safePath()` before file operations
- **Dependencies:** Inject services rather than creating new instances
