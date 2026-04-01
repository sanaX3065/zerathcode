/**
 * src/core/documentQueryHandler.js
 * ZerathCode — Document Query Handler
 *
 * Handles document_query and document_risk messages from the Android app.
 * Receives RAG context from Android, calls the LLM, returns the answer.
 *
 * Message types added to bridge protocol:
 *   document_query  — Q&A against document chunks
 *   document_risk   — deep AI risk analysis
 */

"use strict";

const AiClient = require("../utils/aiClient");
const renderer = require("../ui/renderer");

// ── Prompts ───────────────────────────────────────────────────────────────────

const DOC_QA_SYSTEM = `You are a precise document analysis assistant.
You have been given excerpts from a document and a user question.

RULES:
- Answer ONLY from the provided document excerpts.
- If the answer is not in the excerpts, say: "This information is not in the provided document sections."
- Quote relevant passages when helpful. Keep quotes short (under 40 words).
- Be concise — 2-4 sentences unless the question requires more detail.
- Never invent facts not present in the excerpts.
- If excerpts contain tables or lists, preserve their structure.`;

const DOC_RISK_SYSTEM = `You are a document risk analyst. Analyze the document for legal, financial, and security risks.
Respond ONLY with valid JSON — no markdown, no explanation outside the JSON object.
The JSON must exactly match this schema:
{
  "overallRisk": "SAFE|LOW|MEDIUM|HIGH|CRITICAL",
  "contextualFlags": [{ "issue": "string", "severity": 1-5, "recommendation": "string" }],
  "missingClauses": ["list of expected clauses that appear absent"],
  "unusualTerms": ["any terms significantly outside standard practice"],
  "keyDates": ["important dates or deadlines found"],
  "oneLineSummary": "single sentence summarizing the document and its main risk"
}`;

// ── Handler ───────────────────────────────────────────────────────────────────

class DocumentQueryHandler {
  constructor(opts) {
    this.provider   = opts.provider;
    this.keyManager = opts.keyManager;
    this.ai         = new AiClient(opts.keyManager);
  }

  /**
   * Route a bridge message to the appropriate handler.
   * Returns a bridge message to send back, or null.
   */
  async handle(message) {
    const { type, payload, id } = message;

    switch (type) {
      case "document_query":
        return this._handleDocumentQuery(id, payload);
      case "document_risk":
        return this._handleDocumentRisk(id, payload);
      default:
        return null;
    }
  }

  // ── Document Q&A ──────────────────────────────────────────────────────────

  async _handleDocumentQuery(messageId, payload) {
    const { question, ragContext, documentId } = payload;

    if (!question || !ragContext) {
      return this._error(messageId, "Missing question or ragContext");
    }

    renderer.agentLog("ai", "info",
      `Doc Q&A: "${question.slice(0, 60)}" (doc ${documentId})`);

    const prompt = `${ragContext}\n\nQuestion: ${question}\n\nAnswer based only on the document excerpts above:`;

    try {
      const answer = await this.ai.ask(this.provider, prompt, {
        systemPrompt: DOC_QA_SYSTEM,
        maxTokens:    1024,
      });

      renderer.agentLog("ai", "ok", `Doc answer: ${answer.slice(0, 80)}…`);

      return {
        id:        messageId,
        type:      "ack",
        payload:   {
          success:    true,
          answer:     answer.trim(),
          documentId: documentId,
          actionType: "document_query",
        },
        timestamp: Date.now(),
      };
    } catch (err) {
      renderer.agentLog("ai", "error", `Doc Q&A failed: ${err.message}`);
      return this._error(messageId, `AI call failed: ${err.message}`);
    }
  }

  // ── Document risk analysis ────────────────────────────────────────────────

  async _handleDocumentRisk(messageId, payload) {
    const { prompt, documentId } = payload;

    if (!prompt) {
      return this._error(messageId, "Missing risk prompt");
    }

    renderer.agentLog("ai", "info", `Deep risk analysis for doc ${documentId}`);

    try {
      const raw = await this.ai.ask(this.provider, prompt, {
        systemPrompt: DOC_RISK_SYSTEM,
        maxTokens:    2048,
      });

      // Parse and validate the JSON response
      let riskJson;
      try {
        // Strip any accidental markdown fences
        const clean = raw.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
        const start = clean.indexOf("{");
        const end   = clean.lastIndexOf("}");
        riskJson = JSON.parse(clean.slice(start, end + 1));
      } catch (parseErr) {
        renderer.agentLog("ai", "warn", "Risk JSON parse failed — returning raw");
        riskJson = { raw, parseError: parseErr.message };
      }

      renderer.agentLog("ai", "ok",
        `Risk: ${riskJson.overallRisk || "unknown"} — ${riskJson.oneLineSummary?.slice(0, 60) || ""}`);

      return {
        id:        messageId,
        type:      "ack",
        payload:   {
          success:    true,
          riskJson:   riskJson,
          documentId: documentId,
          actionType: "document_risk",
        },
        timestamp: Date.now(),
      };
    } catch (err) {
      renderer.agentLog("ai", "error", `Risk analysis failed: ${err.message}`);
      return this._error(messageId, `AI call failed: ${err.message}`);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _error(messageId, message) {
    return {
      id:        messageId,
      type:      "error",
      payload:   { message },
      timestamp: Date.now(),
    };
  }
}

module.exports = DocumentQueryHandler;
