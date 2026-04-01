/**
 * src/core/bridgeProtocol.js
 * ZerathCode — Bridge Protocol Definitions (Phase 2)
 *
 * Phase 2 adds: Calendar, Alarms, WiFi, Bluetooth, DND, SMS, App launch.
 * Protocol envelope is unchanged — new actions flow through the same pipe.
 */

"use strict";

const MessageType = {
  ACTION:         "action",
  QUERY:          "query",
  PING:           "ping",
  HANDSHAKE:      "handshake",
  ACK:            "ack",
  ERROR:          "error",
  EVENT:          "event",
  STATE_SNAPSHOT: "state_snapshot",
  PONG:           "pong",
};

// ── Phase 1 actions ───────────────────────────────────────────────────────────
const ActionType = {
  SET_SILENT_MODE:    "SET_SILENT_MODE",
  SET_VIBRATION:      "SET_VIBRATION",
  SET_BRIGHTNESS:     "SET_BRIGHTNESS",
  SEND_NOTIFICATION:  "SEND_NOTIFICATION",
  LOG_ONLY:           "LOG_ONLY",

  // ── Phase 2: Calendar ───────────────────────────────────────────────────────
  CREATE_CALENDAR_EVENT: "CREATE_CALENDAR_EVENT",
  DELETE_CALENDAR_EVENT: "DELETE_CALENDAR_EVENT",
  QUERY_CALENDAR:        "QUERY_CALENDAR",

  // ── Phase 2: Alarms ─────────────────────────────────────────────────────────
  SET_ALARM:    "SET_ALARM",
  DISMISS_ALARM:"DISMISS_ALARM",

  // ── Phase 2: Connectivity ───────────────────────────────────────────────────
  SET_WIFI:      "SET_WIFI",
  SET_BLUETOOTH: "SET_BLUETOOTH",
  SET_DND_MODE:  "SET_DND_MODE",

  // ── Phase 2: Apps & Messaging ───────────────────────────────────────────────
  LAUNCH_APP: "LAUNCH_APP",
  SEND_SMS:   "SEND_SMS",
};

const EventType = {
  BATTERY_LOW:          "BATTERY_LOW",
  CHARGING_STARTED:     "CHARGING_STARTED",
  CHARGING_STOPPED:     "CHARGING_STOPPED",
  ENTERED_ZONE:         "ENTERED_ZONE",
  EXITED_ZONE:          "EXITED_ZONE",
  NOTIFICATION_RECEIVED:"NOTIFICATION_RECEIVED",
};

function buildMessage(type, payload = {}, id = null) {
  return {
    id:        id || crypto.randomUUID(),
    type,
    payload,
    timestamp: Date.now(),
  };
}

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

function validateMessage(raw) {
  if (!raw || typeof raw !== "object") return false;
  if (!raw.id || typeof raw.id !== "string") return false;
  if (!raw.type || typeof raw.type !== "string") return false;
  if (typeof raw.timestamp !== "number") return false;
  return true;
}

// ── Action param schemas (used by fullAiOrchestrator to build correct prompts) ─
const ACTION_SCHEMAS = {
  SET_SILENT_MODE:    { mode: '"SILENT"|"VIBRATE"|"NORMAL"' },
  SET_BRIGHTNESS:     { level: "0-255", auto: "boolean" },
  SET_VIBRATION:      { level: "0|1" },
  SEND_NOTIFICATION:  { title: "string", text: "string" },
  LOG_ONLY:           { message: "string" },

  CREATE_CALENDAR_EVENT: {
    title: "string (required)",
    startMs: "epoch ms (required)",
    endMs: "epoch ms (required)",
    description: "string (optional)",
    location: "string (optional)",
    allDay: "boolean (optional)",
  },
  DELETE_CALENDAR_EVENT: { eventId: "long — calendar event ID" },
  QUERY_CALENDAR: {
    startMs: "epoch ms — search start",
    endMs: "epoch ms — search end",
    maxResults: "int (default 10)",
  },

  SET_ALARM: {
    hour: "0-23 (required)",
    minute: "0-59 (required)",
    label: "string (optional)",
    skipUi: "boolean — if true, silent alarm (default false)",
    vibrate: "boolean (default true)",
  },
  DISMISS_ALARM: { label: "string — match alarm label (optional)" },

  SET_WIFI:      { enabled: "boolean" },
  SET_BLUETOOTH: { enabled: "boolean" },
  SET_DND_MODE:  { mode: '"TOTAL_SILENCE"|"ALARMS_ONLY"|"PRIORITY"|"OFF"' },

  LAUNCH_APP: { packageName: "string — e.g. com.whatsapp" },
  SEND_SMS:   { to: "phone number", body: "message text", silent: "boolean (default false)" },
};

module.exports = {
  MessageType,
  ActionType,
  EventType,
  ACTION_SCHEMAS,
  buildMessage,
  Messages,
  validateMessage,
};
