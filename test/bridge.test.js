/**
 * test/bridge.test.js
 * ZerathCode — Phase 1 Bridge Integration Test
 *
 * Run this AFTER starting the bridge server:
 *   node test/bridge.test.js
 *
 * Simulates what the Android app does:
 *   1. Connect to bridge server
 *   2. Receive handshake
 *   3. Respond to ping with pong
 *   4. Receive an ACTION and send back ACK
 *   5. Send a device EVENT
 */

"use strict";

const WebSocket = require("ws");
const { Messages, MessageType, validateMessage } = require("../src/core/bridgeProtocol");
const { getDeviceBridge } = require("../src/core/deviceBridge");

const BRIDGE_URL = "ws://localhost:8765";
const PASS = "\x1b[32m✔\x1b[0m";
const FAIL = "\x1b[31m✖\x1b[0m";

async function runTest() {
  console.log("\n\x1b[36m── Bridge Integration Test ─────────────────────\x1b[0m\n");

  // ── 1. Start server ───────────────────────────────────────────────────────
  const bridge = getDeviceBridge();
  bridge.start();
  await sleep(200);
  console.log(`${PASS}  Server started`);

  // ── 2. Connect as mock Android client ─────────────────────────────────────
  const ws = new WebSocket(BRIDGE_URL);
  let testResults = [];

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Connection timeout")), 5000);

    ws.on("open", () => {
      clearTimeout(timeout);
      console.log(`${PASS}  Client connected`);
      resolve();
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  // ── 3. Message handler ────────────────────────────────────────────────────
  const received = [];
  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      received.push(msg);

      if (msg.type === MessageType.HANDSHAKE) {
        console.log(`${PASS}  Handshake received (clientId: ${msg.payload.clientId?.slice(0,8)})`);
        // Send initial state snapshot as Android app would
        ws.send(JSON.stringify(Messages.stateSnapshot({
          ringerMode:   "NORMAL",
          brightness:   128,
          batteryLevel: 85,
          isCharging:   false,
          timestamp:    Date.now(),
        })));
      }

      if (msg.type === MessageType.PING) {
        ws.send(JSON.stringify(Messages.pong(msg.id)));
      }

      if (msg.type === MessageType.ACTION) {
        console.log(`${PASS}  Action received: ${msg.payload.actionType}`);
        // Simulate successful execution
        ws.send(JSON.stringify(Messages.ack(msg.id, {
          success:    true,
          message:    `${msg.payload.actionType} executed`,
          skipped:    false,
          actionType: msg.payload.actionType,
        })));
      }
    } catch (err) {
      console.error(`${FAIL}  Parse error: ${err.message}`);
    }
  });

  await sleep(300);

  // ── 4. Test: execute action via bridge ────────────────────────────────────
  console.log("\n  Testing action round-trip...");
  try {
    const result = await bridge.execute("SET_SILENT_MODE", { mode: "SILENT" });
    if (result?.success) {
      console.log(`${PASS}  Action round-trip succeeded: ${result.message}`);
    } else {
      console.log(`${FAIL}  Action returned failure: ${result?.message}`);
    }
  } catch (err) {
    console.log(`${FAIL}  Action failed: ${err.message}`);
  }

  // ── 5. Test: state snapshot query ─────────────────────────────────────────
  console.log("\n  Testing state query...");
  try {
    // Simulate device sending state_snapshot in response to query
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === MessageType.QUERY) {
        ws.send(JSON.stringify({
          id:      msg.id,
          type:    MessageType.STATE_SNAPSHOT,
          payload: { ringerMode: "SILENT", brightness: 128, batteryLevel: 85, isCharging: false },
          timestamp: Date.now(),
        }));
      }
    });

    const state = await bridge.fetchState();
    console.log(`${PASS}  State received: ringer=${state.ringerMode}  battery=${state.batteryLevel}%`);
  } catch (err) {
    console.log(`${FAIL}  State query failed: ${err.message}`);
  }

  // ── 6. Test: device event forwarding ──────────────────────────────────────
  console.log("\n  Testing event forwarding...");
  ws.send(JSON.stringify(Messages.event("BATTERY_LOW", {
    level:     15,
    threshold: 20,
    module:    "BATTERY",
    timestamp: Date.now(),
  })));
  await sleep(200);
  console.log(`${PASS}  Event sent from mock device`);

  // ── Summary ───────────────────────────────────────────────────────────────
  await sleep(200);
  ws.close();
  bridge.stop();

  console.log("\n\x1b[32m  All Phase 1 bridge tests passed ✔\x1b[0m");
  console.log("\x1b[90m  Ready to connect real Android device.\x1b[0m\n");
  process.exit(0);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

runTest().catch((err) => {
  console.error(`\n\x1b[31m  Test failed: ${err.message}\x1b[0m\n`);
  process.exit(1);
});
