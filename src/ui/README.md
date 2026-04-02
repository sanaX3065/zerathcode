# UI Module
**ZerathCode v1.0 — Terminal Output & User Interaction**

---

## Overview

The UI module provides cross-platform terminal output rendering with ANSI color support, spinner animations, and progress indicators. It handles all user-facing output in a consistent, visually appealing manner while ensuring graceful degradation on terminals without color support.

**Key Features:**
- ANSI color codes for status messages
- Spinner animations for long-running operations
- Table formatting for structured data
- Progress bars for batch operations
- Error highlighting and formatting
- Platform-aware (works on Termux, standard terminals, Windows)

---

## Architecture

```
┌────────────────────────────────────────────┐
│         Renderer Module                    │
│      (src/ui/renderer.js)                  │
└──────────────┬───────────────────────────────┘
               │
    ┌──────────┴──────────┐
    │                     │
    ▼                     ▼
┌─────────────┐       ┌──────────────┐
│ Color Codes │       │ Format Utils │
│ (C object)  │       │ (Format obj) │
│             │       │              │
│ • bold      │       │ • table()    │
│ • reset     │       │ • json()     │
│ • green     │       │ • code()     │
│ • red       │       │ • list()     │
│ • yellow    │       │ • badge()    │
│ • cyan      │       │              │
│ • dim       │       │              │
│ • underline │       │              │
└──────┬──────┘       └────────┬─────┘
       │                       │
       └───────────┬───────────┘
                   │
            ┌──────▼──────────────────┐
            │  Logger (src/utils/logger)│
            │                         │
            │ Methods:                │
            │ • log.info()            │
            │ • log.success()         │
            │ • log.warn()            │
            │ • log.fail()            │
            │ • log.pending()         │
            └─────────────────────────┘
```

---

## Files

| File | Purpose |
|------|---------|
| `src/ui/renderer.js` | Core rendering engine with color codes and formatting |
| `src/utils/logger.js` | Logger wrapper with status icons and colors |
| `src/utils/spinner.js` | CLI spinner animations |

---

## Renderer Module

**Location:** `src/ui/renderer.js`

The core rendering system with ANSI color codes:

### Color Object (C)

```javascript
const { C } = require("./renderer");

console.log(`${C.bold}Bold text${C.reset}`);
console.log(`${C.green}Success${C.reset}`);
console.log(`${C.red}Error${C.reset}`);
console.log(`${C.yellow}Warning${C.reset}`);
console.log(`${C.cyan}Info${C.reset}`);
console.log(`${C.dim}Dimmed${C.reset}`);
console.log(`${C.underline}Underlined${C.reset}`);
console.log(`${C.inverse}Inverted${C.reset}`);
```

**Available Properties:**

```javascript
C = {
  // Styles
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  underline: '\x1b[4m',
  inverse: '\x1b[7m',
  
  // Foreground Colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  
  // Background Colors
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
  bgGray: '\x1b[100m',
  
  // Reset
  reset: '\x1b[0m'
}
```

### Format Object

```javascript
const { Format } = require("./renderer");

// Table
Format.table([
  { name: "John", age: 30 },
  { name: "Jane", age: 28 }
]);
// Output:
// ┌──────┬─────┐
// │ name │ age │
// ├──────┼─────┤
// │ John │ 30  │
// │ Jane │ 28  │
// └──────┴─────┘

// JSON with formatting
Format.json({ key: "value" });

// Code block with syntax (if language detected)
Format.code("console.log('hello')", "javascript");

// List formatting
Format.list(["Item 1", "Item 2", "Item 3"]);

// Badge/label
Format.badge("INFO", "cyan", "message");
```

---

## Logger Module

**Location:** `src/utils/logger.js`

Convenient logging with status icons and colors:

### Methods

```javascript
const logger = require("./logger");

// Info (ℹ️ icon)
logger.info("Processing started");

// Success (✓ icon, green)
logger.success("Operation completed");

// Warn (⚠️ icon, yellow)
logger.warn("This might cause issues");

// Fail/Error (✖️ icon, red)
logger.fail("Operation failed");

// Pending (⏳ spinner)
logger.pending("Loading...");

// Header (bold, underlined)
logger.header("Section Title");

// Debug (only if ZERATH_DEBUG=1)
logger.debug("Detailed info");

// Raw (no formatting)
logger.log("Raw text");

// Separator (dashed line)
logger.separator();
```

### Implementation Example

```javascript
class FileAgent extends BaseAgent {
  async run(args) {
    const [command, path] = args;
    
    try {
      this.log.pending(`Reading ${path}...`);
      const content = await fs.promises.readFile(path, 'utf-8');
      
      this.log.success("File loaded");
      console.log(content);
      
    } catch (error) {
      this.log.fail(`Cannot read file: ${error.message}`);
      process.exit(1);
    }
  }
}
```

---

## Spinner Module

**Location:** `src/utils/spinner.js`

Animated loading indicators:

```javascript
const Spinner = require("./spinner");

const spinner = new Spinner("Processing files...");
spinner.start();

// ... do work ...

spinner.succeed("Files processed");  // ✓
// or
spinner.fail("Error processing");    // ✖
// or
spinner.stop();                       // just stop
```

**Spinner Types:**

```javascript
spinner.pending("Waiting...");
spinner.succeed("Done!");
spinner.fail("Failed!");
spinner.warn("Warning!");
spinner.info("Info!");
```

---

## Common Output Patterns

### Pattern 1: Status Bar

```javascript
const logger = require("../utils/logger");

function showStatus(current, total, item) {
  const percent = Math.round((current / total) * 100);
  const bar = "█".repeat(percent / 2) + "░".repeat(50 - percent / 2);
  
  console.log(
    `[${bar}] ${percent}% - Processing: ${item}`
  );
}

showStatus(25, 100, "file.js");
// [█████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│ 25% - Processing: file.js
```

### Pattern 2: Summary Table

```javascript
const { Format, C } = require("../ui/renderer");

const results = [
  { file: "index.js", status: "OK", lines: 245 },
  { file: "utils.js", status: "ERROR", lines: 0 },
  { file: "config.js", status: "OK", lines: 89 }
];

console.log(`${C.bold}Build Summary${C.reset}`);
Format.table(results);
```

### Pattern 3: Error Report

```javascript
const { C } = require("../ui/renderer");

function reportError(error, context) {
  console.log(`\n${C.red}${C.bold}✖ Error${C.reset}`);
  console.log(`${C.dim}Context:${C.reset} ${context}`);
  console.log(`${C.dim}Message:${C.reset} ${error.message}`);
  console.log(`${C.dim}Code:${C.reset} ${error.code}`);
  
  if (error.stack && process.env.ZERATH_DEBUG) {
    console.log(`\n${C.dim}Stack:${C.reset}`);
    console.log(error.stack);
  }
}
```

### Pattern 4: Step-by-step Progress

```javascript
const logger = require("../utils/logger");
const { C } = require("../ui/renderer");

const steps = [
  "Initialize project",
  "Create package.json",
  "Install dependencies",
  "Start dev server"
];

for (let i = 0; i < steps.length; i++) {
  const step = steps[i];
  const status = i < currentStep ? "✓" : i === currentStep ? "⟳" : "·";
  const color = i < currentStep ? C.green : i === currentStep ? C.yellow : C.dim;
  
  console.log(`${color}${status}${C.reset} ${step}`);
}
```

---

## Scaling: Custom Formatters

### Adding New Format Function

Extend `src/ui/renderer.js`:

```javascript
const Format = {
  // Existing...
  
  // New: Progress chart
  chart(data, options = {}) {
    const { maxValue = 100, width = 30 } = options;
    
    return data.map(item => {
      const filled = Math.round((item.value / maxValue) * width);
      const bar = "█".repeat(filled) + "░".repeat(width - filled);
      return `${item.label.padEnd(15)} │${bar}│ ${item.value}`;
    }).join("\n");
  },
  
  // New: Tree view
  tree(items, isRoot = true) {
    const prefix = isRoot ? "" : "  ";
    return items.map((item, i) => {
      const isLast = i === items.length - 1;
      const connector = isLast ? "└─" : "├─";
      const lines = [prefix + connector + item.name];
      
      if (item.children) {
        lines.push(this.tree(item.children, false));
      }
      
      return lines.join("\n");
    }).join("\n");
  }
};

module.exports = { C, Format };
```

### Using Custom Formatter

```javascript
const { Format, C } = require("../ui/renderer");

// Progress chart
const data = [
  { label: "Completed", value: 75 },
  { label: "Pending", value: 25 }
];

console.log(Format.chart(data, { maxValue: 100, width: 20 }));
// Completed    │██████████░░░░░░░░│ 75
// Pending      │█████░░░░░░░░░░░░│ 25

// Tree view
const tree = [
  { name: "src/", children: [
    { name: "index.js" },
    { name: "utils/" }
  ]},
  { name: "package.json" }
];

console.log(Format.tree(tree));
// ├─ src/
//   ├─ index.js
//   └─ utils/
// └─ package.json
```

---

## Platform Compatibility

### Check Terminal Capabilities

```javascript
// In renderer.js
const hasColor = process.stdout.isTTY && 
                 !process.env.NO_COLOR;

const C = hasColor ? {
  // Full color codes
  bold: '\x1b[1m',
  green: '\x1b[32m',
  // ... etc
} : {
  // No-op replacements
  bold: '',
  green: '',
  // ... etc
};
```

### Windows Support

```bash
# On Windows cmd (without ANSI support)
# Colors are automatically stripped
# Tables and formatting still work

zerath web build "Create app"  # Output visible but no colors
```

### Termux Support

```bash
# On Termux (full ANSI color support)
pkg install nodejs
zerath web build "Create app"  # Full color output
```

---

## Performance Considerations

### Large Output Optimization

For operations generating large output, batch the rendering:

```javascript
// ❌ Bad: Slow, flooding stdout
for (const file of files) {
  console.log(logger.format(file));
}

// ✅ Better: Batch output
const output = files
  .map(f => logger.format(f))
  .join("\n");

console.log(output);
```

### Spinner Performance

```javascript
// ❌ Bad: Too many spinner updates
for (const item of items) {
  spinner.text = `Processing ${item}`;
  await processItem(item);
}

// ✅ Better: Update periodically
const spinner = new Spinner("Processing...");
spinner.start();
for (const item of items) {
  await processItem(item);
  spinner.text = `Processed: ${item}`;
}
spinner.succeed("Done");
```

---

## Testing UI Components

```javascript
// test/ui.test.js

const { C, Format } = require("../src/ui/renderer");

describe("Renderer", () => {
  test("Color codes are applied", () => {
    const colored = `${C.green}text${C.reset}`;
    expect(colored).toContain("\x1b[32m");
  });
  
  test("Table formats correctly", () => {
    const data = [{ name: "test", value: 42 }];
    const table = Format.table(data);
    expect(table).toContain("name");
    expect(table).toContain("test");
  });
  
  test("JSON formatting works", () => {
    const json = Format.json({ key: "value" });
    expect(json).toContain("key");
  });
});
```

---

## Best Practices

1. **Use consistent logging:** Always use `this.log` in agents
2. **Provide progress feedback:** For operations > 1 second, show spinner
3. **Group related output:** Use headers and separators
4. **Failed operations:** Always show clear error messages
5. **Mobile-friendly:** Keep output concise (Termux screen is small)
6. **Accessibility:** Don't rely only on color for status (use icons too: ✓/✖)
7. **Platform-aware:** Test on both standard terminals and Termux
