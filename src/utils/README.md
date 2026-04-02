# Utils Module
**ZerathCode v1.0 — Core Utilities & Dependencies**

---

## Overview

The utils module provides foundational utilities supporting the entire system: AI client abstraction, shell command execution, sandboxing, logging, and specialized parsers. These utilities are injected into agents and core modules via dependency injection.

**Key Utilities:**
- AI client abstraction (Claude, Gemini, GPT)
- Shell command execution with safety controls
- Sandboxed file operations and path resolution
- Structured logging with colors and formatting
- HTML/DOM parsing for web content
- File watching and real-time updates
- Prompt templating and formatting
- Spinner animations

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│              Utils Module                           │
└──────────────┬──────────────────────────────────────┘
               │
    ┌──────────┼──────────┬──────────┬──────────┐
    │          │          │          │          │
    ▼          ▼          ▼          ▼          ▼
┌────────┐ ┌───────┐ ┌───────┐ ┌─────────┐ ┌─────┐
│ AI     │ │ Shell │ │Sandbox│ │ Logger  │ │ DOM │
│ Client │ │       │ │Manager│ │         │ │Parse│
└────────┘ └───────┘ └───────┘ └─────────┘ └─────┘
    │          │          │          │          │
    └──────────┴──────────┴──────────┴──────────┘
               │
        ┌──────▼─────────┐
        │ Injected Into: │
        │ • Agents       │
        │ • Core modules │
        │ • Orchestrator │
        └────────────────┘
```

---

## Files

| File | Purpose |
|------|---------|
| `utils/aiClient.js` | Multi-provider LLM abstraction |
| `utils/shell.js` | Shell command execution wrapper |
| `utils/logger.js` | Formatted logging with colors |
| `utils/domParser.js` | HTML parsing and extraction |
| `utils/fileWatcher.js` | File system event monitoring |
| `utils/prompt.js` | Prompt templating utilities |
| `utils/spinner.js` | CLI spinner animations |

---

## AI Client

**Location:** `src/utils/aiClient.js`

Unified interface for multiple LLM providers:

### Supported Providers

- **Claude** (Anthropic) — `claude-3-sonnet`, `claude-3-opus`, `claude-3-haiku`
- **Gemini** (Google) — `gemini-pro`, `gemini-pro-vision`
- **GPT** (OpenAI) — `gpt-4`, `gpt-4-turbo`, `gpt-3.5-turbo`

### Basic Usage

```javascript
const AiClient = require("./aiClient");

// Create client (auto-detects model from env or config)
const ai = new AiClient();

// Simple message
const response = await ai.ask("What is Node.js?");
console.log(response);

// With system prompt and options
const response = await ai.ask(
  "Create a REST API",
  {
    system: "You are an expert Node.js developer",
    model: "claude-3-opus",
    temperature: 0.7,
    maxTokens: 2000
  }
);
```

### Advanced Usage

```javascript
// Stream tokens in real-time
const stream = await ai.askStream("Write a poem", {
  onChunk: (chunk) => process.stdout.write(chunk),
  model: "gpt-4"
});

// Structured JSON response
const plan = await ai.askJson(
  "Create a step-by-step implementation plan",
  {
    system: "Return valid JSON with 'steps' array",
    schema: {
      steps: [{ name: "string", description: "string" }]
    }
  }
);

// Multi-turn conversation
const history = [];

const msg1 = await ai.ask("What's your name?", { history });
history.push({ role: "assistant", content: msg1 });

const msg2 = await ai.ask("What did I ask before?", { history });
// AI remembers: "You asked my name"
```

### Implementation Details

```javascript
class AiClient {
  constructor(options = {}) {
    this.model = options.model || process.env.ZERATH_MODEL || "claude-3-sonnet";
    this.apiKey = this.getApiKey();
    this.temperature = options.temperature || 0.7;
    this.maxTokens = options.maxTokens || 1024;
  }

  async ask(prompt, options = {}) {
    const provider = this.getProvider(this.model);
    
    switch (provider) {
      case "anthropic":
        return await this.askClaude(prompt, options);
      case "google":
        return await this.askGemini(prompt, options);
      case "openai":
        return await this.askGPT(prompt, options);
    }
  }

  async askClaude(prompt, options) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: options.maxTokens || this.maxTokens,
        system: options.system || "",
        messages: [
          ...(options.history || []),
          { role: "user", content: prompt }
        ]
      })
    });

    const data = await response.json();
    return data.content[0].text;
  }

  // Similar methods: askGemini(), askGPT()
}
```

---

## Shell Module

**Location:** `src/utils/shell.js`

Safe shell command execution with security controls:

### Basic Usage

```javascript
const shell = require("./shell");

// Simple command
const output = await shell.exec("npm --version");
console.log(output);  // "10.2.4"

// With cwd
const files = await shell.exec("ls -la", { cwd: "/home/user/project" });

// Command with pipes
const grep = await shell.exec("find . -name '*.js' | wc -l");

// Async long-running
const builder = shell.spawn("npm", ["run", "build"], {
  cwd: "./my-app",
  onStdout: (line) => console.log(line),
  onStderr: (line) => console.error(line)
});

await builder.promise;  // Wait for completion
```

### Error Handling

```javascript
try {
  const result = await shell.exec("npm install invalid-package");
} catch (error) {
  console.error(error.message);      // "Command failed with exit code 1"
  console.error(error.stderr);        // Actual error output
  console.error(error.exitCode);      // 1
  console.error(error.command);       // "npm install invalid-package"
}
```

### Security Features

```javascript
// Command validation (prevents code injection)
const safe = shell.sanitize("npm install $(malicious)");
// → "npm install \\$(malicious)"

// Timeout protection
const result = await shell.exec("sleep 100", { timeout: 5000 });
// Throws: "Command timed out after 5000ms"

// Environment filtering
const result = await shell.exec("env", {
  env: { SAFE_VAR: "value" }  // Only passed env vars
  // Excludes: password variables, keys, tokens by default
});
```

---

## Sandbox Manager

**Location:** `src/core/sandboxManager.js`

Secure file operations and path validation:

### Path Resolution

```javascript
const sandbox = new SandboxManager({ workspace: "/home/user/project" });

// Safe path resolution
const { resolved, isExternal } = sandbox.resolve("./src/index.js");
// resolved: "/home/user/project/src/index.js"
// isExternal: false

const { resolved, isExternal } = sandbox.resolve("/sdcard/Documents/file.txt");
// resolved: "/sdcard/Documents/file.txt"
// isExternal: true (requires permission)

// Escape prevention
const { resolved } = sandbox.resolve("../../etc/passwd");
// Still resolves to workspace, not escape
```

### File Operations

```javascript
// Read file
const content = await sandbox.read("/src/app.js");

// Write file
await sandbox.write("/src/new.js", "console.log('test')");

// Write with options
await sandbox.write("/src/config.js", "{}", {
  mode: 0o644,        // File permissions
  encoding: "utf-8",
  createOnly: true    // Fail if exists
});

// Create directory
await sandbox.mkdir("/src/utils", { recursive: true });

// Delete
await sandbox.remove("/src/old.js");

// List directory
const files = await sandbox.list("/src");
// ["index.js", "utils/", "config.js"]

// Get file stats
const stats = await sandbox.stat("/src/index.js");
// { size: 1024, mtime: 1672531200000, isDirectory: false }
```

### Glob Operations

```javascript
// Find matching files
const jsFiles = await sandbox.glob("**/*.js");
// ["src/index.js", "src/utils.js", "test/test.js"]

// With options
const files = await sandbox.glob("src/**/*.js", {
  ignore: ["**/node_modules/**"],
  maxDepth: 3
});
```

---

## Logger

**Location:** `src/utils/logger.js`

See [src/ui/README.md](../ui/README.md) for detailed logger documentation.

---

## DOM Parser

**Location:** `src/utils/domParser.js`

HTML parsing and content extraction:

### Basic Usage

```javascript
const DOMParser = require("./domParser");

const html = `
  <html>
    <body>
      <h1>Title</h1>
      <p>Content here</p>
      <ul>
        <li>Item 1</li>
        <li>Item 2</li>
      </ul>
    </body>
  </html>
`;

const dom = new DOMParser(html);

// Query elements
const title = dom.query("h1");
console.log(title.textContent);  // "Title"

// Query all
const items = dom.queryAll("li");
console.log(items.length);       // 2
console.log(items[0].textContent); // "Item 1"

// Get text content
const text = dom.getText();
// "Title Content here Item 1 Item 2"

// Get structured data
const data = dom.extract({
  title: "h1",
  paragraphs: ["p"],
  items: ["ul > li"]
});
// {
//   title: "Title",
//   paragraphs: ["Content here"],
//   items: ["Item 1", "Item 2"]
// }
```

### Web Content Extraction

```javascript
// Extract metadata
const meta = dom.getMeta();
// {
//   title: "Page Title",
//   description: "Page description",
//   og: { image: "...", type: "..." }
// }

// Remove unwanted elements
const text = dom.getText({
  removeSelectors: ["script", "style", ".advertisement"],
  maxLength: 10000
});

// Get links
const links = dom.getLinks();
// [
//   { text: "Home", href: "/" },
//   { text: "About", href: "/about" }
// ]
```

---

## File Watcher

**Location:** `src/utils/fileWatcher.js`

Monitor file system changes in real-time:

```javascript
const FileWatcher = require("./fileWatcher");

const watcher = new FileWatcher("./src");

// Watch for changes
watcher.on("change", (file) => {
  console.log(`Modified: ${file}`);
});

watcher.on("create", (file) => {
  console.log(`Created: ${file}`);
});

watcher.on("delete", (file) => {
  console.log(`Deleted: ${file}`);
});

watcher.on("error", (error) => {
  console.error(`Watch error: ${error}`);
});

// Start watching
watcher.start();

// Ignore certain patterns
watcher.ignore(["node_modules", "*.log", ".git"]);

// Stop watching
watcher.stop();
```

### Use Case: Dev Server Reload

```javascript
async function startDevServer() {
  let server = null;

  const watcher = new FileWatcher("./src");

  watcher.on("change", async (file) => {
    console.log(`Detected change: ${file}`);
    
    if (server) {
      server.kill();
      console.log("Restarting server...");
    }
    
    server = await startServer();
  });

  watcher.start();
  server = await startServer();
}
```

---

## Prompt Module

**Location:** `src/utils/prompt.js`

Interactive CLI prompts for user input:

```javascript
const prompt = require("./prompt");

// Simple input
const name = await prompt.question("What is your name? ");
console.log(`Hello, ${name}`);

// Choice selection
const choice = await prompt.select("Choose language:", [
  "JavaScript",
  "Python",
  "TypeScript"
]);
console.log(`Selected: ${choice}`);

// Confirmation
const confirm = await prompt.confirm("Delete files? (y/N): ");

// Multiline input
const code = await prompt.multiline("Paste your code:", {
  placeholder: "Enter code, then press Ctrl+D to finish"
});

// Checkbox selection (multiple)
const selected = await prompt.checkbox("Select features:", [
  { text: "Authentication", value: "auth", checked: true },
  { text: "Database", value: "db" },
  { text: "API", value: "api", checked: true }
]);
// ["auth", "api"]

// Password input (hidden)
const password = await prompt.password("Enter password: ");
```

---

## Spinner

**Location:** `src/utils/spinner.js`

See [src/ui/README.md](../ui/README.md) for detailed spinner documentation.

---

## Scaling: Adding New Utilities

### Step 1: Create Utility File

Create `src/utils/myUtil.js`:

```javascript
"use strict";

/**
 * MyUtil — Description
 * 
 * EXPORTS:
 * - function1()
 * - function2()
 */

class MyUtil {
  constructor(options = {}) {
    this.config = options;
  }

  async function1(input) {
    // Implementation
  }

  function2(input) {
    // Sync implementation
  }
}

module.exports = MyUtil;
```

### Step 2: Integrate into Dependency Injection

If the utility should be available to agents:

Edit `src/core/agentManager.js`:

```javascript
const MyUtil = require("../utils/myUtil");

class AgentManager {
  constructor() {
    this.permManager = new PermissionManager();
    this.keyManager  = new ApiKeyManager();
    this.myUtil      = new MyUtil();  // Add here
  }

  async dispatch(agentName, args) {
    // ... existing code ...
    const agent = new AgentClass({
      permManager: this.permManager,
      keyManager: this.keyManager,
      myUtil: this.myUtil  // Pass to agent
    });
    // ...
  }
}
```

### Step 3: Use in Agents

```javascript
class MyAgent extends BaseAgent {
  constructor(services = {}) {
    super(services);
    this.myUtil = services.myUtil;  // Access injected utility
  }

  async run(args) {
    const result = await this.myUtil.function1(args[0]);
    this.log.info(result);
  }
}
```

---

## Best Practices

### AI Client

1. **Always use `askJson()` for structured responses** — Prevents parsing errors
2. **Set appropriate `maxTokens`** — Avoid excessive API charges
3. **Provide clear system prompt** — Better quality outputs
4. **Handle rate limiting** — Implement exponential backoff
5. **Cache results when possible** — Reduce API calls

### Shell Execution

1. **Always use `shell.exec()` instead of Node's `exec()`** — Better error handling
2. **Set timeouts** — Prevent hanging processes
3. **Sanitize user input** — Use `shell.sanitize()` for untrusted input
4. **Stream large outputs** — Don't buffer everything in memory
5. **Handle signals** — Gracefully stop long-running processes

### File Operations

1. **Always use `sandbox.resolve()`** — Prevents path traversal attacks
2. **Check file permissions before access** — Use PermissionManager
3. **Use `readOnly` mode for untrusted files** — Prevent accidental modification
4. **Handle encoding explicitly** — Specify UTF-8 or binary
5. **Clean up temporary files** — Use cleanup hooks

### Logging

1. **Use appropriate log levels** — `info`, `success`, `warn`, `fail`
2. **Include context** — What operation, what file, what error
3. **No sensitive data** — Never log API keys, tokens, etc.
4. **Consistent formatting** — Use logger for all output
5. **Debug mode only** — Verbose output only when `ZERATH_DEBUG=1`

---

## Testing Utilities

```javascript
// test/utils.test.js

const AiClient = require("../src/utils/aiClient");
const shell = require("../src/utils/shell");

describe("AiClient", () => {
  test("should ask Claude", async () => {
    const ai = new AiClient({ model: "claude-3-haiku" });
    const response = await ai.ask("What is 2+2?");
    expect(response).toContain("4");
  });
});

describe("Shell", () => {
  test("should execute commands", async () => {
    const result = await shell.exec("echo 'hello'");
    expect(result.trim()).toBe("hello");
  });

  test("should handle errors", async () => {
    await expect(
      shell.exec("exit 1")
    ).rejects.toThrow();
  });
});
```
