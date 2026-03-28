/**
 * src/agents/fileAgent.js
 * ZerathCode — File Agent
 * Author: sanaX3065
 *
 * Handles all file operations with:
 *   - Path sandboxing (no traversal, home-only by default)
 *   - Permission prompts for external paths
 *   - Safe overwrite protection
 *
 * Commands:
 *   hex file create <path> [content] [--overwrite]
 *   hex file read <path> [--lines] [--from N] [--to N]
 *   hex file replace-line <path> <lineNum> <newContent>
 *   hex file append <path> <content>
 *   hex file delete <path>
 *   hex file list [dir]
 */

"use strict";

const fs        = require("fs");
const path      = require("path");
const BaseAgent = require("./baseAgent");

class FileAgent extends BaseAgent {
  async run(args) {
    const command = args[0];

    if (!command) {
      this._help();
      return;
    }

    switch (command.toLowerCase()) {
      case "create":       return this._create(args.slice(1));
      case "read":         return this._read(args.slice(1));
      case "replace-line": return this._replaceLine(args.slice(1));
      case "append":       return this._append(args.slice(1));
      case "delete":       return this._delete(args.slice(1));
      case "list":         return this._list(args.slice(1));
      default:
        this.log.fail(`Unknown file command: "${command}"`);
        this._help();
        process.exit(1);
    }
  }

  // ── Create ─────────────────────────────────────────────────────────────────
  async _create(args) {
    if (args.length === 0) this.usageError("hex file create <path> [content] [--overwrite]");

    const overwrite = args.includes("--overwrite");
    const clean     = args.filter((a) => a !== "--overwrite");
    const rawPath   = clean[0];
    const content   = clean.slice(1).join(" ");

    const resolved = await this.safePath(rawPath);

    if (fs.existsSync(resolved) && !overwrite) {
      this.log.fail(
        `File "${path.basename(resolved)}" already exists.\n` +
        `  Use \x1b[33m--overwrite\x1b[0m to replace it.`
      );
      process.exit(1);
    }

    // Ensure parent directory exists
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(resolved, content ? content + "\n" : "", { encoding: "utf8", mode: 0o644 });

    this.log.success(
      `${overwrite ? "Overwritten" : "Created"}: \x1b[33m${path.basename(resolved)}\x1b[0m\n` +
      `  \x1b[90mPath: ${resolved}\x1b[0m`
    );
    if (content) {
      console.log(`  \x1b[90mContent: ${content.slice(0, 70)}${content.length > 70 ? "…" : ""}\x1b[0m`);
    }
  }

  // ── Read ───────────────────────────────────────────────────────────────────
  async _read(args) {
    if (args.length === 0) this.usageError("hex file read <path> [--lines] [--from N] [--to N]");

    const showLines = args.includes("--lines");
    const fromIdx   = args.indexOf("--from");
    const toIdx     = args.indexOf("--to");
    const fromLine  = fromIdx !== -1 ? parseInt(args[fromIdx + 1]) : null;
    const toLine    = toIdx   !== -1 ? parseInt(args[toIdx + 1])   : null;

    // Extract filename (filter out flags and their values)
    const flags    = ["--lines", "--from", "--to", String(fromLine), String(toLine)];
    const rawPath  = args.filter((a) => !flags.includes(a))[0];
    const resolved = await this.safePath(rawPath);

    if (!fs.existsSync(resolved)) {
      this.log.fail(`File not found: "${rawPath}"`);
      process.exit(1);
    }

    const content = fs.readFileSync(resolved, "utf8");
    const lines   = content.split(/\r?\n/);
    const stat    = fs.statSync(resolved);
    const sizeKb  = (stat.size / 1024).toFixed(2);

    const ext      = path.extname(resolved).toLowerCase();
    const langClr  = { ".js":"\x1b[33m",".ts":"\x1b[34m",".py":"\x1b[32m",
                       ".sh":"\x1b[35m",".json":"\x1b[36m",".md":"\x1b[37m",
                       ".kt":"\x1b[95m",".java":"\x1b[91m" }[ext] || "\x1b[0m";

    console.log(`\n${langClr}── ${path.basename(resolved)}\x1b[0m  \x1b[90m${lines.length} lines • ${sizeKb} KB\x1b[0m\n`);

    const start = fromLine ? fromLine - 1 : 0;
    const end   = toLine   ? toLine       : lines.length;
    const slice = lines.slice(start, end);

    slice.forEach((line, i) => {
      const num = String(start + i + 1).padStart(4, " ");
      if (showLines) {
        console.log(`\x1b[90m${num}\x1b[0m  ${line}`);
      } else {
        console.log(line);
      }
    });
    console.log("");
  }

  // ── Replace Line ───────────────────────────────────────────────────────────
  async _replaceLine(args) {
    if (args.length < 3) this.usageError("hex file replace-line <path> <lineNum> <newContent>");

    const rawPath   = args[0];
    const lineNum   = parseInt(args[1]);
    const newContent = args.slice(2).join(" ");

    if (isNaN(lineNum) || lineNum < 1) {
      this.log.fail(`Line number must be a positive integer (got: "${args[1]}")`);
      process.exit(1);
    }

    const resolved = await this.safePath(rawPath);
    if (!fs.existsSync(resolved)) {
      this.log.fail(`File not found: "${rawPath}"`);
      process.exit(1);
    }

    const lines = fs.readFileSync(resolved, "utf8").split(/\r?\n/);

    if (lineNum > lines.length) {
      this.log.fail(`Line ${lineNum} doesn't exist — file has ${lines.length} line(s).`);
      process.exit(1);
    }

    const oldContent = lines[lineNum - 1];

    console.log(`\n\x1b[36m── Replace in: ${path.basename(resolved)}\x1b[0m`);
    console.log(`\x1b[90m   Line ${lineNum}:\x1b[0m`);
    console.log(`\x1b[31m   - ${oldContent}\x1b[0m`);
    console.log(`\x1b[32m   + ${newContent}\x1b[0m\n`);

    lines[lineNum - 1] = newContent;
    fs.writeFileSync(resolved, lines.join("\n"), "utf8");
    this.log.success(`Line ${lineNum} replaced in \x1b[33m${path.basename(resolved)}\x1b[0m`);
  }

  // ── Append ─────────────────────────────────────────────────────────────────
  async _append(args) {
    if (args.length < 2) this.usageError("hex file append <path> <content>");

    const rawPath  = args[0];
    const content  = args.slice(1).join(" ");
    const resolved = await this.safePath(rawPath);

    if (!fs.existsSync(resolved)) {
      this.log.fail(`File not found: "${rawPath}". Use "hex file create" first.`);
      process.exit(1);
    }

    const current = fs.readFileSync(resolved, "utf8");
    const sep     = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
    const lineNum = current.split(/\r?\n/).length;

    fs.appendFileSync(resolved, sep + content + "\n", "utf8");
    this.log.success(
      `Appended to \x1b[33m${path.basename(resolved)}\x1b[0m\n` +
      `  \x1b[90mLine ${lineNum}: ${content.slice(0, 70)}\x1b[0m`
    );
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  async _delete(args) {
    if (args.length === 0) this.usageError("hex file delete <path>");

    const rawPath  = args[0];
    const resolved = await this.safePath(rawPath);

    if (!fs.existsSync(resolved)) {
      this.log.fail(`File not found: "${rawPath}"`);
      process.exit(1);
    }

    const { confirm } = require("../utils/prompt");
    const ok = await confirm(
      `\x1b[31mDelete "${path.basename(resolved)}"?\x1b[0m`
    );
    if (!ok) {
      this.log.note("Delete cancelled.");
      return;
    }

    fs.unlinkSync(resolved);
    this.log.success(`Deleted: ${path.basename(resolved)}`);
  }

  // ── List ───────────────────────────────────────────────────────────────────
  async _list(args) {
    const rawPath  = args[0] || ".";
    const resolved = await this.safePath(rawPath);

    if (!fs.existsSync(resolved)) {
      this.log.fail(`Directory not found: "${rawPath}"`);
      process.exit(1);
    }

    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    console.log(`\n\x1b[36m── ${resolved}\x1b[0m`);
    entries.forEach((e) => {
      const icon = e.isDirectory() ? "\x1b[34m📁\x1b[0m" : "\x1b[33m📄\x1b[0m";
      console.log(`  ${icon}  ${e.name}`);
    });
    console.log(`\n  \x1b[90m${entries.length} item(s)\x1b[0m\n`);
  }

  _help() {
    console.log(`
\x1b[36mFile Agent Commands:\x1b[0m
  hex file create <path> [content] [--overwrite]
  hex file read <path> [--lines] [--from N] [--to N]
  hex file replace-line <path> <lineNum> <newContent>
  hex file append <path> <content>
  hex file delete <path>
  hex file list [dir]
`);
  }
}

module.exports = FileAgent;
