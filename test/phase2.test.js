/**
 * test/phase2.test.js
 * ZerathCode — Phase 2 Action Types Integration Test
 *
 * Tests all new action types flow correctly through the bridge.
 * Run: node test/phase2.test.js
 *
 * Simulates Android device responses for:
 *  - Calendar: create, query, delete
 *  - Alarms: set, dismiss
 *  - Connectivity: wifi, bluetooth, dnd
 *  - Apps: launch, sms
 */

"use strict";

const WebSocket = require("ws");
const { Messages, MessageType, ActionType } = require("../src/core/bridgeProtocol");
const { getDeviceBridge } = require("../src/core/deviceBridge");

const PASS = "\x1b[32m✔\x1b[0m";
const FAIL = "\x1b[31m✖\x1b[0m";
const INFO = "\x1b[36mℹ\x1b[0m";

// Simulate Android app responses for each action type
const ACTION_RESPONSES = {
  CREATE_CALENDAR_EVENT: { success: true,  message: "Calendar event created: \"Meeting\" (id=1001)" },
  DELETE_CALENDAR_EVENT: { success: true,  message: "Calendar event 1001 deleted" },
  QUERY_CALENDAR:        { success: true,  message: "Found 2 event(s)", data: {
    events: [
      { id: 1001, title: "Team Meeting", startMs: Date.now() + 3600000, endMs: Date.now() + 7200000, location: "Room 4" },
      { id: 1002, title: "Lunch",        startMs: Date.now() + 14400000, endMs: Date.now() + 18000000 },
    ]
  }},
  SET_ALARM:             { success: true,  message: "Alarm set for 7:30 — Wake up" },
  DISMISS_ALARM:         { success: true,  message: "Alarm dismiss request sent" },
  SET_WIFI:              { success: true,  message: "WiFi settings panel opened" },
  SET_BLUETOOTH:         { success: true,  message: "Bluetooth enabled" },
  SET_DND_MODE:          { success: true,  message: "DND mode set to ALARMS_ONLY" },
  LAUNCH_APP:            { success: true,  message: "Launched com.whatsapp" },
  SEND_SMS:              { success: true,  message: "SMS app opened pre-filled to +1234567890" },
};

async function runTest() {
  console.log("\n\x1b[36m── Phase 2 Action Types Test ────────────────────\x1b[0m\n");

  const bridge = getDeviceBridge();
  bridge.start();
  await sleep(200);
  console.log(`${PASS}  Bridge server started`);

  // Connect mock Android client
  const ws = new WebSocket("ws://localhost:8765");

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Timeout")), 5000);
    ws.on("open", () => { clearTimeout(t); resolve(); });
    ws.on("error", (e) => { clearTimeout(t); reject(e); });
  });
  console.log(`${PASS}  Mock device connected\n`);

  // Handle all messages
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());

    // Respond to handshake with state snapshot including Phase 2 permissions
    if (msg.type === MessageType.HANDSHAKE) {
      ws.send(JSON.stringify(Messages.stateSnapshot({
        ringerMode:        "NORMAL",
        brightness:        128,
        batteryLevel:      85,
        isCharging:        false,
        dndPolicyGranted:  true,
        calendarGranted:   true,
        smsGranted:        true,
        writeSettingsGranted: true,
        timestamp:         Date.now(),
      })));
    }

    if (msg.type === MessageType.PING) {
      ws.send(JSON.stringify(Messages.pong(msg.id)));
    }

    if (msg.type === MessageType.ACTION) {
      const actionType = msg.payload.actionType;
      const mockResponse = ACTION_RESPONSES[actionType] || { success: true, message: `${actionType} executed` };
      ws.send(JSON.stringify(Messages.ack(msg.id, {
        ...mockResponse,
        actionType,
        skipped: false,
      })));
    }

    if (msg.type === MessageType.QUERY) {
      ws.send(JSON.stringify({
        id:        msg.id,
        type:      MessageType.STATE_SNAPSHOT,
        payload:   { ringerMode: "NORMAL", brightness: 128, batteryLevel: 85, isCharging: false },
        timestamp: Date.now(),
      }));
    }
  });

  await sleep(300);

  // ── Test all Phase 2 action types ─────────────────────────────────────────
  const tests = [
    {
      label: "CREATE_CALENDAR_EVENT",
      actionType: ActionType.CREATE_CALENDAR_EVENT,
      params: {
        title:       "AI-Scheduled Meeting",
        startMs:     Date.now() + 3600000,
        endMs:       Date.now() + 7200000,
        description: "Created by ZerathCode AI",
        location:    "Conference Room A",
      },
    },
    {
      label: "QUERY_CALENDAR",
      actionType: ActionType.QUERY_CALENDAR,
      params: { startMs: Date.now(), endMs: Date.now() + 7 * 24 * 3600000, maxResults: 10 },
    },
    {
      label: "DELETE_CALENDAR_EVENT",
      actionType: ActionType.DELETE_CALENDAR_EVENT,
      params: { eventId: 1001 },
    },
    {
      label: "SET_ALARM",
      actionType: ActionType.SET_ALARM,
      params: { hour: 7, minute: 30, label: "Wake up", skipUi: false, vibrate: true },
    },
    {
      label: "DISMISS_ALARM",
      actionType: ActionType.DISMISS_ALARM,
      params: { label: "Wake up" },
    },
    {
      label: "SET_WIFI (enable)",
      actionType: ActionType.SET_WIFI,
      params: { enabled: true },
    },
    {
      label: "SET_BLUETOOTH (enable)",
      actionType: ActionType.SET_BLUETOOTH,
      params: { enabled: true },
    },
    {
      label: "SET_DND_MODE (alarms only)",
      actionType: ActionType.SET_DND_MODE,
      params: { mode: "ALARMS_ONLY" },
    },
    {
      label: "LAUNCH_APP",
      actionType: ActionType.LAUNCH_APP,
      params: { packageName: "com.whatsapp" },
    },
    {
      label: "SEND_SMS (via intent)",
      actionType: ActionType.SEND_SMS,
      params: { to: "+1234567890", body: "Hello from ZerathCode AI", silent: false },
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      const result = await bridge.execute(test.actionType, test.params);
      if (result?.success) {
        console.log(`${PASS}  ${test.label}: ${result.message}`);
        if (result.data?.events) {
          result.data.events.forEach(e => {
            console.log(`     ${INFO} Event: "${e.title}" at ${new Date(e.startMs).toLocaleTimeString()}`);
          });
        }
        passed++;
      } else {
        console.log(`${FAIL}  ${test.label} failed: ${result?.message}`);
        failed++;
      }
    } catch (err) {
      console.log(`${FAIL}  ${test.label} threw: ${err.message}`);
      failed++;
    }
  }

  // Summary
  console.log(`\n  Results: ${passed}/${tests.length} passed`);

  ws.close();
  bridge.stop();

  if (failed === 0) {
    console.log("\n\x1b[32m  All Phase 2 action tests passed ✔\x1b[0m");
    console.log("\x1b[90m  Ready to proceed to Phase 3 — Document Intelligence.\x1b[0m\n");
    process.exit(0);
  } else {
    console.log(`\n\x1b[31m  ${failed} test(s) failed.\x1b[0m\n`);
    process.exit(1);
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

runTest().catch((err) => {
  console.error(`\n\x1b[31m  Test suite error: ${err.message}\x1b[0m\n`);
  process.exit(1);
});
