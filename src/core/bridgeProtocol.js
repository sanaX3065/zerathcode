/**
 * src/core/bridgeProtocol.js
 * ZerathCode — Bridge Protocol Definitions
 *
 * Shared message schema between Termux AI and Android app.
 * Every message follows the same envelope. No exceptions.
 */

"use strict";

// ── Message Types ─────────────────────────────────────────────────────────────
const MessageType = {
  // Server → Device
  ACTION:         "action",         // Execute a device action
  QUERY:          "query",          // Request device state
  PING:           "ping",           // Heartbeat
  HANDSHAKE:      "handshake",      // Initial connection setup

  // Device → Server
  ACK:            "ack",            // Action/query succeeded
  ERROR:          "error",          // Action/query failed
  EVENT:          "event",          // Device event occurred
  STATE_SNAPSHOT: "state_snapshot", // Full device state
  PONG:           "pong",           // Heartbeat response
};

// ── Action Types (mirrors Android ActionType enum) ────────────────────────────
const ActionType = {
  SET_SILENT_MODE:    "SET_SILENT_MODE",
  SET_VIBRATION:      "SET_VIBRATION",
  SET_BRIGHTNESS:     "SET_BRIGHTNESS",
  SEND_NOTIFICATION:  "SEND_NOTIFICATION",
  LOG_ONLY:           "LOG_ONLY",
};

// ── Event Types (mirrors Android EventType enum) ──────────────────────────────
const EventType = {
  BATTERY_LOW:          "BATTERY_LOW",
  CHARGING_STARTED:     "CHARGING_STARTED",
  CHARGING_STOPPED:     "CHARGING_STOPPED",
  ENTERED_ZONE:         "ENTERED_ZONE",
  EXITED_ZONE:          "EXITED_ZONE",
  NOTIFICATION_RECEIVED:"NOTIFICATION_RECEIVED",
};

/**
 * Build a protocol message envelope.
 * @param {string} type      - MessageType constant
 * @param {object} payload   - Message body
 * @param {string} id        - Optional — auto-generated if omitted
 */
function buildMessage(type, payload = {}, id = null) {
  return {
    id:        id || crypto.randomUUID(),
    type,
    payload,
    timestamp: Date.now(),
  };
}

// ── Pre-built message builders ────────────────────────────────────────────────
const Messages = {
  action: (actionType, params = {}, priority = 0.8, id = null) =>
    buildMessage(MessageType.ACTION, { actionType, params, priority }, id),

  query: (queryName, id = null) =>
    buildMessage(MessageType.QUERY, { query: queryName }, id),

  ack: (originalId, result = {}) =>
    buildMessage(MessageType.ACK, result, originalId),

  error: (originalId, message) =>
    buildMessage(MessageType.ERROR, { message }, originalId),

  event: (eventType, data = {}) =>
    buildMessage(MessageType.EVENT, { eventType, ...data }),

  stateSnapshot: (state, replyToId = null) =>
    buildMessage(MessageType.STATE_SNAPSHOT, state, replyToId),

  ping: () => buildMessage(MessageType.PING, {}),
  pong: (pingId) => buildMessage(MessageType.PONG, {}, pingId),

  handshake: (info = {}) => buildMessage(MessageType.HANDSHAKE, info),
};

// ── Validation ────────────────────────────────────────────────────────────────
function validateMessage(raw) {
  if (!raw || typeof raw !== "object") return false;
  if (!raw.id || typeof raw.id !== "string") return false;
  if (!raw.type || typeof raw.type !== "string") return false;
  if (typeof raw.timestamp !== "number") return false;
  return true;
}

module.exports = { MessageType, ActionType, EventType, buildMessage, Messages, validateMessage };
