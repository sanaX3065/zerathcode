/**
 * src/ui/renderer.js
 * ZerathCode — Terminal UI
 * ZerathCode — Terminal UI
 * Extended: ZerathCode infra/security/monitor panels
 *
 * Replit-inspired dark IDE aesthetic.
 */

"use strict";

// ── ANSI colour helpers ───────────────────────────────────────────────────────
const C = {
  reset:    "\x1b[0m",
  bold:     "\x1b[1m",
  dim:      "\x1b[2m",
  italic:   "\x1b[3m",
  white:    "\x1b[97m",
  grey:     "\x1b[90m",
  black:    "\x1b[30m",
  red:      "\x1b[31m",
  green:    "\x1b[32m",
  yellow:   "\x1b[33m",
  blue:     "\x1b[34m",
  magenta:  "\x1b[35m",
  cyan:     "\x1b[36m",
  bred:     "\x1b[91m",
  bgreen:   "\x1b[92m",
  byellow:  "\x1b[93m",
  bblue:    "\x1b[94m",
  bmagenta: "\x1b[95m",
  bcyan:    "\x1b[96m",
  bgBlack:  "\x1b[40m",
  bgRed:    "\x1b[41m",
  bgGreen:  "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue:   "\x1b[44m",
  bgMagenta:"\x1b[45m",
  bgCyan:   "\x1b[46m",
  bgGrey:   "\x1b[100m",
};

function termWidth() {
  try { return process.stdout.columns || 80; } catch { return 80; }
}

function pad(str, width) {
  const plain = stripAnsi(str);
  const diff  = width - plain.length;
  if (diff <= 0) return str.slice(0, width);
  return str + " ".repeat(diff);
}

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

class Renderer {

  // ── Banner ─────────────────────────────────────────────────────────────────
banner() {
  const w    = Math.min(termWidth(), 72);
  const line = "═".repeat(w);

  console.log(`\n${C.bmagenta}${line}${C.reset}`);

  // Clean ZERATHCODE Banner
  console.log(`${C.bmagenta}${C.bold}███████╗███████╗██████╗  █████╗ ████████╗██╗  ██╗ ██████╗ ██████╗ ███████╗${C.reset}`);
  console.log(`${C.bmagenta}${C.bold}╚══███╔╝██╔════╝██╔══██╗██╔══██╗╚══██╔══╝██║  ██║██╔════╝██╔═══██╗██╔════╝${C.reset}`);
  console.log(`${C.byellow}${C.bold}  ███╔╝ █████╗  ██████╔╝███████║   ██║   ███████║██║     ██║   ██║███████╗${C.reset}`);
  console.log(`${C.byellow}${C.bold} ███╔╝  ██╔══╝  ██╔══██╗██╔══██║   ██║   ██╔══██║██║     ██║   ██║╚════██║${C.reset}`);
  console.log(`${C.bmagenta}${C.bold}███████╗███████╗██║  ██║██║  ██║   ██║   ██║  ██║╚██████╗╚██████╔╝███████║${C.reset}`);
  console.log(`${C.bmagenta}${C.bold}╚══════╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝${C.reset}`);

  console.log(`${C.grey}  v1.0  •  Multi-Agent AI Dev System  •  Termux${C.reset}`);

  console.log(`${C.bmagenta}${line}${C.reset}\n`);
}

  // ── Section header ─────────────────────────────────────────────────────────
  section(title) {
    const w    = Math.min(termWidth(), 72);
    const line = "─".repeat(w);
    console.log(`\n${C.cyan}${line}${C.reset}`);
    console.log(`${C.bcyan}  ${title}${C.reset}`);
    console.log(`${C.cyan}${line}${C.reset}\n`);
  }

  // ── User chat bubble ───────────────────────────────────────────────────────
  userMessage(text) {
    const w     = Math.min(termWidth() - 4, 68);
    const lines = this._wrapText(text, w - 6);
    console.log(`\n${C.bgGrey}${C.white}  YOU  ${C.reset}${C.grey} ──────────────────────────────────────────────${C.reset}`);
    for (const line of lines) {
      console.log(`${C.grey}  │${C.reset}  ${C.white}${line}${C.reset}`);
    }
    console.log("");
  }

  // ── AI response bubble ────────────────────────────────────────────────────
  aiMessage(text, provider = "AI") {
    const label    = provider.toUpperCase();
    const labelClr = this._providerColour(provider);
    const w        = Math.min(termWidth() - 4, 68);
    const lines    = this._wrapText(text, w - 6);
    console.log(`\n${labelClr}  ${label}  ${C.reset}${C.grey} ──────────────────────────────────────────────${C.reset}`);
    for (const line of lines) {
      console.log(`${labelClr}  │${C.reset}  ${line}`);
    }
    console.log("");
  }

  // ── Agent log line ────────────────────────────────────────────────────────
  agentLog(agent, action, detail) {
    const agentMeta = {
      file:     { icon: "📄", colour: C.byellow,  label: "FILE   " },
      web:      { icon: "🌐", colour: C.bblue,    label: "WEB    " },
      git:      { icon: "🔀", colour: C.bmagenta, label: "GIT    " },
      android:  { icon: "📱", colour: C.bgreen,   label: "ANDROID" },
      memory:   { icon: "🧠", colour: C.bcyan,    label: "MEMORY " },
      system:   { icon: "⚙️", colour: C.grey,     label: "SYSTEM " },
      ai:       { icon: "⚡", colour: C.bmagenta, label: "AI     " },
      // ── ZerathCode additions ──
      infra:    { icon: "🚀", colour: C.bblue,    label: "INFRA  " },
      security: { icon: "🔒", colour: C.bred,     label: "SECURITY"},
      qa:       { icon: "🧪", colour: C.bgreen,   label: "QA     " },
      monitor:  { icon: "📊", colour: C.bcyan,    label: "MONITOR" },
      assistant:{ icon: "🤖", colour: C.bmagenta, label: "ASSIST " },
      tunnel:   { icon: "🌐", colour: C.bblue,    label: "TUNNEL " },
    };

    const actionMeta = {
      create:  { icon: "✚", colour: C.bgreen },
      edit:    { icon: "✎", colour: C.byellow },
      read:    { icon: "◎", colour: C.bcyan },
      run:     { icon: "▶", colour: C.bblue },
      delete:  { icon: "✖", colour: C.bred },
      info:    { icon: "ℹ", colour: C.grey },
      ok:      { icon: "✔", colour: C.bgreen },
      warn:    { icon: "⚠", colour: C.byellow },
      error:   { icon: "✖", colour: C.bred },
      plan:    { icon: "📋", colour: C.bcyan },
      memory:  { icon: "💾", colour: C.bcyan },
      install: { icon: "📦", colour: C.bblue },
      deploy:  { icon: "🚀", colour: C.bgreen },
      scan:    { icon: "🔍", colour: C.byellow },
      tunnel:  { icon: "🌐", colour: C.bblue },
      alert:   { icon: "🔔", colour: C.bred },
    };

    const a  = agentMeta[agent]   || agentMeta.system;
    const ac = actionMeta[action] || actionMeta.info;

    const timestamp = new Date().toLocaleTimeString("en-US", {
      hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit"
    });

    const prefix = `${C.grey}${timestamp}${C.reset}  ` +
      `${a.colour}[${a.label}]${C.reset}  ` +
      `${ac.colour}${ac.icon}${C.reset}  `;

    const maxDetail = Math.max(termWidth() - 35, 30);
    const shown     = detail.length > maxDetail
      ? detail.slice(0, maxDetail - 1) + "…"
      : detail;

    console.log(`${prefix}${shown}`);
  }

  // ── Plan block ─────────────────────────────────────────────────────────────
  planBlock(steps) {
    const w = Math.min(termWidth() - 4, 68);
    console.log(`\n${C.bcyan}╔${"═".repeat(w - 2)}╗${C.reset}`);
    console.log(`${C.bcyan}║  📋  EXECUTION PLAN${" ".repeat(w - 22)}║${C.reset}`);
    console.log(`${C.bcyan}╠${"═".repeat(w - 2)}╣${C.reset}`);
    steps.forEach((step, i) => {
      const num    = String(i + 1).padStart(2, "0");
      const text   = `  ${num}.  ${step}`;
      const padded = pad(text, w - 2);
      console.log(`${C.bcyan}║${C.reset}${C.grey}${padded}${C.reset}${C.bcyan}║${C.reset}`);
    });
    console.log(`${C.bcyan}╚${"═".repeat(w - 2)}╝${C.reset}\n`);
  }

  // ── Status bar ─────────────────────────────────────────────────────────────
  status(text) { process.stdout.write(`\r${C.grey}  ⟳  ${text}…${C.reset}             `); }
  clearStatus() { process.stdout.write("\r\x1b[2K"); }

  // ── File preview ──────────────────────────────────────────────────────────
  filePreview(filepath, content, maxLines = 20) {
    const lines   = content.split("\n");
    const shown   = lines.slice(0, maxLines);
    const ext     = filepath.split(".").pop().toLowerCase();
    const langClr = {
      js: C.byellow, ts: C.bblue, kt: C.bmagenta,
      java: C.bred, json: C.bcyan, xml: C.bgreen,
      md: C.white, sh: C.grey, gradle: C.bgreen,
    }[ext] || C.white;

    const w = Math.min(termWidth() - 4, 68);
    console.log(`\n${langClr}┌─ ${filepath} ${"─".repeat(Math.max(w - filepath.length - 5, 2))}┐${C.reset}`);
    shown.forEach((line, i) => {
      const num    = String(i + 1).padStart(3, " ");
      const maxLen = w - 8;
      const trunc  = line.length > maxLen ? line.slice(0, maxLen) + "…" : line;
      console.log(`${langClr}│${C.reset} ${C.grey}${num}${C.reset}  ${trunc}`);
    });
    if (lines.length > maxLines) {
      console.log(`${langClr}│${C.reset}  ${C.grey}… ${lines.length - maxLines} more lines${C.reset}`);
    }
    console.log(`${langClr}└${"─".repeat(w - 2)}┘${C.reset}\n`);
  }

  // ── Error / Success boxes ─────────────────────────────────────────────────
  errorBox(title, message) {
    const w = Math.min(termWidth() - 4, 68);
    console.log(`\n${C.bred}╔${"═".repeat(w - 2)}╗${C.reset}`);
    console.log(`${C.bred}║  ✖  ${title}${" ".repeat(Math.max(w - title.length - 8, 0))}║${C.reset}`);
    console.log(`${C.bred}╠${"═".repeat(w - 2)}╣${C.reset}`);
    this._wrapText(message, w - 6).forEach((l) => {
      const padded = pad(`  ${l}`, w - 2);
      console.log(`${C.bred}║${C.reset}${padded}${C.bred}║${C.reset}`);
    });
    console.log(`${C.bred}╚${"═".repeat(w - 2)}╝${C.reset}\n`);
  }

  successBox(title, lines = []) {
    const w = Math.min(termWidth() - 4, 68);
    console.log(`\n${C.bgreen}╔${"═".repeat(w - 2)}╗${C.reset}`);
    console.log(`${C.bgreen}║  ✔  ${title}${" ".repeat(Math.max(w - title.length - 8, 0))}║${C.reset}`);
    if (lines.length > 0) {
      console.log(`${C.bgreen}╠${"═".repeat(w - 2)}╣${C.reset}`);
      lines.forEach((l) => {
        const padded = pad(`  ${l}`, w - 2);
        console.log(`${C.bgreen}║${C.reset}${C.grey}${padded}${C.reset}${C.bgreen}║${C.reset}`);
      });
    }
    console.log(`${C.bgreen}╚${"═".repeat(w - 2)}╝${C.reset}\n`);
  }

  // ── Mode badge ────────────────────────────────────────────────────────────
  modeBadge(mode, provider) {
    const modeClr = {
      chat:      C.bcyan,
      fullstack: C.byellow,
      mobiledev: C.bmagenta,
      infra:     C.bblue,       // ← ZerathCode addition
    }[mode] || C.white;

    const modeLabel = {
      chat:      "💬 CHAT MODE",
      fullstack: "🌐 FULL STACK MODE",
      mobiledev: "📱 MOBILE DEV MODE",
      infra:     "🚀 INFRASTRUCTURE MODE",  // ← ZerathCode addition
    }[mode] || mode.toUpperCase();

    const provClr   = this._providerColour(provider);
    const provLabel = provider.toUpperCase();

    console.log(
      `\n  Mode:     ${modeClr}${C.bold}${modeLabel}${C.reset}\n` +
      `  Provider: ${provClr}${C.bold}${provLabel}${C.reset}\n` +
      `  ${C.grey}Type your request below. "exit" to quit, "/help" for commands.${C.reset}\n`
    );
  }

  divider() {
    const w = Math.min(termWidth(), 72);
    console.log(`${C.grey}${"─".repeat(w)}${C.reset}`);
  }

  projectTree(structure) {
    console.log(`\n${C.bgreen}  📁 Project Structure${C.reset}`);
    structure.trim().split("\n").forEach((line) => {
      console.log(`  ${C.grey}${line}${C.reset}`);
    });
    console.log("");
  }

  // ── ZerathCode: System monitor panel ─────────────────────────────────────
  monitorPanel({ percentage, temperature, status, plugged, heapMB }) {
    const w = Math.min(termWidth() - 4, 68);
    const tempClr = temperature >= 45 ? C.bred : temperature >= 42 ? C.byellow : C.bgreen;
    const batClr  = percentage  <= 10 ? C.bred : percentage  <= 20 ? C.byellow : C.bgreen;

    console.log(`\n${C.bcyan}╔${"═".repeat(w - 2)}╗${C.reset}`);
    console.log(`${C.bcyan}║  📊  SYSTEM MONITOR${" ".repeat(w - 22)}║${C.reset}`);
    console.log(`${C.bcyan}╠${"═".repeat(w - 2)}╣${C.reset}`);
    console.log(`${C.bcyan}║${C.reset}  🌡  Temperature : ${tempClr}${temperature}°C${C.reset}${" ".repeat(Math.max(w - 24 - String(temperature).length, 0))}${C.bcyan}║${C.reset}`);
    console.log(`${C.bcyan}║${C.reset}  🔋 Battery     : ${batClr}${percentage}%${C.reset} (${status}) ${" ".repeat(Math.max(w - 28 - String(percentage).length - status.length, 0))}${C.bcyan}║${C.reset}`);
    console.log(`${C.bcyan}║${C.reset}  ⚡ Plugged     : ${C.grey}${plugged}${C.reset}${" ".repeat(Math.max(w - 18 - plugged.length, 0))}${C.bcyan}║${C.reset}`);
    console.log(`${C.bcyan}║${C.reset}  🧠 Node Heap   : ${C.grey}${heapMB}MB${C.reset}${" ".repeat(Math.max(w - 20 - String(heapMB).length, 0))}${C.bcyan}║${C.reset}`);
    console.log(`${C.bcyan}╚${"═".repeat(w - 2)}╝${C.reset}\n`);
  }

  // ── ZerathCode: Security findings panel ───────────────────────────────────
  securityPanel(findings) {
    if (findings.length === 0) {
      this.successBox("Security Scan Complete", ["No secrets or vulnerabilities found ✔"]);
      return;
    }
    const w = Math.min(termWidth() - 4, 68);
    console.log(`\n${C.bred}╔${"═".repeat(w - 2)}╗${C.reset}`);
    console.log(`${C.bred}║  🔒  SECURITY FINDINGS — ${findings.length} issue(s)${" ".repeat(Math.max(w - 30 - String(findings.length).length, 0))}║${C.reset}`);
    console.log(`${C.bred}╠${"═".repeat(w - 2)}╣${C.reset}`);
    findings.slice(0, 8).forEach((f) => {
      const line = `  [${f.severity}] ${f.type}  ${f.file}:${f.line}`;
      const padded = pad(line, w - 2);
      console.log(`${C.bred}║${C.reset}${C.yellow}${padded}${C.reset}${C.bred}║${C.reset}`);
    });
    if (findings.length > 8) {
      const more = `  … and ${findings.length - 8} more`;
      console.log(`${C.bred}║${C.reset}${C.grey}${pad(more, w - 2)}${C.reset}${C.bred}║${C.reset}`);
    }
    console.log(`${C.bred}╚${"═".repeat(w - 2)}╝${C.reset}\n`);
    console.log(`${C.yellow}  💡 Tip: Move secrets to .env files and add .env to .gitignore${C.reset}\n`);
  }

  // ── ZerathCode: Deployment panel ─────────────────────────────────────────
  deployPanel({ appName, port, tunnelUrl, pm2Running, nginxRunning }) {
    const lines = [
      `App:      ${appName}`,
      `Port:     ${port}`,
      `PM2:      ${pm2Running  ? "✔ running" : "✖ not running"}`,
      `Nginx:    ${nginxRunning ? "✔ running" : "✖ not configured"}`,
      tunnelUrl ? `Public:   ${tunnelUrl}` : "Tunnel:   not started",
    ];
    this.successBox("Deployment Status", lines);
  }

  // ── Private helpers ───────────────────────────────────────────────────────
  _wrapText(text, width) {
    const lines = [];
    for (const paragraph of text.split("\n")) {
      if (paragraph.length <= width) { lines.push(paragraph); continue; }
      const words = paragraph.split(" ");
      let cur = "";
      for (const word of words) {
        if ((cur + " " + word).trim().length > width) {
          if (cur) lines.push(cur.trim());
          cur = word;
        } else {
          cur = cur ? cur + " " + word : word;
        }
      }
      if (cur) lines.push(cur.trim());
    }
    return lines.length ? lines : [""];
  }

  _providerColour(provider) {
    return {
      claude: C.bmagenta,
      gemini: C.bblue,
      gpt:    C.bgreen,
      openai: C.bgreen,
    }[provider?.toLowerCase()] || C.bcyan;
  }
}

module.exports = new Renderer();
module.exports.Renderer = Renderer;
module.exports.C = C;