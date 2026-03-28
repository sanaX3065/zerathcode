/**
 * src/agents/securityAgent.js
 * ZerathCode — Security Agent (Sheriff)
 * Zero npm deps. Pure Node.js.
 *
 * Commands:
 *   zerath security scan [dir]
 *   zerath security audit [dir]   (npm audit)
 */

"use strict";

const fs      = require("fs");
const path    = require("path");
const { exec } = require("child_process");
const { promisify } = require("util");
const renderer = require("../ui/renderer");

const execAsync = promisify(exec);

// ── Secret patterns ───────────────────────────────────────────────────────────
const PATTERNS = [
  { name: "OpenAI Key",           re: /sk-[a-zA-Z0-9]{48}/g },
  { name: "Anthropic Key",        re: /sk-ant-[a-zA-Z0-9\-_]{60,}/g },
  { name: "AWS Access Key",       re: /AKIA[0-9A-Z]{16}/g },
  { name: "AWS Secret",           re: /(?:aws[_-]?secret)[^\S\n]*[:=][^\S\n]*["']?([a-zA-Z0-9/+=]{40})/gi },
  { name: "Google API Key",       re: /AIza[0-9A-Za-z\-_]{35}/g },
  { name: "GitHub Token",         re: /gh[pousr]_[a-zA-Z0-9]{36}/g },
  { name: "Slack Token",          re: /xox[baprs]-[a-zA-Z0-9-]+/g },
  { name: "Private Key (PEM)",    re: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g },
  { name: "JWT Secret (hardcoded)",re: /(?:jwt[_-]?secret|JWT_SECRET)[^\S\n]*[:=][^\S\n]*["']([^"'${}]{10,})["']/gi },
  { name: "Password (hardcoded)", re: /(?:password|passwd|pwd)[^\S\n]*[:=][^\S\n]*["']([^"'${}]{6,})["']/gi },
  { name: "MongoDB URI w/ creds", re: /mongodb(?:\+srv)?:\/\/[^:]+:[^@]+@/gi },
  { name: "SQL URI w/ creds",     re: /(?:postgres|mysql):\/\/[^:]+:[^@]+@/gi },
  { name: "Gemini API Key",       re: /AIzaSy[a-zA-Z0-9\-_]{33}/g },
];

// ── Skip dirs / exts ──────────────────────────────────────────────────────────
const SKIP_DIRS = new Set(["node_modules", ".git", "build", "dist", ".gradle",
  "gradle", "__pycache__", "target", ".zerathcode"]);
const SKIP_EXTS = new Set([".png", ".jpg", ".gif", ".svg", ".ico", ".woff",
  ".ttf", ".eot", ".mp4", ".mp3", ".pdf", ".zip", ".tar", ".gz",
  ".apk", ".class", ".jar", ".bin", ".lock"]);

class SecurityAgent {
  constructor(opts = {}) {
    this.permManager = opts.permManager || null;
    this.keyManager  = opts.keyManager  || null;
  }

  async run(args = []) {
    const sub = args[0] || "scan";
    const dir = args[1] || process.cwd();

    switch (sub) {
      case "scan":  return this._scan(dir);
      case "audit": return this._npmAudit(dir);
      default:
        console.error(`\x1b[31m✖  Unknown security command: "${sub}". Use scan|audit\x1b[0m`);
    }
  }

  // ── SCAN — hardcoded secrets ───────────────────────────────────────────────
  async _scan(scanDir) {
    renderer.agentLog("security", "scan", `Scanning: ${scanDir}`);

    const files    = await this._collectFiles(scanDir);
    const findings = [];

    renderer.agentLog("security", "info", `${files.length} files to scan`);

    for (const file of files) {
      let content;
      try { content = fs.readFileSync(file, "utf8"); } catch { continue; }

      for (const pattern of PATTERNS) {
        const matches = [...content.matchAll(pattern.re)];
        for (const match of matches) {
          findings.push({
            type:     pattern.name,
            file:     path.relative(scanDir, file),
            line:     this._lineOf(content, match.index),
            value:    this._mask(match[0]),
            severity: "HIGH",
          });
        }
      }
    }

    renderer.securityPanel(findings);

    if (findings.length > 0) {
      // Save report
      const reportPath = path.join(scanDir, ".zerath-security.json");
      try {
        fs.writeFileSync(reportPath, JSON.stringify({ findings, scannedAt: new Date().toISOString() }, null, 2));
        renderer.agentLog("security", "info", `Report saved: .zerath-security.json`);
      } catch {}
    }

    return { findings, scanned: files.length, clean: findings.length === 0 };
  }

  // ── NPM AUDIT ─────────────────────────────────────────────────────────────
  async _npmAudit(dir) {
    renderer.agentLog("security", "scan", `npm audit: ${dir}`);

    const targets = [dir, path.join(dir, "backend"), path.join(dir, "frontend")]
      .filter(d => fs.existsSync(path.join(d, "package.json")));

    if (targets.length === 0) {
      renderer.agentLog("security", "warn", "No package.json found");
      return;
    }

    for (const target of targets) {
      try {
        const { stdout } = await execAsync(`cd "${target}" && npm audit --json 2>/dev/null`, { timeout: 60000 });
        try {
          const data   = JSON.parse(stdout);
          const vulns  = data.metadata?.vulnerabilities || {};
          const high   = (vulns.high || 0) + (vulns.critical || 0);
          const label  = path.relative(dir, target) || ".";
          if (high > 0) {
            renderer.agentLog("security", "warn",
              `${label}: ${vulns.critical || 0} critical, ${vulns.high || 0} high vulnerabilities`);
          } else {
            renderer.agentLog("security", "ok", `${label}: no critical vulnerabilities`);
          }
        } catch {}
      } catch {}
    }
  }

  // ── Collect files ──────────────────────────────────────────────────────────
  async _collectFiles(dir) {
    const files = [];
    const walk  = (current) => {
      let entries;
      try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = path.join(current, e.name);
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) walk(full);
        } else {
          const ext = path.extname(e.name).toLowerCase();
          if (!SKIP_EXTS.has(ext)) files.push(full);
        }
      }
    };
    walk(dir);
    return files;
  }

  _lineOf(content, index) {
    return content.substring(0, index).split("\n").length;
  }

  _mask(value) {
    if (value.length <= 8) return "****";
    return value.slice(0, 4) + "••••" + value.slice(-4);
  }
}

module.exports = SecurityAgent;
