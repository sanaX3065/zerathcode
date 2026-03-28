/**
 * src/core/systemMonitor.js
 * ZerathCode — System Monitor
 * Pure Node.js (zero deps). Uses Termux:API when available.
 *
 * Protects the device from overheating and battery damage.
 * Emits events: overheat, battery:low, battery:critical, safe
 */

"use strict";

const { exec }       = require("child_process");
const EventEmitter   = require("events");
const renderer       = require("../ui/renderer");

const THRESHOLDS = {
  TEMP_WARN:         40,
  TEMP_PAUSE:        42,
  TEMP_CRITICAL:     45,
  BATTERY_LOW:       20,
  BATTERY_CRITICAL:  10,
};

class SystemMonitor extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.thresholds    = { ...THRESHOLDS, ...(opts.thresholds || {}) };
    this.pollInterval  = opts.pollInterval || 30000;
    this.lastStatus    = null;
    this._timer        = null;
    this._paused       = false;
    this._apiAvailable = null;
  }

  // ── Start background polling ──────────────────────────────────────────────
  async startWatching() {
    this._apiAvailable = await this._checkTermuxApi();
    await this._poll();
    this._timer = setInterval(() => this._poll(), this.pollInterval);
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  // ── Is it safe to run heavy tasks? ────────────────────────────────────────
  async isSafeToRun() {
    try {
      const s = await this.getBatteryStatus();
      if (s.temperature >= this.thresholds.TEMP_CRITICAL) return false;
      if (s.percentage  <= this.thresholds.BATTERY_CRITICAL) return false;
      return true;
    } catch { return true; }
  }

  // ── Get battery status ────────────────────────────────────────────────────
  async getBatteryStatus() {
    if (!this._apiAvailable) return this._fallback();
    return new Promise((resolve) => {
      exec("termux-battery-status", { timeout: 5000 }, (err, stdout) => {
        if (err || !stdout) { resolve(this._fallback()); return; }
        try {
          const d = JSON.parse(stdout.trim());
          resolve({
            percentage:  d.percentage  ?? 100,
            temperature: d.temperature ?? 30,
            status:      d.status      ?? "UNKNOWN",
            plugged:     d.plugged     ?? "UNKNOWN",
          });
        } catch { resolve(this._fallback()); }
      });
    });
  }

  // ── Print live stats panel ────────────────────────────────────────────────
  async printLiveStats() {
    const s = await this.getBatteryStatus();
    renderer.monitorPanel({
      ...s,
      heapMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    });
  }

  // ── Internal poll ─────────────────────────────────────────────────────────
  async _poll() {
    try {
      const s = await this.getBatteryStatus();
      this.lastStatus = s;
      const { temperature: temp, percentage: bat } = s;

      if (temp >= this.thresholds.TEMP_CRITICAL) {
        console.log(`\n\x1b[31m🔥 CRITICAL: ${temp}°C — stopping all agents!\x1b[0m\n`);
        this.emit("overheat:critical", s);
        this._paused = true;
      } else if (temp >= this.thresholds.TEMP_PAUSE && !this._paused) {
        renderer.agentLog("monitor", "warn", `Overheating: ${temp}°C — pausing tasks`);
        this.emit("overheat", s);
        this._paused = true;
      } else if (temp < this.thresholds.TEMP_WARN && this._paused) {
        renderer.agentLog("monitor", "ok", `Temp safe: ${temp}°C — resuming`);
        this.emit("safe", s);
        this._paused = false;
      }

      if (bat <= this.thresholds.BATTERY_CRITICAL) {
        renderer.agentLog("monitor", "alert", `Battery CRITICAL: ${bat}% — stopping`);
        this.emit("battery:critical", s);
      } else if (bat <= this.thresholds.BATTERY_LOW) {
        renderer.agentLog("monitor", "warn", `Battery low: ${bat}%`);
        this.emit("battery:low", s);
      }
    } catch {}
  }

  async _checkTermuxApi() {
    return new Promise((resolve) => {
      exec("which termux-battery-status", (err) => resolve(!err));
    });
  }

  _fallback() {
    return { percentage: 100, temperature: 30, status: "UNKNOWN", plugged: "UNKNOWN" };
  }

  isPaused() { return this._paused; }
}

module.exports = SystemMonitor;
