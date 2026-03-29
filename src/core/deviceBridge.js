/**
 * src/core/deviceBridge.js
 * ZerathCode — Device Bridge
 *
 * High-level interface between the AI orchestrator and the Android device.
 * Wraps WebSocketBridgeServer with clean action/event APIs.
 * Singleton — one instance shared across orchestrator sessions.
 */

"use strict";

const EventEmitter         = require("events");
const WebSocketBridgeServer = require("./websocketServer");
const renderer             = require("../ui/renderer");
const { ActionType }       = require("./bridgeProtocol");

class DeviceBridge extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.server       = new WebSocketBridgeServer({ port: opts.port || 8765 });
    this._lastState   = null;
    this._started     = false;
    this._bindServerEvents();
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  start() {
    if (this._started) return this;
    this.server.start();
    this._started = true;
    return this;
  }

  stop() {
    this.server.stop();
    this._started = false;
  }

  // ── Status ────────────────────────────────────────────────────────────────

  isDeviceConnected() {
    return this.server.isDeviceConnected();
  }

  getLastKnownState() {
    return this._lastState;
  }

  getStatus() {
    return {
      ...this.server.getStatus(),
      lastState:   this._lastState,
    };
  }

  // ── Core action API ───────────────────────────────────────────────────────

  /**
   * Execute any action on the device.
   * Returns the ack payload from the device.
   * Throws if device is not connected or action fails.
   */
  async execute(actionType, params = {}, priority = 0.8) {
    this._assertConnected();

    renderer.agentLog("system", "run",
      `→ Bridge: ${actionType}  ${JSON.stringify(params)}`);

    const result = await this.server.sendAction({ actionType, params, priority });

    if (result?.success === false) {
      renderer.agentLog("system", "warn",
        `Action ${actionType} failed: ${result.message}`);
    } else {
      renderer.agentLog("system", "ok",
        `Action ${actionType} succeeded`);
    }

    return result;
  }

  /**
   * Fetch a fresh state snapshot from the device.
   * Also updates internal _lastState cache.
   */
  async fetchState() {
    this._assertConnected();
    const state = await this.server.queryState();
    this._lastState = state;
    return state;
  }

  // ── Convenience action wrappers ───────────────────────────────────────────

  setSilentMode(mode = "SILENT") {
    return this.execute(ActionType.SET_SILENT_MODE, { mode });
  }

  setVibration(level = 1) {
    return this.execute(ActionType.SET_VIBRATION, { level });
  }

  setBrightness(level, auto = false) {
    return this.execute(ActionType.SET_BRIGHTNESS, { level, auto });
  }

  sendNotification(title, text) {
    return this.execute(ActionType.SEND_NOTIFICATION, { title, text });
  }

  logOnly(message) {
    return this.execute(ActionType.LOG_ONLY, { message });
  }

  // ── Internal event wiring ─────────────────────────────────────────────────

  _bindServerEvents() {
    this.server.on("device_connected", (clientId) => {
      renderer.agentLog("system", "ok", "📱 Mobile device online");
      this.emit("connected", clientId);
      // Immediately fetch state after connection
      setTimeout(() => {
        this.fetchState().catch(() => {});
      }, 500);
    });

    this.server.on("device_disconnected", (clientId) => {
      renderer.agentLog("system", "warn", "📱 Mobile device offline");
      this._lastState = null;
      this.emit("disconnected", clientId);
    });

    this.server.on("device_event", (event) => {
      // Keep state cache fresh from events
      if (event?.batteryLevel !== undefined) {
        this._lastState = { ...(this._lastState || {}), ...event };
      }
      this.emit("device_event", event);
    });

    this.server.on("state_snapshot", (state) => {
      this._lastState = state;
      this.emit("state_updated", state);
    });

    this.server.on("error", (err) => {
      this.emit("error", err);
    });
  }

  _assertConnected() {
    if (!this.isDeviceConnected()) {
      throw new Error(
        "No mobile device connected to bridge.\n" +
        "  Ensure the LocalAI app is running and on the same network as Termux."
      );
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────
let _instance = null;

function getDeviceBridge(opts = {}) {
  if (!_instance) {
    _instance = new DeviceBridge(opts);
  }
  return _instance;
}

module.exports = { DeviceBridge, getDeviceBridge };
