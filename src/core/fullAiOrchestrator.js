/**
 * src/core/fullAiOrchestrator.js
 * ZerathCode — Full AI Mode Orchestrator
 *
 * Handles the fullai REPL mode.
 * Parses user intent → generates action plan → executes via DeviceBridge.
 * This is the "unified control loop" from the platform vision.
 *
 * Flow:
 *   User Prompt
 *     → fetch device state (context)
 *     → AI: parse intent + plan actions
 *     → execute actions via bridge
 *     → fetch updated state (feedback)
 *     → AI: summarise result
 */

"use strict";

const AiClient       = require("../utils/aiClient");
const { getDeviceBridge } = require("./deviceBridge");
const renderer       = require("../ui/renderer");
const { C }          = require("../ui/renderer");
const { ActionType } = require("./bridgeProtocol");

// ── System prompt for fullai mode ─────────────────────────────────────────────
const FULLAI_SYSTEM_PROMPT = `You are the ZerathCode Mobile AI Agent — a persistent intelligence layer
controlling an Android device in real-time via a WebSocket bridge.

You receive:
- DEVICE STATE: current device snapshot (brightness, ringer, battery, location, etc.)
- USER INTENT: what the user wants to happen

You respond with ONLY a valid JSON array of action steps.

AVAILABLE ACTIONS (use exact actionType strings):
  SET_SILENT_MODE    params: { mode: "SILENT"|"VIBRATE"|"NORMAL" }
  SET_BRIGHTNESS     params: { level: 0-255, auto: boolean }
  SET_VIBRATION      params: { level: 0|1 }
  SEND_NOTIFICATION  params: { title: string, text: string }
  LOG_ONLY           params: { message: string }

RESPONSE FORMAT:
[
  { "action": "think",  "params": { "reasoning": "Brief reasoning here" } },
  { "action": "device", "params": { "actionType": "SET_SILENT_MODE", "params": { "mode": "SILENT" }, "priority": 0.9 } },
  { "action": "message","params": { "text": "Done — your phone is now on silent." } }
]

RULES:
1. Always start with a "think" step explaining your reasoning.
2. Use "device" steps for all device actions — never invent action types.
3. End with a "message" step summarising what was done.
4. If intent is unclear, use a "message" step to ask for clarification — no device actions.
5. If device state shows action already satisfied, skip it and explain.
6. NEVER fabricate action results — only report what actually executed.
7. Return ONLY the JSON array. Nothing before or after [].

FINAL REMINDER: Your response must start with [ and end with ]. No text outside the array.`;

class FullAiOrchestrator {
  constructor(opts) {
    this.provider   = opts.provider;
    this.keyManager = opts.keyManager;
    this.memory     = opts.memory;
    this.bridge     = getDeviceBridge();
    this.ai         = new AiClient(opts.keyManager);
  }

  async process(userInput) {
    this.memory.addUserMessage(userInput);
    renderer.userMessage(userInput);

    // ── Step 1: Get device context ────────────────────────────────────────
    let deviceState = this.bridge.getLastKnownState();

    if (this.bridge.isDeviceConnected()) {
      try {
        deviceState = await this.bridge.fetchState();
        renderer.agentLog("system", "ok",
          `Device state: battery=${deviceState.batteryLevel}%  ringer=${deviceState.ringerMode}`);
      } catch (err) {
        renderer.agentLog("system", "warn", `Could not fetch device state: ${err.message}`);
      }
    } else {
      renderer.agentLog("system", "warn",
        "No device connected — running in planning-only mode");
    }

    // ── Step 2: Build prompt with device context ───────────────────────────
    const prompt = this._buildPrompt(userInput, deviceState);

    renderer.agentLog("ai", "info", `Planning with ${this.provider}…`);

    // ── Step 3: Get AI plan ───────────────────────────────────────────────
    let raw;
    try {
      raw = await this.ai.ask(this.provider, prompt, {
        systemPrompt: FULLAI_SYSTEM_PROMPT,
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

    // ── Step 4: Execute steps ─────────────────────────────────────────────
    let assistantSummary = "";

    for (const step of steps) {
      const result = await this._executeStep(step);
      if (result) assistantSummary += result + "\n";
    }

    // ── Step 5: Post-execution state feedback ─────────────────────────────
    if (this.bridge.isDeviceConnected()) {
      try {
        const newState = await this.bridge.fetchState();
        renderer.agentLog("system", "info",
          `Updated state: ringer=${newState.ringerMode}  brightness=${newState.brightness}`);
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
        renderer.agentLog("ai", "plan", params.reasoning?.slice(0, 100) || "Thinking…");
        return null;
      }

      case "device": {
        const { actionType, params: actionParams, priority } = params;

        if (!actionType || !ActionType[actionType]) {
          renderer.agentLog("system", "warn", `Unknown actionType: ${actionType}`);
          return null;
        }

        if (!this.bridge.isDeviceConnected()) {
          renderer.agentLog("system", "warn",
            `Cannot execute ${actionType} — no device connected`);
          return `[Planned] ${actionType} — device not connected`;
        }

        try {
          const result = await this.bridge.execute(actionType, actionParams || {}, priority || 0.8);
          return result?.message || null;
        } catch (err) {
          renderer.agentLog("system", "error", `Bridge action failed: ${err.message}`);
          return null;
        }
      }

      case "message": {
        renderer.aiMessage(params.text || "", this.provider);
        return params.text;
      }

      case "plan": {
        if (Array.isArray(params.steps)) {
          renderer.planBlock(params.steps);
        }
        return null;
      }

      default:
        renderer.agentLog("system", "warn", `Unknown step action: "${action}"`);
        return null;
    }
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

  // ── Parse AI response ─────────────────────────────────────────────────────

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

  shutdown() {
    // Bridge lifecycle managed separately
  }
}

module.exports = FullAiOrchestrator;
