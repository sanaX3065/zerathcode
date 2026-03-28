/**
 * src/agents/assistantAgent.js
 * ZerathCode — Personal Assistant Agent
 * Zero npm deps. Uses Termux:API when available.
 *
 * Commands:
 *   zerath assistant notify "Title" "Message"
 *   zerath assistant battery
 *   zerath assistant tts "text to speak"
 *   zerath assistant vibrate [duration_ms]
 *   zerath assistant sms [limit]
 */

"use strict";

const { exec }      = require("child_process");
const { promisify } = require("util");
const renderer      = require("../ui/renderer");

const execAsync     = promisify(exec);

class AssistantAgent {
  constructor(opts = {}) {
    this.permManager   = opts.permManager  || null;
    this.keyManager    = opts.keyManager   || null;
    this._apiAvailable = null;
    this._notifId      = 200;
  }

  async run(args = []) {
    const sub = args[0] || "battery";

    switch (sub) {
      case "notify":  return this._notify(args[1] || "ZerathCode", args[2] || "");
      case "battery": return this._battery();
      case "tts":     return this._tts(args.slice(1).join(" "));
      case "vibrate": return this._vibrate(parseInt(args[1]) || 500);
      case "sms":     return this._sms(parseInt(args[1]) || 10);
      case "location":return this._location();
      case "clipboard":return this._clipboard(args[1]);
      default:
        console.error(`\x1b[31m✖  Unknown assistant command: "${sub}". Use notify|battery|tts|vibrate|sms|location\x1b[0m`);
    }
  }

  // ── NOTIFY ────────────────────────────────────────────────────────────────
  async _notify(title, content) {
    const id = ++this._notifId;

    if (!await this._checkApi()) {
      // Graceful terminal fallback
      console.log(`\n\x1b[96m╔══════════════════════════════════════╗\x1b[0m`);
      console.log(`\x1b[96m║  🔔  ${title.padEnd(32)}\x1b[96m║\x1b[0m`);
      console.log(`\x1b[96m║  \x1b[0m${content.slice(0, 36).padEnd(36)}\x1b[96m║\x1b[0m`);
      console.log(`\x1b[96m╚══════════════════════════════════════╝\x1b[0m\n`);
      return { notified: true, fallback: true };
    }

    const t = title.replace(/"/g, '\\"');
    const c = content.replace(/"/g, '\\"');
    await this._run(`termux-notification --title "${t}" --content "${c}" --id ${id}`);
    renderer.agentLog("assistant", "ok", `Notification sent: ${title}`);
    return { notified: true, id };
  }

  // ── BATTERY ───────────────────────────────────────────────────────────────
  async _battery() {
    if (!await this._checkApi()) {
      renderer.agentLog("assistant", "warn", "Termux:API not installed — run: pkg install termux-api");
      return null;
    }
    try {
      const { stdout } = await execAsync("termux-battery-status", { timeout: 5000 });
      const data = JSON.parse(stdout.trim());
      renderer.monitorPanel({
        percentage:  data.percentage  ?? 100,
        temperature: data.temperature ?? 30,
        status:      data.status      ?? "UNKNOWN",
        plugged:     data.plugged     ?? "UNKNOWN",
        heapMB:      Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      });
      return data;
    } catch (err) {
      renderer.agentLog("assistant", "error", err.message);
      return null;
    }
  }

  // ── TEXT TO SPEECH ─────────────────────────────────────────────────────────
  async _tts(text) {
    if (!text) { console.error("\x1b[31m✖  Usage: zerath assistant tts \"your text\"\x1b[0m"); return; }

    if (!await this._checkApi()) {
      console.log(`\n\x1b[90m[TTS]\x1b[0m ${text}\n`);
      return;
    }

    const safe = text.replace(/"/g, '\\"').slice(0, 400);
    await this._run(`termux-tts-speak "${safe}"`);
    renderer.agentLog("assistant", "ok", `TTS: "${text.slice(0, 50)}"`);
  }

  // ── VIBRATE ───────────────────────────────────────────────────────────────
  async _vibrate(duration = 500) {
    if (!await this._checkApi()) {
      renderer.agentLog("assistant", "warn", "Termux:API not available for vibration");
      return;
    }
    await this._run(`termux-vibrate -d ${duration}`);
    renderer.agentLog("assistant", "ok", `Vibrated (${duration}ms)`);
  }

  // ── SMS ───────────────────────────────────────────────────────────────────
  async _sms(limit = 10) {
    if (!await this._checkApi()) {
      renderer.agentLog("assistant", "warn", "Termux:API required for SMS access");
      return [];
    }
    try {
      const { stdout } = await execAsync(`termux-sms-list -l ${limit}`, { timeout: 10000 });
      const messages   = JSON.parse(stdout.trim());
      console.log(`\n\x1b[96m  📱  ${messages.length} SMS messages:\x1b[0m\n`);
      messages.slice(0, 5).forEach(m => {
        console.log(`  \x1b[93m${m.number}\x1b[0m  \x1b[90m${(m.body || "").slice(0, 80)}\x1b[0m`);
      });
      console.log("");
      return messages;
    } catch (err) {
      renderer.agentLog("assistant", "error", err.message);
      return [];
    }
  }

  // ── LOCATION ──────────────────────────────────────────────────────────────
  async _location() {
    if (!await this._checkApi()) {
      renderer.agentLog("assistant", "warn", "Termux:API required for location");
      return null;
    }
    try {
      renderer.agentLog("assistant", "info", "Fetching location (network)…");
      const { stdout } = await execAsync("termux-location -p network", { timeout: 20000 });
      const loc        = JSON.parse(stdout.trim());
      console.log(`\n  \x1b[96m📍 Location:\x1b[0m`);
      console.log(`     Lat: \x1b[93m${loc.latitude}\x1b[0m`);
      console.log(`     Lng: \x1b[93m${loc.longitude}\x1b[0m`);
      console.log(`     Accuracy: \x1b[90m${loc.accuracy}m\x1b[0m\n`);
      return loc;
    } catch (err) {
      renderer.agentLog("assistant", "error", err.message);
      return null;
    }
  }

  // ── CLIPBOARD ─────────────────────────────────────────────────────────────
  async _clipboard(text) {
    if (!await this._checkApi()) {
      renderer.agentLog("assistant", "warn", "Termux:API required for clipboard");
      return;
    }
    if (text) {
      await this._run(`termux-clipboard-set "${text.replace(/"/g, '\\"')}"`);
      renderer.agentLog("assistant", "ok", "Copied to clipboard");
    } else {
      try {
        const { stdout } = await execAsync("termux-clipboard-get", { timeout: 5000 });
        console.log(`\n  \x1b[90mClipboard:\x1b[0m ${stdout.trim()}\n`);
      } catch {}
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  async _checkApi() {
    if (this._apiAvailable !== null) return this._apiAvailable;
    try {
      await execAsync("which termux-battery-status");
      this._apiAvailable = true;
    } catch {
      this._apiAvailable = false;
    }
    return this._apiAvailable;
  }

  async _run(cmd) {
    try { await execAsync(cmd, { timeout: 15000 }); } catch (e) {
      renderer.agentLog("assistant", "warn", e.message.slice(0, 80));
    }
  }
}

module.exports = AssistantAgent;
