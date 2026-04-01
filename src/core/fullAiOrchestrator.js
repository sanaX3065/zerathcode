/**
 * src/core/fullAiOrchestrator.js
 * ZerathCode — Full AI Mode Orchestrator (Phase 2)
 *
 * Phase 2 adds calendar, alarm, WiFi, Bluetooth, DND, SMS, app launch
 * to the action space the AI can use.
 */

"use strict";

const AiClient            = require("../utils/aiClient");
const { getDeviceBridge } = require("./deviceBridge");
const renderer            = require("../ui/renderer");
const { C }               = require("../ui/renderer");
const { ActionType, ACTION_SCHEMAS } = require("./bridgeProtocol");

// ── Build system prompt dynamically from ACTION_SCHEMAS ───────────────────────
function buildSystemPrompt() {
  const actionDocs = Object.entries(ACTION_SCHEMAS)
    .map(([name, params]) => {
      const paramStr = Object.entries(params)
        .map(([k, v]) => `      ${k}: ${v}`)
        .join("\n");
      return `  ${name}\n    params:\n${paramStr}`;
    })
    .join("\n\n");

  return `You are the ZerathCode Mobile AI Agent — a persistent intelligence layer
controlling an Android device in real-time via a WebSocket bridge.

You receive:
- DEVICE STATE: current device snapshot (brightness, ringer, battery, permissions, etc.)
- USER INTENT: what the user wants to happen

You respond with ONLY a valid JSON array of action steps.

AVAILABLE ACTIONS:
${actionDocs}

CALENDAR NOTES:
- Times are epoch milliseconds. Convert "tomorrow at 3pm" to the correct epoch value.
- Always use QUERY_CALENDAR first if the user asks about existing events.
- If calendarGranted is false in device state, inform user to grant READ/WRITE_CALENDAR.

ALARM NOTES:
- Use SET_ALARM with skipUi:false for user-visible alarms (recommended).
- Use skipUi:true only when automation requires silent scheduling.

CONNECTIVITY NOTES:
- On Android 10+, SET_WIFI opens the settings panel (user confirms).
- SET_BLUETOOTH on Android 13+ also requires user confirmation.
- SET_DND_MODE requires dndPolicyGranted:true in device state.

RESPONSE FORMAT (always this exact structure):
[
  { "action": "think",  "params": { "reasoning": "Brief step-by-step reasoning" } },
  { "action": "device", "params": { "actionType": "SET_ALARM", "params": { "hour": 7, "minute": 30, "label": "Wake up" }, "priority": 0.9 } },
  { "action": "message","params": { "text": "Alarm set for 7:30 AM." } }
]

RULES:
1. Always start with a "think" step. Reason explicitly about: what the user wants, what device state says, what actions to take.
2. Use "device" steps for all device actions — never invent action types.
3. End with a "message" step summarising exactly what was done or why something failed.
4. Check device state BEFORE acting. If a permission is missing, explain it in the message.
5. For time-based actions, compute epoch ms correctly. Current time is in device state timestamp.
6. NEVER fabricate results. If bridge returns failure, report it honestly.
7. Return ONLY the JSON array. Nothing before [ or after ].

FINAL REMINDER: Your response must start with [ and end with ]. No text outside the array.`;
}

class FullAiOrchestrator {
  constructor(opts) {
    this.provider   = opts.provider;
    this.keyManager = opts.keyManager;
    this.memory     = opts.memory;
    this.bridge     = getDeviceBridge();
    this.ai         = new AiClient(opts.keyManager);
    this._systemPrompt = buildSystemPrompt();
  }

  async process(userInput) {
    this.memory.addUserMessage(userInput);
    renderer.userMessage(userInput);

    // ── Step 1: Fetch device state ─────────────────────────────────────────
    let deviceState = this.bridge.getLastKnownState();

    if (this.bridge.isDeviceConnected()) {
      try {
        deviceState = await this.bridge.fetchState();
        renderer.agentLog("system", "ok",
          `Device: battery=${deviceState.batteryLevel}% ringer=${deviceState.ringerMode}`);
      } catch (err) {
        renderer.agentLog("system", "warn", `State fetch failed: ${err.message}`);
      }
    } else {
      renderer.agentLog("system", "warn", "No device connected — planning-only mode");
    }

    // ── Step 2: AI call ────────────────────────────────────────────────────
    const prompt = this._buildPrompt(userInput, deviceState);
    renderer.agentLog("ai", "info", `Planning with ${this.provider}…`);

    let raw;
    try {
      raw = await this.ai.ask(this.provider, prompt, {
        systemPrompt: this._systemPrompt,
        maxTokens:    2048,
      });
    } catch (err) {
      renderer.errorBox("AI Error", err.message);
      return;
    }

    const steps = this._parseSteps(raw);
    if (!steps || steps.length === 0) {
      renderer.aiMessage(raw.slice(0, 2000), this.provider);
      return;
    }

    // ── Step 3: Execute ────────────────────────────────────────────────────
    let assistantSummary = "";
    for (const step of steps) {
      const result = await this._executeStep(step);
      if (result) assistantSummary += result + "\n";
    }

    // ── Step 4: Post-execution state ───────────────────────────────────────
    if (this.bridge.isDeviceConnected()) {
      try {
        const newState = await this.bridge.fetchState();
        renderer.agentLog("system", "info",
          `State after: ringer=${newState.ringerMode} brightness=${newState.brightness}`);
      } catch {}
    }

    if (assistantSummary.trim()) {
      this.memory.addAssistantMessage(assistantSummary.trim());
    }
  }

  // ── Step executor ─────────────────────────────────────────────────────────

  async _executeStep(step) {
    const { action, params = {} } = step;

    switch (action) {
      case "think": {
        renderer.agentLog("ai", "plan", params.reasoning?.slice(0, 120) || "Thinking…");
        return null;
      }

      case "device": {
        const { actionType, params: actionParams, priority } = params;

        if (!actionType || !ActionType[actionType]) {
          renderer.agentLog("system", "warn", `Unknown actionType: ${actionType}`);
          return null;
        }

        if (!this.bridge.isDeviceConnected()) {
          renderer.agentLog("system", "warn", `Cannot execute ${actionType} — no device`);
          return `[Planned] ${actionType} — device not connected`;
        }

        try {
          const result = await this.bridge.execute(actionType, actionParams || {}, priority || 0.8);

          // If result contains calendar data, display it
          if (result?.data?.events) {
            this._displayCalendarEvents(result.data.events);
          }

          return result?.message || null;
        } catch (err) {
          renderer.agentLog("system", "error", `Bridge error: ${err.message}`);
          return `Error executing ${actionType}: ${err.message}`;
        }
      }

      case "message": {
        renderer.aiMessage(params.text || "", this.provider);
        return params.text;
      }

      case "plan": {
        if (Array.isArray(params.steps)) renderer.planBlock(params.steps);
        return null;
      }

      default:
        renderer.agentLog("system", "warn", `Unknown step: "${action}"`);
        return null;
    }
  }

  // ── Calendar display helper ────────────────────────────────────────────────

  _displayCalendarEvents(events) {
    if (!Array.isArray(events) || events.length === 0) {
      renderer.agentLog("system", "info", "No calendar events found in range");
      return;
    }

    const { C } = require("../ui/renderer");
    console.log(`\n${C.bcyan}── Calendar Events (${events.length}) ─────────────────────${C.reset}`);
    events.forEach((e) => {
      const start = new Date(e.startMs).toLocaleString();
      const title = e.title || "(no title)";
      const loc   = e.location ? `  📍 ${e.location}` : "";
      console.log(`  ${C.yellow}${start}${C.reset}  ${title}${C.grey}${loc}${C.reset}`);
    });
    console.log("");
  }

  // ── Prompt builder ────────────────────────────────────────────────────────

  _buildPrompt(userInput, deviceState) {
    const stateBlock = deviceState
      ? `DEVICE STATE:\n${JSON.stringify(deviceState, null, 2)}`
      : "DEVICE STATE: Unknown (device not connected)";

    const history = this.memory.getHistory(6);
    const histBlock = history.length > 1
      ? history.slice(0, -1)
          .map((m) => `${m.role === "user" ? "User" : "AI"}: ${m.content.slice(0, 200)}`)
          .join("\n")
      : "";

    return [
      histBlock ? `RECENT CONVERSATION:\n${histBlock}\n` : "",
      stateBlock,
      "",
      `USER INTENT: ${userInput}`,
    ].filter(Boolean).join("\n");
  }

  // ── Parse AI JSON response ────────────────────────────────────────────────

  _parseSteps(raw) {
    if (!raw || typeof raw !== "string") return null;
    let str = raw.trim();
    const fence = str.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) str = fence[1].trim();
    const s = str.indexOf("[");
    const e = str.lastIndexOf("]");
    if (s === -1 || e === -1) return null;
    try {
      const parsed = JSON.parse(str.slice(s, e + 1));
      return Array.isArray(parsed)
        ? parsed.filter((x) => x && typeof x.action === "string")
        : null;
    } catch {
      return null;
    }
  }

  shutdown() {}
}

module.exports = FullAiOrchestrator;
