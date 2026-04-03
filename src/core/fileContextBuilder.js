/**
 * src/core/fileContextBuilder.js
 * ZerathCode — File Context Builder
 *
 * Scans the project directory and builds a rich file context block
 * that gets injected into every AI prompt.
 */

"use strict";

const fs   = require("fs");
const path = require("path");

const CODE_EXTS = new Set([
  ".js", ".ts", ".mjs", ".cjs",
  ".html", ".css", ".json",
  ".kt", ".java", ".gradle",
  ".sh", ".md", ".txt", ".env.example",
]);

const SKIP_DIRS = new Set([
  "node_modules", ".git", "build", "dist", ".gradle", ".idea",
  "coverage", ".zerathcode", "__pycache__", ".cache",
]);

const SKIP_FILES = new Set([
  ".DS_Store", "package-lock.json", "yarn.lock",
]);

const MAX_FILE_READ_BYTES  = 3000;
const MAX_TOTAL_BYTES      = 8000;
const MAX_FILES_LISTED     = 40;
const ALWAYS_READ_FILES    = ["package.json", "server.js", "index.js", "app.js", ".env.example"];

class FileContextBuilder {
  constructor(workDir) {
    this.workDir = workDir;
    this._dirty  = true;   // tracks whether a rebuild is needed
  }

  /**
   * Invalidate the scan cache so the next build() re-scans the directory.
   * Called by the orchestrator after any file is created or edited.
   */
  invalidate() {
    this._dirty = true;
  }

  /**
   * Build a context block string to inject into the AI prompt.
   *
   * @param {string} userQuery   - user's current message (for relevance scoring)
   * @param {object} opts
   * @param {number} opts.maxBytes     - override total budget
   * @param {boolean} opts.listOnly    - just list files, don't read content
   * @returns {string}
   */
  build(userQuery = "", opts = {}) {
    const maxBytes  = opts.maxBytes  || MAX_TOTAL_BYTES;
    const listOnly  = opts.listOnly  || false;

    const files = this._scan();
    if (files.length === 0) return "";

    const queryTokens = this._tokenize(userQuery);
    const scored      = this._score(files, queryTokens);
    const topFiles    = scored.slice(0, MAX_FILES_LISTED);

    const lines = ["=== EXISTING PROJECT FILES ==="];

    lines.push("\nFiles:");
    for (const f of topFiles) {
      const sizeStr = f.size < 1024
        ? `${f.size}B`
        : `${(f.size / 1024).toFixed(1)}KB`;
      lines.push(`  ${f.rel}  (${sizeStr})`);
    }

    if (listOnly) {
      lines.push("\n=== END FILES ===");
      return lines.join("\n");
    }

    lines.push("\nFile Contents (relevant files):");
    let bytesUsed = lines.join("\n").length;

    const alwaysRead = topFiles.filter(f =>
      ALWAYS_READ_FILES.includes(path.basename(f.rel))
    );
    const rest = topFiles.filter(f =>
      !ALWAYS_READ_FILES.includes(path.basename(f.rel))
    );
    const ordered = [...alwaysRead, ...rest];

    for (const f of ordered) {
      if (bytesUsed >= maxBytes) break;
      if (!CODE_EXTS.has(f.ext)) continue;
      if (f.size > MAX_FILE_READ_BYTES * 3) continue;

      try {
        const content = fs.readFileSync(f.abs, "utf8")
          .slice(0, MAX_FILE_READ_BYTES);
        const block = `\n--- ${f.rel} ---\n${content}`;
        bytesUsed += block.length;
        if (bytesUsed > maxBytes) {
          lines.push(`\n--- ${f.rel} --- [truncated — ${f.size} bytes total]`);
          break;
        }
        lines.push(block);
      } catch {}
    }

    lines.push("\n=== END FILES ===");
    this._dirty = false;
    return lines.join("\n");
  }

  /**
   * Read a specific file's content.
   * @param {string} relPath
   * @param {number} maxBytes
   */
  readFile(relPath, maxBytes = 6000) {
    const abs = path.resolve(this.workDir, relPath);
    if (!abs.startsWith(this.workDir)) return null;
    if (!fs.existsSync(abs)) return null;
    try {
      return fs.readFileSync(abs, "utf8").slice(0, maxBytes);
    } catch { return null; }
  }

  /**
   * Find files matching a pattern (name substring or extension).
   */
  find(pattern) {
    const files = this._scan();
    const lp = pattern.toLowerCase();
    return files.filter(f =>
      f.rel.toLowerCase().includes(lp) ||
      f.ext === (lp.startsWith(".") ? lp : "." + lp)
    );
  }

  /**
   * Search file contents for a text pattern.
   */
  grep(pattern) {
    const files = this._scan();
    const re = typeof pattern === "string"
      ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
      : pattern;
    const results = [];

    for (const f of files) {
      if (!CODE_EXTS.has(f.ext)) continue;
      if (f.size > 50000) continue;
      try {
        const lines = fs.readFileSync(f.abs, "utf8").split("\n");
        lines.forEach((line, i) => {
          if (re.test(line)) {
            results.push({ rel: f.rel, lineNo: i + 1, content: line.trim() });
          }
        });
      } catch {}
    }
    return results;
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  _scan() {
    const files = [];
    this._walk(this.workDir, files);
    return files;
  }

  _walk(dir, out) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }

    for (const e of entries) {
      if (e.name.startsWith(".") && !e.name.startsWith(".env")) continue;
      if (SKIP_FILES.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) this._walk(abs, out);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        const rel = path.relative(this.workDir, abs);
        try {
          const { size } = fs.statSync(abs);
          out.push({ abs, rel, ext, size, name: e.name });
        } catch {}
      }
    }
  }

  _score(files, queryTokens) {
    if (queryTokens.length === 0) {
      return files.sort((a, b) => this._importanceScore(b) - this._importanceScore(a));
    }

    return files
      .map(f => {
        let score = this._importanceScore(f);
        for (const tok of queryTokens) {
          if (f.rel.toLowerCase().includes(tok)) score += 3;
        }
        return { ...f, score };
      })
      .sort((a, b) => b.score - a.score);
  }

  _importanceScore(f) {
    const name = f.name.toLowerCase();
    const ext  = f.ext;

    if (["server.js","index.js","app.js","package.json"].includes(name)) return 10;
    if (name === ".env.example") return 8;
    if (name.includes("route") || name.includes("api")) return 7;
    if (name.includes("db") || name.includes("database")) return 6;
    if (ext === ".html" && f.rel.startsWith("public")) return 5;
    if (ext === ".js" || ext === ".jsx") return 4;
    if (ext === ".css") return 3;
    if (f.size < 500) return 2;
    return 1;
  }

  _tokenize(text) {
    const stop = new Set(["the","a","an","in","on","to","for","of","is","are",
      "how","what","please","add","fix","make","create","build","update",
      "change","modify","edit","the","my","this","that"]);
    return text.toLowerCase()
      .split(/\W+/)
      .filter(w => w.length > 2 && !stop.has(w));
  }
}

module.exports = FileContextBuilder;