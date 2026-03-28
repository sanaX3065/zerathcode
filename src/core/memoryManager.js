/**
 * src/core/memoryManager.js
 * ZerathCode — Memory Manager
 * Author: sanaX3065
 *
 * Three tiers of memory:
 *
 *  1. PROJECT MEMORY  — ~/.hex-workspace/<project>/.zerathcode/memory.json
 *     Rich, persistent, portable across Claude/Gemini/GPT.
 *     Records: files, deps, run commands, conversation, tech decisions, errors.
 *
 *  2. CHAT MEMORY     — in-process only (ephemeral, deleted on exit)
 *     Only current conversation turns. Nothing written to disk.
 *
 *  3. GLOBAL INDEX    — ~/hex-workspace/.index.json
 *     Managed by WorkspaceManager. MemoryManager reads it for context.
 *
 * The memory.json schema is designed to be readable by ANY LLM
 * so a user can share it to Claude Web / GPT / Gemini and continue work.
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const os   = require("os");

const MAX_HISTORY   = 30;
const MAX_ACTIONS   = 150;
const MAX_ERRORS    = 20;

class MemoryManager {
  /**
   * @param {string}  projectDir  - Absolute path to project root (or null for chat mode)
   * @param {"project"|"chat"} tier
   */
  constructor(projectDir = null, tier = "project") {
    this.tier       = tier;
    this.projectDir = projectDir;

    if (tier === "chat") {
      // Ephemeral — in-memory only
      this._data = this._blankData("chat-session", "chat");
      this._persist = false;
    } else {
      this._persist = true;
      this.memDir   = path.join(projectDir, ".zerathcode");
      this.memFile  = path.join(this.memDir, "memory.json");
      this._data    = this._load();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Project initialisation
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Called once when a NEW project is created.
   */
  initProject(meta) {
    this._data = this._blankData(meta.name, meta.type);
    Object.assign(this._data.project, {
      name:        meta.name        || "Untitled",
      description: meta.description || "",
      type:        meta.type        || "fullstack",
      stack:       meta.stack       || "",
      provider:    meta.provider    || "",
      workDir:     this.projectDir  || "",
      created:     new Date().toISOString(),
      updated:     new Date().toISOString(),
    });
    this._save();
    return this;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Conversation history
  // ─────────────────────────────────────────────────────────────────────────

  addUserMessage(content) {
    this._push("history", { role: "user",      content, ts: Date.now() }, MAX_HISTORY);
  }

  addAssistantMessage(content) {
    this._push("history", { role: "assistant", content, ts: Date.now() }, MAX_HISTORY);
  }

  /** Returns last N turns as { role, content } for AI context window */
  getHistory(n = 12) {
    return (this._data.history || [])
      .slice(-n)
      .map(({ role, content }) => ({ role, content }));
  }

  clearHistory() {
    this._data.history = [];
    this._save();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // File registry
  // ─────────────────────────────────────────────────────────────────────────

  registerFile(absPath, summary = "", language = "") {
    if (!this.projectDir) return;
    const rel = path.relative(this.projectDir, absPath);
    if (!this._data.files) this._data.files = {};
    this._data.files[rel] = {
      summary,
      language,
      linesOfCode: this._countLines(absPath),
      created:  this._data.files[rel]?.created || new Date().toISOString(),
      updated:  new Date().toISOString(),
    };
    this._data.project.updated = new Date().toISOString();
    this._save();
  }

  getFiles() { return this._data.files || {}; }

  removeFile(absPath) {
    if (!this.projectDir) return;
    const rel = path.relative(this.projectDir, absPath);
    if (this._data.files && this._data.files[rel]) {
      delete this._data.files[rel];
      this._save();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Agent action log
  // ─────────────────────────────────────────────────────────────────────────

  logAction(agent, action, detail) {
    this._push("actionLog", {
      ts: new Date().toISOString(), agent, action, detail,
    }, MAX_ACTIONS);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Error log (for self-healing agent)
  // ─────────────────────────────────────────────────────────────────────────

  logError(source, errorText, fixed = false) {
    this._push("errors", {
      ts: new Date().toISOString(), source, error: errorText, fixed,
    }, MAX_ERRORS);
  }

  markErrorFixed(index) {
    if (this._data.errors && this._data.errors[index]) {
      this._data.errors[index].fixed = true;
      this._save();
    }
  }

  getUnfixedErrors() {
    return (this._data.errors || []).filter((e) => !e.fixed);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Project metadata
  // ─────────────────────────────────────────────────────────────────────────

  getProject()         { return this._data.project || {}; }

  updateProject(u) {
    Object.assign(this._data.project, u, { updated: new Date().toISOString() });
    this._save();
  }

  addDep(dep) {
    if (!this._data.deps.includes(dep)) {
      this._data.deps.push(dep);
      this._save();
    }
  }

  setRunCommands(cmds) {
    this._data.runCommands = Array.isArray(cmds) ? cmds : [cmds];
    this._save();
  }

  addRunCommand(cmd) {
    if (!this._data.runCommands.includes(cmd)) {
      this._data.runCommands.push(cmd);
      this._save();
    }
  }

  addNote(note) {
    this._push("notes", { note, ts: new Date().toISOString() }, 30);
  }

  setStack(stack) {
    this._data.project.stack = stack;
    this._save();
  }

  setStatus(status) {
    this._data.project.status = status;
    this._save();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // README generation
  // Generates a human + AI readable README.md for the project
  // ─────────────────────────────────────────────────────────────────────────

  generateReadme() {
    if (!this.projectDir || this.tier !== "project") return "";

    const p       = this._data.project;
    const files   = Object.entries(this._data.files || {});
    const deps    = this._data.deps || [];
    const cmds    = this._data.runCommands || [];
    const notes   = (this._data.notes || []).slice(-10);
    const errors  = (this._data.errors || []).filter((e) => e.fixed);

    const fileSection = files.length
      ? files.map(([f, m]) =>
          `| \`${f}\` | ${m.language || "-"} | ${m.summary || "-"} | ${m.linesOfCode || "?"} lines |`
        ).join("\n")
      : "_No files yet._";

    const depsSection = deps.length ? deps.map((d) => `- ${d}`).join("\n") : "_None_";
    const cmdsSection = cmds.length ? cmds.map((c) => `\`\`\`bash\n${c}\n\`\`\``).join("\n") : "_Not set_";

    const notesSection = notes.length
      ? notes.map((n) => `- ${n.note}`).join("\n")
      : "_None_";

    const now = new Date().toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric",
    });

    return `# ${p.name || "Project"}

> ${p.description || "Built with ZerathCode by sanaX3065"}

---

## Overview

| Field       | Value                         |
|-------------|-------------------------------|
| **Name**    | ${p.name || "-"}              |
| **Type**    | ${p.type || "-"}              |
| **Stack**   | ${p.stack || "-"}             |
| **Status**  | ${p.status || "active"}       |
| **Created** | ${p.created?.slice(0, 10) || "-"} |
| **Updated** | ${now}                        |

---

## Files

| File | Language | Description | Size |
|------|----------|-------------|------|
${fileSection}

---

## Dependencies

${depsSection}

---

## How to Run

${cmdsSection}

---

## Dev Notes

${notesSection}

---

## Continue with AI

To continue working on this project with any AI assistant, share this file and the \`.zerathcode/memory.json\` file.

The memory file contains the full project context, file registry, conversation history, and action log.

**Prompt to use:**
\`\`\`
Read the attached README.md and memory.json for project "${p.name}".
Continue development. The project uses ${p.stack || "the stack described above"}.
\`\`\`

---
*Generated by ZerathCode v1.0 • sanaX3065*
`;
  }

  /**
   * Write README.md to the project directory.
   */
  writeReadme() {
    if (!this.projectDir || this.tier !== "project") return;
    const content = this.generateReadme();
    fs.writeFileSync(path.join(this.projectDir, "README.md"), content, "utf8");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // AI context block
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Returns a compact, structured text block for injection into AI prompts.
   * Designed to be parseable by Claude, Gemini, and GPT.
   */
  buildContextBlock() {
    const p = this._data.project;
    if (!p || !p.name) return "No active project.";

    const files = Object.entries(this._data.files || {})
      .map(([f, m]) => `  ${f}${m.summary ? " — " + m.summary : ""}${m.linesOfCode ? " ("+m.linesOfCode+" lines)" : ""}`)
      .join("\n");

    const recentActions = (this._data.actionLog || [])
      .slice(-20)
      .map((a) => `  [${a.agent}:${a.action}] ${a.detail}`)
      .join("\n");

    const recentErrors = this.getUnfixedErrors()
      .slice(-5)
      .map((e) => `  ERROR in ${e.source}: ${e.error.slice(0, 120)}`)
      .join("\n");

    const notes = (this._data.notes || [])
      .slice(-8)
      .map((n) => `  • ${n.note}`)
      .join("\n");

    const history = this.getHistory(8)
      .map((m) => `  ${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 200)}`)
      .join("\n");

    return [
      "╔══ PROJECT MEMORY ══════════════════════════════════════════",
      `║ Name:     ${p.name}`,
      `║ Type:     ${p.type}`,
      `║ Stack:    ${p.stack || "not set"}`,
      `║ WorkDir:  ${p.workDir || this.projectDir || "unknown"}`,
      `║ Status:   ${p.status || "active"}`,
      `║ Updated:  ${p.updated?.slice(0, 19) || "-"}`,
      "╠══ FILES ═══════════════════════════════════════════════════",
      files || "  (none yet)",
      `║ Dependencies: ${(this._data.deps || []).join(", ") || "none"}`,
      `║ Run:          ${(this._data.runCommands || []).join(" | ") || "not set"}`,
      recentErrors ? "╠══ OPEN ERRORS ═════════════════════════════════════════════\n" + recentErrors : "",
      notes        ? "╠══ NOTES ═══════════════════════════════════════════════════\n" + notes         : "",
      recentActions ? "╠══ RECENT ACTIONS ══════════════════════════════════════════\n" + recentActions  : "",
      history      ? "╠══ RECENT CONVERSATION ═════════════════════════════════════\n" + history        : "",
      "╚════════════════════════════════════════════════════════════",
    ].filter(Boolean).join("\n");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Snapshot / path helpers
  // ─────────────────────────────────────────────────────────────────────────

  snapshot()         { return JSON.parse(JSON.stringify(this._data)); }
  get memoryFilePath() { return this.memFile || null; }

  // ─────────────────────────────────────────────────────────────────────────
  // Private
  // ─────────────────────────────────────────────────────────────────────────

  _blankData(name, type) {
    return {
      version:     "3.0",
      project: {
        name, type,
        description: "",
        stack:       "",
        provider:    "",
        workDir:     "",
        status:      "active",
        created:     new Date().toISOString(),
        updated:     new Date().toISOString(),
      },
      files:       {},
      deps:        [],
      runCommands: [],
      history:     [],
      actionLog:   [],
      errors:      [],
      notes:       [],
    };
  }

  _push(key, entry, max) {
    if (!this._data[key]) this._data[key] = [];
    this._data[key].push(entry);
    if (this._data[key].length > max) {
      this._data[key] = this._data[key].slice(-max);
    }
    this._save();
  }

  _load() {
    try {
      if (fs.existsSync(this.memFile)) {
        const raw = JSON.parse(fs.readFileSync(this.memFile, "utf8"));
        // Merge with blank to ensure all keys exist (forward compat)
        const blank = this._blankData("", "");
        return { ...blank, ...raw, project: { ...blank.project, ...(raw.project || {}) } };
      }
    } catch {}
    return this._blankData("", "");
  }

  _save() {
    if (!this._persist) return;
    try {
      if (!fs.existsSync(this.memDir)) {
        fs.mkdirSync(this.memDir, { recursive: true });
      }
      this._data.project.updated = new Date().toISOString();
      fs.writeFileSync(this.memFile, JSON.stringify(this._data, null, 2), "utf8");
    } catch (err) {
      if (process.env.HEX_DEBUG) console.error("[memory] save failed:", err.message);
    }
  }

  _countLines(absPath) {
    try {
      if (fs.existsSync(absPath)) {
        return fs.readFileSync(absPath, "utf8").split("\n").length;
      }
    } catch {}
    return 0;
  }
}

module.exports = MemoryManager;
