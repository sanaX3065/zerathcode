/**
 * src/utils/fileWatcher.js
 * ZerathCode — File Watcher
 * Author: sanaX3065
 *
 * Debounced recursive file watcher built on Node's built-in fs.watch.
 * Used by the Android agent's `hex android watch` command.
 * Zero external dependencies — works in Termux.
 *
 * Usage:
 *   const watcher = new FileWatcher("./app/src", { debounceMs: 1500 });
 *   watcher.on("change", ({ event, filename, path }) => { ... });
 *   watcher.on("error", (err) => { ... });
 *   watcher.start();
 *   watcher.stop();
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const { EventEmitter } = require("events");

// File extensions to watch (ignore build artifacts, IDE files, etc.)
const WATCH_EXTENSIONS = new Set([
  ".kt", ".java", ".xml", ".json", ".gradle",
  ".properties", ".pro", ".js", ".ts", ".html", ".css",
]);

// Paths/patterns to always ignore
const IGNORE_PATTERNS = [
  /\/build\//,
  /\/\.gradle\//,
  /\/\.git\//,
  /\/\.idea\//,
  /node_modules/,
  /\.class$/,
  /\.dex$/,
  /\.apk$/,
];

class FileWatcher extends EventEmitter {
  /**
   * @param {string} watchDir    - Directory to watch recursively
   * @param {object} opts
   * @param {number} opts.debounceMs  - Debounce interval in ms (default: 1200)
   * @param {boolean} opts.verbose    - Log every detected change
   */
  constructor(watchDir, opts = {}) {
    super();
    this.watchDir   = path.resolve(watchDir);
    this.debounceMs = opts.debounceMs ?? 1200;
    this.verbose    = opts.verbose    ?? false;

    this._watcher   = null;
    this._timer     = null;
    this._pending   = [];   // accumulate changes within debounce window
    this._active    = false;
  }

  // ── Start watching ─────────────────────────────────────────────────────────
  start() {
    if (this._active) return;

    if (!fs.existsSync(this.watchDir)) {
      this.emit("error", new Error(`Watch directory not found: ${this.watchDir}`));
      return;
    }

    this._active = true;

    try {
      this._watcher = fs.watch(
        this.watchDir,
        { recursive: true, persistent: true },
        (event, filename) => {
          if (!filename) return;

          const fullPath = path.join(this.watchDir, filename);

          // Skip ignored paths
          if (IGNORE_PATTERNS.some((re) => re.test(fullPath))) return;

          // Skip non-watched extensions
          const ext = path.extname(filename).toLowerCase();
          if (ext && !WATCH_EXTENSIONS.has(ext)) return;

          if (this.verbose) {
            process.stdout.write(`\r\x1b[90m   [watch] ${event}: ${filename}\x1b[0m\n`);
          }

          this._pending.push({ event, filename, path: fullPath, ts: Date.now() });
          this._scheduleFlush();
        }
      );

      this._watcher.on("error", (err) => {
        this.emit("error", err);
      });

    } catch (err) {
      // fs.watch with { recursive: true } may not work on all Termux kernels
      // Fall back to a polling approach
      if (err.code === "ERR_FEATURE_UNAVAILABLE_ON_PLATFORM") {
        this._startPolling();
      } else {
        this.emit("error", err);
      }
    }
  }

  // ── Stop watching ──────────────────────────────────────────────────────────
  stop() {
    this._active = false;
    if (this._timer)   { clearTimeout(this._timer);  this._timer   = null; }
    if (this._watcher) { this._watcher.close();       this._watcher = null; }
    if (this._poll)    { clearInterval(this._poll);   this._poll    = null; }
    this.emit("stopped");
  }

  // ── Debounce flush ─────────────────────────────────────────────────────────
  _scheduleFlush() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      const batch = [...this._pending];
      this._pending = [];

      // Deduplicate — only emit the last event per file path
      const deduped = new Map();
      for (const change of batch) {
        deduped.set(change.path, change);
      }

      for (const change of deduped.values()) {
        this.emit("change", change);
      }
    }, this.debounceMs);
  }

  // ── Polling fallback (for kernels without inotify) ─────────────────────────
  _startPolling() {
    const POLL_INTERVAL = 2000;
    const snapshots = new Map(); // path → mtime

    // Take initial snapshot
    this._snapshot(this.watchDir, snapshots);

    this._poll = setInterval(() => {
      const current = new Map();
      this._snapshot(this.watchDir, current);

      // Detect modifications and new files
      for (const [fp, mtime] of current) {
        const prev = snapshots.get(fp);
        if (prev === undefined) {
          this._pending.push({ event: "rename", filename: path.relative(this.watchDir, fp), path: fp, ts: Date.now() });
        } else if (prev !== mtime) {
          this._pending.push({ event: "change", filename: path.relative(this.watchDir, fp), path: fp, ts: Date.now() });
        }
      }

      // Detect deleted files
      for (const fp of snapshots.keys()) {
        if (!current.has(fp)) {
          this._pending.push({ event: "rename", filename: path.relative(this.watchDir, fp), path: fp, ts: Date.now() });
        }
      }

      // Update snapshot
      snapshots.clear();
      for (const [k, v] of current) snapshots.set(k, v);

      if (this._pending.length > 0) this._scheduleFlush();
    }, POLL_INTERVAL);
  }

  // ── Recursive directory snapshot (mtime map) ──────────────────────────────
  _snapshot(dir, map) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fp = path.join(dir, entry.name);
        if (IGNORE_PATTERNS.some((re) => re.test(fp))) continue;

        if (entry.isDirectory()) {
          this._snapshot(fp, map);
        } else {
          const ext = path.extname(entry.name).toLowerCase();
          if (!ext || WATCH_EXTENSIONS.has(ext)) {
            try {
              map.set(fp, fs.statSync(fp).mtimeMs);
            } catch {}
          }
        }
      }
    } catch {}
  }
}

module.exports = FileWatcher;
