# Core Module
**ZerathCode v1.0 — Orchestration & State Management**

---

## Overview

The core module provides the central nervous system of ZerathCode: AI orchestration, state management, permission controls, API key management, memory systems, and self-healing capabilities. It coordinates agent execution, manages device bridge communication, and implements advanced features like semantic document embedding and retrieval-augmented generation (RAG).

**Key Responsibilities:**
- AI reasoning and step orchestration
- File context injection for AI awareness
- Document embedding and semantic search
- Device bridge protocol management
- Permission and security policy enforcement
- Error detection and automatic recovery
- Memory persistence and retrieval
- System monitoring and logging

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│    Entry Points                                         │
│  ├─ CLI (bin/zerathcode.js)                            │
│  ├─ REPL (interactive mode)                            │
│  └─ Bridge Server (WebSocket endpoint)                 │
└──────────────────────┬──────────────────────────────────┘
                       │
        ┌──────────────▼──────────────┐
        │   AgentManager              │
        │ • Loads agents by name      │
        │ • Injects dependencies      │
        │ • Handles system commands   │
        └──────────────┬──────────────┘
                       │
    ┌──────────────────┼──────────────────┐
    │                  │                  │
    ▼                  ▼                  ▼
┌──────────────┐ ┌────────────────┐ ┌─────────────────────┐
│ Agent Exec   │ │ REPL Mode      │ │ Bridge Server       │
│ (Direct)     │ │ (Interactive)  │ │ (Device Integration)│
└──────┬───────┘ └────────┬───────┘ └──────────┬──────────┘
       │                  │                    │
       └──────────────────┼────────────────────┘
                          │
         ┌────────────────▼────────────────┐
         │      Orchestrator               │
         │  • Query Reasoning              │
         │  • Step Execution               │
         │  • Error Recovery               │
         │  • File Context Injection       │
         │  • RAG Integration              │
         └────────────────┬────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
        ▼                 ▼                 ▼
   ┌──────────┐   ┌──────────────┐   ┌───────────────┐
   │AI Client │   │Agent Manager │   │DeviceBridge   │
   │(LLM API) │   │(Execution)   │   │(WebSocket)    │
   └────┬─────┘   └──────┬───────┘   └────────┬──────┘
        │                │                    │
        └────────────────┼────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
   ┌──────────┐  ┌────────────────┐  ┌─────────────┐
   │Permission│  │FileContext     │  │Memory       │
   │Manager   │  │Builder & RAG   │  │Manager      │
   └──────────┘  └────────────────┘  └─────────────┘
```

---

## Files

### Core System

| File | Purpose |
|------|---------|
| `agentManager.js` | Routes CLI commands to agents, manages dependencies |
| `orchestrator.js` | AI-driven step execution, error recovery, context injection |
| `fullAiOrchestrator.js` | Autonomous AI orchestration with device aware prompts |
| `apiKeyManager.js` | Secure API key storage and retrieval |
| `permissionManager.js` | User approval prompts, file access control |
| `sandboxManager.js` | Safe path resolution, escapes prevention |

### AI & Reasoning

| File | Purpose |
|------|---------|
| `queryReasoner.js` | Decomposes user queries into execution steps |
| `reasoningAgent.js` | Multi-turn reasoning with context accumulation |
| `fileContextBuilder.js` | Scans workspace, injects files into AI prompts |
| `documentEmbedder.js` | Generates semantic embeddings for files/docs |
| `documentQueryHandler.js` | Semantic search over embedded documents (RAG) |
| `embeddingManager.js` | Manages embedding cache and retrieval |

### Device Integration

| File | Purpose |
|------|---------|
| `deviceBridge.js` | High-level API for device communication |
| `bridgeProtocol.js` | Message envelope types and validation |
| `websocketServer.js` | WebSocket server with heartbeat and ack tracking |

### Runtime Management

| File | Purpose |
|------|---------|
| `repl.js` | Interactive REPL with multi-line support |
| `logAgent.js` | Watches running processes, detects errors |
| `selfHealingAgent.js` | Auto-fixes detected errors, triggers AI recovery |
| `systemMonitor.js` | Real-time system stats (memory, CPU, processes) |
| `memoryManager.js` | Persistent memory for conversation context |
| `workspaceManager.js` | Project state tracking and analysis |

---

## Orchestrator Workflow

### High-level Operation

```javascript
// User input
"Create a Node.js REST API with authentication"

// 1. Query Reasoning
queryReasoner.decomposeQuery(input)
// → [
//     { agent: "file", action: "create", target: "package.json" },
//     { agent: "web", action: "scaffold", template: "express-api" },
//     { agent: "web", action: "addFeature", feature: "auth" },
//     { agent: "web", action: "start" }
//   ]

// 2. File Context Injection
fileContextBuilder.scanWorkspace()
// → Returns existing project files to inject into AI prompt
// → AI can now see what already exists and avoid recreation

// 3. Step Execution
for (step in steps) {
  result = await executeStep(step)
  
  if (error detected) {
    logAgent.monitor()      // Watch for runtime errors
    selfHealing.recover()   // Auto-fix and retry
  }
}

// 4. Result Feedback
renderer.displayResult(result)
```

---

## Key Components

### 1. Orchestrator

**Location:** `src/core/orchestrator.js`

Manages full-stack AI orchestration:

```javascript
class Orchestrator {
  async run(query, mode = "chat") {
    // Step 1: Reason about query
    const steps = await this.reasoner.decompose(query);
    
    // Step 2: Inject file context into AI prompt
    const context = await this.contextBuilder.build();
    const enrichedPrompt = this.buildPrompt(context, query);
    
    // Step 3: Get AI response with step plan
    const plan = await this.aiClient.askForSteps(enrichedPrompt);
    
    // Step 4: Execute each step with error recovery
    for (const step of plan) {
      try {
        const result = await this.executeStep(step);
        this.log.success(`Step complete: ${step.name}`);
      } catch (error) {
        // Trigger self-healing
        const fixed = await this.selfHealing.recover(error, step);
        if (fixed) continue;
        throw error;
      }
    }
    
    return results;
  }
  
  async executeStep(step) {
    switch (step.action) {
      case "create_file":
        return await this.fileAgent.create(step.path, step.content);
      case "run_command":
        return await this.sandbox.shell(step.command);
      case "run_agent":
        return await this.agentManager.dispatch(step.agent, step.args);
      // ... other actions
    }
  }
}
```

**Capabilities:**
- Submits user query to AI model
- Receives structured JSON response with steps
- Executes steps sequentially or in parallel (batches)
- Injects file context before each AI call
- Integrates error recovery through LogAgent and SelfHealingAgent
- Supports search_files action for AI to grep before coding

### 2. File Context Builder

**Location:** `src/core/fileContextBuilder.js`

Enables AI awareness of existing project:

```javascript
class FileContextBuilder {
  async buildContext(workspacePath) {
    // Scan all files with reasonable sizes
    const files = await this.scanWorkspace(workspacePath);
    
    // Build markdown representation
    const markdown = `
# Project Files

## package.json
\`\`\`json
${fileContent('package.json')}
\`\`\`

## src/server.js
\`\`\`javascript
${fileContent('src/server.js')}
\`\`\`

## More files...
    `;
    
    return markdown;
  }
  
  scanWorkspace(path, maxFiles = 50, maxSize = 10000) {
    // Tree-walk, skip node_modules, build/, etc.
    // Prioritize package.json, main files, recent changes
    // Stop at maxFiles or aggregate size limit
  }
}
```

**Why it matters:**
- Without context, AI recreates existing files or misses dependencies
- With context, AI modifies intelligently and avoids duplication
- Reduces redundant API calls and speeds up development

### 3. Query Reasoner

**Location:** `src/core/queryReasoner.js`

Decomposes user intent into agent actions:

```javascript
class QueryReasoner {
  async decomposeQuery(query) {
    // Uses NLP to understand intent
    // Returns structured steps for execution
    
    const steps = [];
    
    if (query.includes("create") && query.includes("api")) {
      steps.push({
        agent: "web",
        action: "scaffold",
        params: { template: "express-api" }
      });
    }
    
    if (query.includes("deploy")) {
      steps.push({
        agent: "infra",
        action: "deploy",
        params: { provider: "pm2" }
      });
    }
    
    return steps;
  }
}
```

### 4. Device Bridge

**Location:** `src/core/deviceBridge.js`

High-level API for Android device communication:

```javascript
class DeviceBridge {
  async execute(actionType, params) {
    // Sends ACTION message to Android device
    // Waits for response with timeout
    // Returns result or throws error
    
    const result = await this.websocketServer.send({
      type: "ACTION",
      id: generateId(),
      actionType: actionType,  // SET_SILENT_MODE, etc.
      params: params
    });
    
    return result.data;
  }
  
  async queryState() {
    // Gets current device state (battery, location, etc.)
    const state = await this.websocketServer.send({
      type: "QUERY",
      id: generateId(),
      queryType: "GET_DEVICE_STATE"
    });
    
    return state;
  }
  
  onEvent(callback) {
    // Listens for device events (battery low, location change, etc.)
    this.websocketServer.on("EVENT", callback);
  }
}
```

### 5. Permission Manager

**Location:** `src/core/permissionManager.js`

Enforces security policies:

```javascript
class PermissionManager {
  async requestAccess(path) {
    // If accessing external path (outside workspace):
    // 1. Log the request
    // 2. Prompt user for approval
    // 3. Cache decision
    
    if (this.isExternal(path)) {
      const approved = await this.promptUser(
        `Allow access to external path? ${path}`
      );
      return approved;
    }
    
    return true;  // Workspace paths always OK
  }
}
```

### 6. Self-Healing Agent

**Location:** `src/core/selfHealingAgent.js`

Detects and recovers from errors:

```javascript
class SelfHealingAgent {
  async recover(error, context) {
    // Example: "Cannot find module 'express'"
    
    this.log.warn(`Auto-recovering: ${error.message}`);
    
    // Step 1: Analyze error
    const analysis = await this.aiClient.analyzeError(error);
    // → "User forgot to run npm install"
    
    // Step 2: Generate fix
    const fix = await this.aiClient.generateFix(analysis, context);
    // → "Run: npm install"
    
    // Step 3: Apply fix
    await this.sandbox.shell(fix.command);
    
    // Step 4: Retry original step
    return true;  // Success
  }
}
```

### 7. Log Agent

**Location:** `src/core/logAgent.js`

Monitors running processes in real-time:

```javascript
class LogAgent {
  startMonitoring(process) {
    // Watch stdout/stderr of running server
    
    process.stdout.on("data", (data) => {
      const line = data.toString();
      
      if (this.isError(line)) {
        // Error detected!
        this.log.fail(`Runtime error: ${line}`);
        
        // Trigger self-healing
        this.selfHealing.recover(line);
      }
    });
  }
  
  isError(line) {
    const errorPatterns = [
      /error/i,
      /cannot find module/i,
      /SyntaxError/,
      /undefined/i
    ];
    
    return errorPatterns.some(p => p.test(line));
  }
}
```

### 8. Memory Manager

**Location:** `src/core/memoryManager.js`

Persistent conversation history:

```javascript
class MemoryManager {
  async saveMessage(role, content) {
    // Store in ~/.zerath/memory/conversations.json
    // Format: [{ role: "user", content: "...", timestamp }, ...]
  }
  
  async getHistory(limit = 20) {
    // Retrieve recent messages for context
    // Used to maintain conversation state across REPL sessions
  }
  
  async clear() {
    // Withe memory for fresh start
  }
}
```

---

## Document Embedding & RAG

### Overview

ZerathCode can index and semantically search project documentation:

**Pipeline:**
```
Document Import
    │
    ▼
Chunking (1000 char chunks with overlap)
    │
    ▼
Embedding (@xenova/transformers models)
    │
    ▼
Vector Storage (in-memory with JSON backup)
    │
    ▼
Query Time: User Question → Semantic Search → Top K Chunks → LLM Answer
```

### DocumentEmbedder

**Location:** `src/core/documentEmbedder.js`

```javascript
class DocumentEmbedder {
  async embedDocument(text) {
    // Uses sentence-transformers model (via @xenova/transformers)
    // Generates dense vector representation
    
    const embedding = await this.model.encode(text);
    // → Float32Array of 384 dimensions
    
    return embedding;
  }
  
  async embedChunks(document) {
    // Split document into chunks
    const chunks = this.chunkText(document, 1000, 100);
    
    // Embed each chunk
    const embeddings = await Promise.all(
      chunks.map(c => this.embedDocument(c))
    );
    
    return chunks.map((text, i) => ({
      text: text,
      embedding: embeddings[i],
      metadata: { source, position: i }
    }));
  }
}
```

### DocumentQueryHandler

**Location:** `src/core/documentQueryHandler.js`

```javascript
class DocumentQueryHandler {
  async answerQuestion(query, documents) {
    // Step 1: Embed query
    const queryEmbedding = await this.embedder.embedDocument(query);
    
    // Step 2: Semantic search
    const relevantChunks = this.search(
      queryEmbedding,
      documents,
      topK = 5
    );
    
    // Step 3: Build context
    const context = relevantChunks
      .map(c => c.text)
      .join("\n\n");
    
    // Step 4: Ask LLM with context
    const answer = await this.aiClient.ask(`
      Based on the following documentation:
      ${context}
      
      Answer: ${query}
    `);
    
    return answer;
  }
  
  search(queryEmbedding, documents, topK) {
    // Cosine similarity search
    const scores = documents.map(doc => ({
      doc: doc,
      score: cosineSimilarity(queryEmbedding, doc.embedding)
    }));
    
    return scores
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(s => s.doc);
  }
}
```

---

## Scaling the System

### Adding New Reasoning Capabilities

**Modify `queryReasoner.js`:**

```javascript
class QueryReasoner {
  async decomposeQuery(query) {
    const steps = [];
    
    // Existing patterns...
    
    // Add new pattern
    if (query.includes("database") && query.includes("schema")) {
      steps.push({
        agent: "database",  // New agent
        action: "scaffold",
        params: { type: "postgresql" }
      });
    }
    
    return steps;
  }
}
```

### Adding New Device Actions

**Modify `bridgeProtocol.js` and Android side:**

1. Add to `ACTION_SCHEMAS`:
```javascript
const ACTION_SCHEMAS = {
  // Existing...
  NEW_ACTION: {
    name: "NEW_ACTION",
    description: "What this does",
    params: {
      param1: { type: "string", required: true }
    }
  }
};
```

2. Create Android handler (see android-app/README.md)

3. Access in orchestrator:
```javascript
const result = await bridge.execute("NEW_ACTION", { param1: "value" });
```

### Adding New Embedding Use Cases

**Extend `documentQueryHandler.js`:**

```javascript
class DocumentQueryHandler {
  async recommendCodePatterns(context) {
    // Given code context, retrieve similar patterns from docs
    const embedding = await this.embedder.embedDocument(context);
    const patterns = this.search(embedding, this.patterns, topK: 3);
    return patterns;
  }
  
  async findRelatedTests(functionCode) {
    // Find test examples for similar functions
    const embedding = await this.embedder.embedDocument(functionCode);
    const tests = this.search(embedding, this.testCorpus, topK: 2);
    return tests;
  }
}
```

---

## Configuration

### Environment Variables

```bash
# Model selection
export ZERATH_MODEL=claude-3-sonnet
export ZERATH_TEMPERATURE=0.7

# Workspace
export ZERATH_WORKSPACE=/path/to/workspace

# Features
export ZERATH_NO_SELF_HEAL=1          # Disable auto-recovery
export ZERATH_NO_RAG=1                # Disable semantic search
export ZERATH_DEBUG=1                 # Verbose logging

# Performance
export ZERATH_MAX_CONTEXT=50000       # Max file context size
export ZERATH_PARALLEL_BATCH=4        # Concurrent file writes
```

### API Configuration

```bash
# Set API keys
zerath keys add claude sk-ant-...
zerath keys add openai sk-proj-...

# Set permissions
zerath perms allow /sdcard/MyProject
```

---

## Error Handling

### Self-Healing Flow

```
User Command
    │
    ├─ Normal Execution
    │  │
    │  ├─ Success → Display result
    │  │
    │  └─ RuntimeError → Trigger SelfHealing
    │     │
    │     ├─ LogAgent detects error in output
    │     ├─ SelfHealingAgent analyzes error
    │     ├─ AI generates fix
    │     ├─ Fix applied
    │     ├─ Original step retried
    │     │
    │     ├─ Success → Continue
    │     └─ Still Failing → Report error
    │
    └─ Fatal Error → Exit with error code
```

### Example: Missing Dependency

1. AI creates Express app
2. `npm start` fails: "Cannot find module 'express'"
3. LogAgent catches error
4. SelfHealingAgent:
   - Analyzes: "Missing dependency"
   - Runs: `npm install express`
   - Retries: `npm start`
   - Success!

---

## Testing

Core modules include comprehensive tests:

```bash
npm test test/orchestrator.test.js
npm test test/bridge.test.js
npm test test/queryReasoner.test.js
```

Key test scenarios:
- Multi-step orchestration
- Error detection and recovery
- Permission enforcement
- Device bridge communication
- Semantic search accuracy
- Concurrent file operations
