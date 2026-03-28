#!/usr/bin/env node
/**
 * bin/zerathcode.js
 * ZerathCode v1 — Unified Entry Point
 * Multi-Agent AI Dev System
 *
 * Two modes:
 *   zerath run              → Full interactive REPL (interactive workflow)
 *   zerath <agent> <cmd>    → Direct agent commands (CLI style)
 */

"use strict";

const args    = process.argv.slice(2);
const command = args[0];

// ── Route: run → interactive REPL (interactive workflow) ────────────────────────
if (!command || command === "run") {
  const Repl = require("../src/core/repl");
  const repl = new Repl();
  repl.start().catch((err) => {
    console.error(`\x1b[31m✖  Fatal: ${err.message}\x1b[0m`);
    if (process.env.ZERATH_DEBUG) console.error(err.stack);
    process.exit(1);
  });
  return;
}

// ── Route: version ────────────────────────────────────────────────────────────
if (command === "--version" || command === "-v" || command === "version") {
  const pkg = require("../package.json");
  console.log(`\x1b[35mZerathCode\x1b[0m v${pkg.version}`);
  process.exit(0);
}

// ── Route: help ───────────────────────────────────────────────────────────────
if (command === "--help" || command === "-h" || command === "help") {
  console.log(`
\x1b[35m  ZerathCode v1\x1b[0m — Multi-Agent AI Dev System for Termux

\x1b[36mPrimary (Interactive REPL):\x1b[0m
  \x1b[32mzerath run\x1b[0m                     Launch the full interactive agent

\x1b[36mDirect Agent Commands:\x1b[0m
  zerath keys add claude|gemini|gpt <key>
  zerath keys list
  zerath file create|read|append|replace-line <file>
  zerath web fetch <url>
  zerath git clone|pull|status <repo>
  zerath android init|build|install|check
  zerath infra deploy [--port 3000]
  zerath infra tunnel [--port 3000]
  zerath infra status
  zerath security scan [dir]
  zerath qa test [dir]
  zerath monitor               Show battery + temperature
  zerath assistant notify "title" "message"

\x1b[36mSetup:\x1b[0m
  zerath keys add claude sk-ant-api03-...
  zerath keys add gemini AIzaSy-...
  zerath keys add gpt    sk-proj-...
`);
  process.exit(0);
}

// ── Route: monitor (system health) ───────────────────────────────────────────
if (command === "monitor") {
  const SystemMonitor = require("../src/core/systemMonitor");
  const monitor = new SystemMonitor();
  monitor.printLiveStats().then(() => process.exit(0));
  return;
}

// ── Route: infra (infrastructure agent) ──────────────────────────────────────
if (command === "infra") {
  const InfrastructureAgent = require("../src/agents/infrastructureAgent");
  const agent = new InfrastructureAgent();
  const sub   = args[1] || "status";
  const port  = _extractFlag(args, "--port") || "3000";
  const domain = _extractFlag(args, "--domain");

  agent.run([sub, "--port", port, domain ? "--domain" : "", domain || ""])
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`\x1b[31m✖  Infra error: ${err.message}\x1b[0m`);
      process.exit(1);
    });
  return;
}

// ── Route: security ───────────────────────────────────────────────────────────
if (command === "security") {
  const SecurityAgent = require("../src/agents/securityAgent");
  const agent = new SecurityAgent();
  agent.run(args.slice(1))
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`\x1b[31m✖  Security error: ${err.message}\x1b[0m`);
      process.exit(1);
    });
  return;
}

// ── Route: qa ─────────────────────────────────────────────────────────────────
if (command === "qa") {
  const QAAgent = require("../src/agents/qaAgent");
  const agent = new QAAgent();
  agent.run(args.slice(1))
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`\x1b[31m✖  QA error: ${err.message}\x1b[0m`);
      process.exit(1);
    });
  return;
}

// ── Route: assistant ──────────────────────────────────────────────────────────
if (command === "assistant") {
  const AssistantAgent = require("../src/agents/assistantAgent");
  const agent = new AssistantAgent();
  agent.run(args.slice(1))
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`\x1b[31m✖  Assistant error: ${err.message}\x1b[0m`);
      process.exit(1);
    });
  return;
}

// ── Route: all other direct agent commands ────────────────────────────────────
const AgentManager = require("../src/core/agentManager");
const manager = new AgentManager();

manager.dispatch(command, args.slice(1)).catch((err) => {
  console.error(`\x1b[31m✖  Fatal: ${err.message}\x1b[0m`);
  if (process.env.ZERATH_DEBUG) console.error(err.stack);
  process.exit(1);
});

// ── Helper: extract --flag value from args ────────────────────────────────────
function _extractFlag(args, flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}
