/**
 * src/core/proactiveAgent.js
 * ZerathCode — Proactive Agent (Phase 4)
 *
 * Watches the device event stream and suggests new automations
 * the user hasn't defined yet. This is the beginning of the
 * "adaptation" layer from the platform vision.
 *
 * Message types:
 *   analyze_events  — send recent event history, get suggestions
 *   explain_pattern — explain why a suggestion was made
 *
 * Suggestion triggers:
 *   - User repeatedly does X after event Y → suggest automating it
 *   - Device enters zone but no rules fire → suggest zone rules
 *   - Battery repeatedly hits threshold → suggest power rules
 *   - Repeated notification patterns → suggest notification rules
 */

"use strict";

const AiClient = require("../utils/aiClient");
const renderer = require("../ui/renderer");

// ── System prompt ─────────────────────────────────────────────────────────────

const PROACTIVE_SYSTEM = `You are an intelligent mobile automation advisor.
You are given a history of device events and existing automation rules.
Your job is to identify patterns the user hasn't automated yet and suggest new rules.

OUTPUT: Respond ONLY with valid JSON — no markdown, no explanation outside the JSON.

Schema:
{
  "suggestions": [
    {
      "id": "unique_id_string",
      "title": "Short rule title",
      "description": "Why this automation would help",
      "trigger": "What event triggers it",
      "action": "What it should do",
      "confidence": 0.0-1.0,
      "patternStrength": "weak|moderate|strong",
      "conditionJson": { "eventType": "...", "cooldownMs": 30000 },
      "actionJson": { "actionType": "...", "params": {} }
    }
  ],
  "insights": [
    "Brief observation about device usage pattern"
  ]
}

RULES:
- Only suggest automations that are clearly beneficial and non-intrusive.
- Never suggest SMS or app-launch automations unless the pattern is very clear.
- Keep conditionJson and actionJson valid — they must match the rule schema exactly.
- confidence=1.0 means "very strongly suggest", 0.3 means "possible but uncertain".
- Limit to 3 suggestions maximum per analysis.
- If no clear patterns, return empty suggestions array.`;

// ── Proactive agent ───────────────────────────────────────────────────────────

class ProactiveAgent {
  constructor(opts) {
    this.provider   = opts.provider;
    this.keyManager = opts.keyManager;
    this.ai         = new AiClient(opts.keyManager);
  }

  async handle(message) {
    const { type, payload, id } = message;

    switch (type) {
      case "analyze_events":  return this._analyzeEvents(id, payload);
      case "explain_pattern": return this._explainPattern(id, payload);
      default:                return null;
    }
  }

  // ── Event pattern analysis ────────────────────────────────────────────────

  async _analyzeEvents(msgId, payload) {
    const { events, existingRules, deviceState } = payload;

    if (!Array.isArray(events) || events.length < 5) {
      return this._ack(msgId, {
        suggestions: [],
        insights:    ["Not enough event history yet. Keep using the device and check back later."],
        actionType:  "analyze_events",
      });
    }

    renderer.agentLog("ai", "info",
      `Proactive analysis: ${events.length} events, ${existingRules?.length || 0} existing rules`);

    const prompt = this._buildAnalysisPrompt(events, existingRules, deviceState);

    try {
      const raw = await this.ai.ask(this.provider, prompt, {
        systemPrompt: PROACTIVE_SYSTEM,
        maxTokens:    1500,
      });

      const parsed = this._parseJson(raw);
      if (!parsed) {
        return this._error(msgId, "AI returned invalid JSON for pattern analysis");
      }

      const suggestions = (parsed.suggestions || []).filter((s) =>
        s.id && s.title && s.confidence >= 0 && s.conditionJson && s.actionJson
      );

      renderer.agentLog("ai", "ok",
        `Proactive: ${suggestions.length} suggestion(s), ${parsed.insights?.length || 0} insight(s)`);

      return this._ack(msgId, {
        suggestions: suggestions,
        insights:    parsed.insights || [],
        actionType:  "analyze_events",
      });
    } catch (err) {
      renderer.agentLog("ai", "error", `Proactive analysis failed: ${err.message}`);
      return this._error(msgId, err.message);
    }
  }

  // ── Explain a suggestion ──────────────────────────────────────────────────

  async _explainPattern(msgId, payload) {
    const { suggestionId, title, description, events } = payload;

    const prompt = `A mobile automation system suggested this rule to the user:

Title: ${title}
Description: ${description}

Recent events that led to this suggestion:
${(events || []).slice(0, 10).map((e) =>
  `  ${new Date(e.timestamp).toLocaleTimeString()} — ${e.eventType} (${e.module})`
).join("\n")}

Explain in 2-3 plain sentences WHY this automation would be useful for this user.
Be specific about the observed pattern. Speak directly to the user ("When you...").
Do NOT use markdown. Plain text only.`;

    try {
      const explanation = await this.ai.ask(this.provider, prompt, {
        maxTokens: 200,
      });

      return this._ack(msgId, {
        suggestionId: suggestionId,
        explanation:  explanation.trim(),
        actionType:   "explain_pattern",
      });
    } catch (err) {
      return this._error(msgId, err.message);
    }
  }

  // ── Prompt builder ────────────────────────────────────────────────────────

  _buildAnalysisPrompt(events, existingRules, deviceState) {
    // Summarize event frequency
    const eventCounts = {};
    for (const e of events) {
      const key = `${e.module}/${e.eventType}`;
      eventCounts[key] = (eventCounts[key] || 0) + 1;
    }
    const eventSummary = Object.entries(eventCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `  ${k}: ${n}×`)
      .join("\n");

    // Recent events timeline (last 30)
    const timeline = events.slice(-30).map((e) =>
      `  ${new Date(e.timestamp).toLocaleTimeString()} — ${e.module}/${e.eventType}` +
      (e.data?.level ? ` (level=${e.data.level})` : "") +
      (e.data?.locationName ? ` (zone=${e.data.locationName})` : "")
    ).join("\n");

    // Existing rules summary
    const rulesSummary = (existingRules || []).length > 0
      ? existingRules.map((r) => `  - "${r.name}" (${r.isEnabled ? "enabled" : "disabled"})`).join("\n")
      : "  (none)";

    return `DEVICE EVENT ANALYSIS

Event frequency summary (last ${events.length} events):
${eventSummary}

Recent event timeline:
${timeline}

Currently configured automation rules:
${rulesSummary}

Device state:
  Battery: ${deviceState?.batteryLevel ?? "?"}%  Charging: ${deviceState?.isCharging ?? "?"}
  Ringer: ${deviceState?.ringerMode ?? "?"}

Identify 1-3 automation opportunities not covered by existing rules.
Focus on: battery patterns, location patterns, notification patterns, charging patterns.`;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _parseJson(raw) {
    try {
      const clean = raw.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
      const start = clean.indexOf("{");
      const end   = clean.lastIndexOf("}");
      if (start === -1 || end === -1) return null;
      return JSON.parse(clean.slice(start, end + 1));
    } catch { return null; }
  }

  _ack(msgId, payload) {
    return { id: msgId, type: "ack", payload: { success: true, ...payload }, timestamp: Date.now() };
  }

  _error(msgId, message) {
    return { id: msgId, type: "error", payload: { message }, timestamp: Date.now() };
  }
}

module.exports = ProactiveAgent;
