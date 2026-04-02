/**
 * src/core/processManager.js
 * ZerathCode — Dual Process Manager
 *
 * Manages TWO independent subprocesses:
 *   - frontend  (vite dev OR static file server)
 *   - backend   (node server.js)
 *
 * Each process:
 *   - Pipes all stdout/stderr to <workDir>/frontend.log or backend.log
 *   - Also streams first lines to terminal in real time
 *   - Has independent port + restart + port-clearing lifecycle
 *   - Emits events: started, error, exited
 *
 * Port clearing uses three methods in order (no native deps):
 *   1. fuser -k PORT/tcp      (procps)
 *   2. /proc/net/tcp6 inode   (pure Node, always works on Android)
 *   3. lsof -ti tcp:PORT
 */

"use strict";

const { spawn }    = require("child_process");
const fs           = require("fs");
const path         = require("path");
const EventEmitter = require("events");
const renderer     = require("../ui/renderer");
const { C }        = require("../ui/renderer");

// ─────────────────────────────────────────────────────────────────────────────
class SubProcess extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string}   opts.name         "frontend" | "backend"
   * @param {string}   opts.workDir
   * @param {number}   opts.port
   * @param {string}   opts.logFile      absolute path to .log file
   * @param {Function} opts.onLine       (line, isErr) callback — for LogAgent
   */
  constructor(opts) {
    super();
    this.name     = opts.name;
    this.workDir  = opts.workDir;
    this.port     = opts.port;
    this.logFile  = opts.logFile;
    this.onLine   = opts.onLine || (() => {});

    this._proc     = null;
    this._cmd      = null;
    this._args     = [];
    this._env      = {};
    this._starting = false;
    this._logStream = null;
  }

  isRunning() { return !!this._proc && !this._proc.killed; }

  async start(cmd, args = [], env = {}) {
    this._cmd  = cmd;
    this._args = args;
    this._env  = env;
    await this._spawn();
  }

  async restart() {
    if (this._starting) return;
    this._starting = true;
    try {
      await this._teardown();
      await this._clearPort();
      await this._spawn();
    } finally {
      this._starting = false;
    }
  }

  async stop() {
    await this._teardown();
    await this._clearPort();
    this._closeLog();
    this._cmd = null;
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  async _spawn() {
    if (!this._cmd) return;
    this._openLog();

    const env = {
      ...process.env,
      PORT:        String(this.port),
      FORCE_COLOR: "0",
      ...this._env,
    };

    const color = this.name === "frontend" ? C.bcyan : C.bgreen;
    renderer.agentLog("infra", "run",
      `[${this.name}] ${this._cmd} ${this._args.join(" ")}  ${C.grey}→ port ${this.port}${C.reset}`);

    const child = spawn(this._cmd, this._args, {
      cwd:   this.workDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this._proc = child;

    let startLines = 0;

    const handleData = (chunk, isErr) => {
      const text = chunk.toString();

      // Write to log file
      if (this._logStream) {
        try { this._logStream.write(`[${new Date().toISOString()}] ${text}`); } catch {}
      }

      // Stream first 5 lines to terminal
      const lines = text.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        if (startLines < 5) {
          renderer.agentLog("infra", isErr ? "warn" : "ok",
            `[${this.name}] ${line.trim().slice(0, 100)}`);
          startLines++;
        }
        this.onLine(line, isErr);
      }
    };

    child.stdout.on("data", d => handleData(d, false));
    child.stderr.on("data", d => handleData(d, true));

    child.on("close", code => {
      this._logStream?.write(`\n[PROCESS EXITED: code=${code}]\n`);
      renderer.agentLog("infra", code === 0 ? "ok" : "warn",
        `[${this.name}] exited (${code})`);
      this.emit("exited", code);
    });

    child.on("error", err => {
      renderer.agentLog("infra", "error",
        `[${this.name}] spawn error: ${err.message}`);
      this.emit("error", err);
    });

    await this._sleep(1500);

    const logRel = path.relative(this.workDir, this.logFile);
    console.log(
      `\n  ${color}▶${C.reset}  ${this.name.toUpperCase()} running at ` +
      `${C.bcyan}http://localhost:${this.port}${C.reset}` +
      `  ${C.grey}(logs → ${logRel})${C.reset}\n`
    );

    this.emit("started", this.port);
  }

  async _teardown() {
    if (!this._proc) return;
    const proc = this._proc;
    this._proc = null;

    return new Promise(resolve => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      proc.on("close", finish);
      try { proc.kill("SIGTERM"); } catch {}
      const t = setTimeout(() => {
        if (!done) { try { proc.kill("SIGKILL"); } catch {} setTimeout(finish, 200); }
      }, 800);
      proc.on("close", () => clearTimeout(t));
    });
  }

  async _clearPort() {
    const port = this.port;

    // Method 1: fuser
    const ok = await new Promise(resolve => {
      const p = spawn("fuser", ["-k", `${port}/tcp`], { stdio: "ignore" });
      p.on("close", code => resolve(code === 0));
      p.on("error", () => resolve(false));
    });
    if (ok) { await this._sleep(300); return; }

    // Method 2: /proc/net/tcp6 (pure Node)
    for (const f of ["/proc/net/tcp6", "/proc/net/tcp"]) {
      let content;
      try { content = fs.readFileSync(f, "utf8"); } catch { continue; }
      const hex = port.toString(16).toUpperCase().padStart(4, "0");
      let inode = null;
      for (const line of content.split("\n").slice(1)) {
        const p = line.trim().split(/\s+/);
        if (p[1]?.split(":")[1]?.toUpperCase() === hex) { inode = p[9]; break; }
      }
      if (inode && this._killByInode(inode)) { await this._sleep(300); return; }
    }

    // Method 3: lsof
    await new Promise(resolve => {
      const p = spawn("lsof", ["-ti", `tcp:${port}`], { stdio: ["ignore","pipe","ignore"] });
      let out = "";
      p.stdout?.on("data", d => { out += d.toString(); });
      p.on("close", () => {
        out.trim().split("\n").filter(Boolean).forEach(pid => {
          const n = parseInt(pid);
          if (n > 0) try { process.kill(n, "SIGTERM"); } catch {}
        });
        resolve();
      });
      p.on("error", resolve);
    });
    await this._sleep(300);
  }

  _killByInode(inode) {
    const target = `socket:[${inode}]`;
    let killed = false;
    try {
      for (const pid of fs.readdirSync("/proc")) {
        if (!/^\d+$/.test(pid)) continue;
        try {
          for (const fd of fs.readdirSync(`/proc/${pid}/fd`)) {
            if (fs.readlinkSync(`/proc/${pid}/fd/${fd}`) === target) {
              const n = parseInt(pid);
              if (n > 0 && n !== process.pid) {
                try { process.kill(n, "SIGTERM"); killed = true; } catch {}
              }
              break;
            }
          }
        } catch {}
        if (killed) break;
      }
    } catch {}
    return killed;
  }

  _openLog() {
    this._closeLog();
    try {
      this._logStream = fs.createWriteStream(this.logFile, { flags: "a" });
      this._logStream.write(`\n\n${"=".repeat(60)}\n`);
      this._logStream.write(`[STARTED: ${new Date().toISOString()}] ${this._cmd} ${this._args.join(" ")}\n`);
      this._logStream.write(`${"=".repeat(60)}\n\n`);
    } catch { this._logStream = null; }
  }

  _closeLog() {
    try { this._logStream?.end(); } catch {}
    this._logStream = null;
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

// ─────────────────────────────────────────────────────────────────────────────
// DualProcessManager — owns both frontend and backend SubProcess instances
// ─────────────────────────────────────────────────────────────────────────────
class DualProcessManager {
  /**
   * @param {object} opts
   * @param {string}   opts.workDir
   * @param {number}   opts.frontendPort
   * @param {number}   opts.backendPort
   * @param {Function} opts.onFrontendLine  (line, isErr)
   * @param {Function} opts.onBackendLine   (line, isErr)
   */
  constructor(opts) {
    this.workDir = opts.workDir;

    const frontLog = path.join(opts.workDir, "frontend.log");
    const backLog  = path.join(opts.workDir, "backend.log");

    this.frontend = new SubProcess({
      name:    "frontend",
      workDir: opts.workDir,
      port:    opts.frontendPort || 5173,
      logFile: frontLog,
      onLine:  opts.onFrontendLine || (() => {}),
    });

    this.backend = new SubProcess({
      name:    "backend",
      workDir: opts.workDir,
      port:    opts.backendPort || 3001,
      logFile: backLog,
      onLine:  opts.onBackendLine || (() => {}),
    });
  }

  async stopAll() {
    await Promise.all([
      this.frontend.stop(),
      this.backend.stop(),
    ]);
  }

  /**
   * Run npm install synchronously and return success
   */
  async runNpmInstall() {
    return new Promise((resolve) => {
      const npm = spawn("npm", ["install"], {
        cwd: this.workDir,
        stdio: ["ignore", "pipe", "pipe"],
      });
      
      npm.stdout?.on("data", (d) => {
        const text = d.toString();
        const lines = text.split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          if (text.includes("found 0 vulnerabilities") || text.includes("added")) {
            require("../ui/renderer").agentLog("infra", "ok", `[npm] ${line.slice(0,100)}`);
          }
        }
      });
      
      npm.on("close", (code) => {
        resolve(code === 0);
      });
      npm.on("error", () => {
        resolve(false);
      });
    });
  }

  /**
   * Read last N lines from a log file (for status reports).
   * @param {"frontend"|"backend"} which
   * @param {number} n
   */
  readLog(which, n = 30) {
    const proc = which === "frontend" ? this.frontend : this.backend;
    try {
      const content = fs.readFileSync(proc.logFile, "utf8");
      const lines = content.split("\n");
      return lines.slice(-n).join("\n");
    } catch { return ""; }
  }
}

module.exports = { DualProcessManager, SubProcess };
