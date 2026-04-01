/**
 * src/core/websocketServer.js
 * ZerathCode — WebSocket Bridge Server
 *
 * Runs in Termux. Listens for the Android app to connect.
 * Manages the full message lifecycle: send action → wait for ack → resolve.
 */

"use strict";

const WebSocket    = require("ws");
const EventEmitter = require("events");
const renderer     = require("../ui/renderer");
const { MessageType, validateMessage, Messages } = require("./bridgeProtocol");

const DEFAULT_PORT      = 8765;
const HEARTBEAT_MS      = 25000; // 25s — below Android's 30s timeout
const ACTION_TIMEOUT_MS = 12000;
const QUERY_TIMEOUT_MS  = 6000;

class WebSocketBridgeServer extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.port          = opts.port || DEFAULT_PORT;
    this.wss           = null;
    this.clients       = new Map();   // clientId → { ws, connectedAt, lastPong }
    this.pendingAcks   = new Map();   // messageId → { resolve, reject, timeoutHandle }
    this._heartbeatTimer = null;
    this.documentEmbedder = null;   // set after construction (Phase 4)
    this.proactiveAgent   = null;   // set after construction (Phase 4)
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  start() {
    if (this.wss) return this; // already running

    this.wss = new WebSocket.Server({ port: this.port });

    this.wss.on("listening", () => {
      renderer.agentLog("system", "ok",
        `Bridge server listening on ws://localhost:${this.port}`);
      this.emit("listening");
    });

    this.wss.on("connection", (ws, req) => {
      this._onConnection(ws, req);
    });

    this.wss.on("error", (err) => {
      renderer.agentLog("system", "error", `Bridge server error: ${err.message}`);
      this.emit("error", err);
    });

    this._startHeartbeat();
    return this;
  }

  stop() {
    this._stopHeartbeat();

    // Drain pending acks
    for (const [id, pending] of this.pendingAcks) {
      clearTimeout(pending.timeoutHandle);
      pending.reject(new Error("Bridge server stopped"));
    }
    this.pendingAcks.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    this.clients.clear();
    renderer.agentLog("system", "info", "Bridge server stopped");
  }

  // ── Connection management ─────────────────────────────────────────────────

  _onConnection(ws, req) {
    const clientId     = crypto.randomUUID();
    const remoteAddr   = req.socket.remoteAddress || "unknown";

    this.clients.set(clientId, {
      ws,
      connectedAt: Date.now(),
      lastPong:    Date.now(),
      remoteAddr,
    });

    renderer.agentLog("system", "ok",
      `Device connected [${clientId.slice(0, 8)}] from ${remoteAddr}`);
    this.emit("device_connected", clientId);

    // Send handshake immediately
    this._sendTo(ws, Messages.handshake({
      server:   "ZerathCode-Bridge",
      version:  "1.0.0",
      clientId,
      protocol: "1",
    }));

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString("utf8"));
        if (!validateMessage(msg)) {
          renderer.agentLog("system", "warn", "Received malformed message — ignoring");
          return;
        }
        this._onMessage(clientId, msg);
      } catch (err) {
        renderer.agentLog("system", "error", `Parse error: ${err.message}`);
      }
    });

    ws.on("close", (code, reason) => {
      this.clients.delete(clientId);
      renderer.agentLog("system", "warn",
        `Device disconnected [${clientId.slice(0, 8)}] code=${code}`);
      this.emit("device_disconnected", clientId);
    });

    ws.on("error", (err) => {
      renderer.agentLog("system", "error",
        `Client ws error [${clientId.slice(0, 8)}]: ${err.message}`);
    });
  }

  // ── Message handling ──────────────────────────────────────────────────────

  _onMessage(clientId, msg) {
    const { id, type, payload } = msg;

    // Update pong timestamp for heartbeat tracking
    if (type === MessageType.PONG) {
      const client = this.clients.get(clientId);
      if (client) client.lastPong = Date.now();
      return;
    }

    // Resolve pending ack/error
    if (type === MessageType.ACK || type === MessageType.ERROR ||
        type === MessageType.STATE_SNAPSHOT) {
      const pending = this.pendingAcks.get(id);
      if (pending) {
        clearTimeout(pending.timeoutHandle);
        this.pendingAcks.delete(id);
        if (type === MessageType.ERROR) {
          pending.reject(new Error(payload?.message || "Device error"));
        } else {
          pending.resolve(payload);
        }
        return;
      }
      // If no pending ack but it's a state snapshot, still emit it
      if (type === MessageType.STATE_SNAPSHOT) {
        this.emit("state_snapshot", payload);
      }
      return;
    }

    // Device event (battery, location, notification, etc.)
    if (type === MessageType.EVENT) {
      renderer.agentLog("system", "info",
        `← Event from device: ${payload?.eventType || "unknown"}`);
      this.emit("device_event", payload, clientId);
      return;
    }

    // Phase 4: semantic embedding
    if (["embed_query", "embed_chunks", "score_chunks"].includes(type)) {
      if (this.documentEmbedder) {
        this.documentEmbedder.handle({ id, type, payload })
            .then((response) => { if (response) this._sendTo(this._getClientWs(clientId), response); })
            .catch((err) => {
                const ws = this._getClientWs(clientId);
                if (ws) this._sendTo(ws, {
                    id, type: "error",
                    payload: { message: err.message },
                    timestamp: Date.now(),
                });
            });
      } else {
        const ws = this._getClientWs(clientId);
        if (ws) this._sendTo(ws, {
            id, type: "error",
            payload: { message: "Embedding service not running" },
            timestamp: Date.now(),
        });
      }
      return;
    }

    // Phase 4: proactive agent
    if (["analyze_events", "explain_pattern"].includes(type)) {
      if (this.proactiveAgent) {
        this.proactiveAgent.handle({ id, type, payload })
            .then((response) => { if (response) this._sendTo(this._getClientWs(clientId), response); })
            .catch((err) => {
                const ws = this._getClientWs(clientId);
                if (ws) this._sendTo(ws, {
                    id, type: "error",
                    payload: { message: err.message },
                    timestamp: Date.now(),
                });
            });
      } else {
        const ws = this._getClientWs(clientId);
        if (ws) this._sendTo(ws, {
            id, type: "error",
            payload: { message: "Proactive agent not running" },
            timestamp: Date.now(),
        });
      }
      return;
    }

    renderer.agentLog("system", "warn", `Unhandled message type: ${type}`);
  }

  // ── Send helpers ──────────────────────────────────────────────────────────

  _sendTo(ws, message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  _getFirstClient() {
    for (const { ws } of this.clients.values()) {
      if (ws.readyState === WebSocket.OPEN) return ws;
    }
    return null;
  }

  _getClientWs(clientId) {
    return this.clients.get(clientId)?.ws || null;
  }

  // ── Public API (used by DeviceBridge / Orchestrator) ─────────────────────

  /**
   * Send an action to the device and await its ack.
   * Rejects if device disconnects or times out.
   */
  sendAction(action, timeoutMs = ACTION_TIMEOUT_MS) {
    const ws = this._getFirstClient();
    if (!ws) return Promise.reject(new Error("No device connected"));

    const msg = Messages.action(
      action.actionType,
      action.params || {},
      action.priority || 0.8
    );

    return this._sendAndWait(ws, msg, timeoutMs);
  }

  /**
   * Request a state snapshot from the device.
   */
  queryState(timeoutMs = QUERY_TIMEOUT_MS) {
    const ws = this._getFirstClient();
    if (!ws) return Promise.reject(new Error("No device connected"));

    const msg = Messages.query("state_snapshot");
    return this._sendAndWait(ws, msg, timeoutMs);
  }

  _sendAndWait(ws, msg, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingAcks.delete(msg.id);
        reject(new Error(`Timed out waiting for response to ${msg.type} (id=${msg.id.slice(0,8)})`));
      }, timeoutMs);

      this.pendingAcks.set(msg.id, { resolve, reject, timeoutHandle });

      if (!this._sendTo(ws, msg)) {
        clearTimeout(timeoutHandle);
        this.pendingAcks.delete(msg.id);
        reject(new Error("Failed to send message — connection closed"));
      }
    });
  }

  // ── Heartbeat ─────────────────────────────────────────────────────────────

  _startHeartbeat() {
    this._heartbeatTimer = setInterval(() => {
      const now = Date.now();
      for (const [clientId, client] of this.clients) {
        if (client.ws.readyState !== WebSocket.OPEN) {
          this.clients.delete(clientId);
          continue;
        }
        // Drop client if pong is overdue (2x heartbeat interval)
        if (now - client.lastPong > HEARTBEAT_MS * 2) {
          renderer.agentLog("system", "warn",
            `Dropping stale client [${clientId.slice(0, 8)}]`);
          client.ws.terminate();
          this.clients.delete(clientId);
          continue;
        }
        this._sendTo(client.ws, Messages.ping());
      }
    }, HEARTBEAT_MS);
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  // ── Status ────────────────────────────────────────────────────────────────

  isDeviceConnected() {
    return this.clients.size > 0 && !!this._getFirstClient();
  }

  getStatus() {
    return {
      port:             this.port,
      connected:        this.isDeviceConnected(),
      clientCount:      this.clients.size,
      pendingAcks:      this.pendingAcks.size,
    };
  }
}

module.exports = WebSocketBridgeServer;
