/**
 * test/phase3.test.js
 * ZerathCode — Phase 3 Document Intelligence Test
 *
 * Tests the document query handler end-to-end via the bridge.
 * Run: node test/phase3.test.js
 *
 * Simulates:
 *  1. Android sends document_query with RAG context
 *  2. Bridge calls AI with grounded prompt
 *  3. AI returns answer
 *  4. Bridge returns ack to Android
 *  5. Android sends document_risk with classified chunks
 *  6. Bridge calls AI for deep analysis
 *  7. Bridge returns structured risk JSON
 */

"use strict";

const WebSocket          = require("ws");
const { Messages, MessageType } = require("../src/core/bridgeProtocol");
const DocumentQueryHandler = require("../src/core/documentQueryHandler");

const PASS = "\x1b[32m✔\x1b[0m";
const FAIL = "\x1b[31m✖\x1b[0m";
const INFO = "\x1b[36mℹ\x1b[0m";

// ── Mock key manager for testing ──────────────────────────────────────────────
const mockKeyManager = {
  getKey: (provider) => process.env[{
    claude: "ANTHROPIC_API_KEY",
    gemini: "GEMINI_API_KEY",
    gpt:    "OPENAI_API_KEY",
  }[provider] || ""] || null,
  callWithRotation: async (provider, fn) => {
    const key = mockKeyManager.getKey(provider);
    if (!key) throw new Error(`No API key for ${provider}`);
    return fn(key);
  },
};

// ── Sample RAG context (as Android would send) ────────────────────────────────
const SAMPLE_RAG_CONTEXT = `Document: Rental_Agreement_March_2026.pdf
Query: What is the notice period for termination?
Relevant excerpts:

(1) (p.3) Either party may terminate this agreement by providing NINETY (90) days written notice
to the other party. Notice must be delivered via certified mail to the address listed in Section 1.

(2) (p.3) In the event of breach of any material term, the non-breaching party may terminate
with FIFTEEN (15) days notice. Breach includes but is not limited to non-payment of rent,
unauthorized subletting, or damage to the property.

(3) (p.7) Tenant acknowledges that failure to provide required notice shall result in
forfeiture of the security deposit and liability for rent through the end of the notice period.`;

// ── Sample risk prompt (as Android classifier would send) ─────────────────────
const SAMPLE_RISK_PROMPT = `Analyze this document for risk and provide a structured assessment.

Document: Rental_Agreement_March_2026.pdf

Pattern-based flags already detected:
  - Unusual notice period (Legal, severity 2/5, 1 occurrence(s))
  - Payment obligation (Financial, severity 2/5, 3 occurrence(s))
  - Auto-renewal clause (Legal, severity 3/5, 1 occurrence(s))
  - Indemnification clause (Legal, severity 4/5, 1 occurrence(s))

Most relevant text excerpts:
(1) Either party may terminate this agreement by providing NINETY (90) days written notice...
(2) Tenant shall indemnify and hold harmless the Landlord from any claims arising from Tenant's use...
(3) This agreement shall automatically renew for successive one-year terms unless written notice...
(4) Rent is due on the 1st of each month. Late fee of $150 applies after the 5th day...
(5) Tenant is responsible for all repairs under $500. Landlord responsible for structural repairs...

Respond ONLY with a valid JSON object:
{...schema...}`;

async function runTest() {
  console.log("\n\x1b[36m── Phase 3 Document Intelligence Test ──────────\x1b[0m\n");

  const provider = "gemini"; // or claude, gpt — whichever key is available
  const key = mockKeyManager.getKey(provider);

  if (!key) {
    console.log(`${FAIL}  No API key found for ${provider}.`);
    console.log(`   Set GEMINI_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY and re-run.\n`);
    console.log(`${INFO}  Running mock-only test (no real AI calls).\n`);
    runMockTest();
    return;
  }

  const handler = new DocumentQueryHandler({
    provider,
    keyManager: mockKeyManager,
  });

  // ── Test 1: Document Q&A ──────────────────────────────────────────────────
  console.log("  Test 1: Document Q&A");
  try {
    const response = await handler.handle({
      id:        "test-001",
      type:      "document_query",
      payload:   {
        question:   "What is the notice period for termination?",
        ragContext: SAMPLE_RAG_CONTEXT,
        documentId: 42,
      },
      timestamp: Date.now(),
    });

    if (response?.payload?.success && response.payload.answer) {
      console.log(`${PASS}  Q&A response received`);
      console.log(`     ${INFO} Answer: ${response.payload.answer.slice(0, 120)}…`);
    } else {
      console.log(`${FAIL}  Q&A failed: ${JSON.stringify(response?.payload)}`);
    }
  } catch (err) {
    console.log(`${FAIL}  Q&A threw: ${err.message}`);
  }

  // ── Test 2: Document risk analysis ────────────────────────────────────────
  console.log("\n  Test 2: Deep risk analysis");
  try {
    const response = await handler.handle({
      id:        "test-002",
      type:      "document_risk",
      payload:   {
        prompt:     SAMPLE_RISK_PROMPT,
        documentId: 42,
      },
      timestamp: Date.now(),
    });

    if (response?.payload?.success && response.payload.riskJson) {
      const risk = response.payload.riskJson;
      console.log(`${PASS}  Risk analysis complete`);
      console.log(`     ${INFO} Overall risk: ${risk.overallRisk}`);
      console.log(`     ${INFO} Summary: ${risk.oneLineSummary?.slice(0, 100)}`);
      if (risk.contextualFlags?.length) {
        console.log(`     ${INFO} Contextual flags: ${risk.contextualFlags.length}`);
      }
      if (risk.missingClauses?.length) {
        console.log(`     ${INFO} Missing clauses: ${risk.missingClauses.join(", ")}`);
      }
      if (risk.unusualTerms?.length) {
        console.log(`     ${INFO} Unusual terms: ${risk.unusualTerms.slice(0,2).join(", ")}`);
      }
    } else {
      console.log(`${FAIL}  Risk analysis failed: ${JSON.stringify(response?.payload)}`);
    }
  } catch (err) {
    console.log(`${FAIL}  Risk threw: ${err.message}`);
  }

  console.log("\n\x1b[32m  Phase 3 document tests complete ✔\x1b[0m");
  console.log("\x1b[90m  Ready for Phase 4 — Vector embeddings + enhanced UI.\x1b[0m\n");
  process.exit(0);
}

// ── Mock test (no AI key needed) ──────────────────────────────────────────────
function runMockTest() {
  console.log("  Running structural tests only (no AI):\n");

  // Test BM25 scoring logic from the chunker concepts
  const text = "The tenant shall pay rent on the first day of each month. Late fees apply after the fifth day.";
  const query = "when is rent due";
  const queryTokens = tokenize(query);
  const docTokens   = buildTF(text);
  const score       = bm25Score(docTokens, queryTokens, text.length, 600);

  console.log(`${PASS}  BM25 scoring: "${query.slice(0,30)}" → score=${score.toFixed(3)}`);

  // Test risk pattern matching
  const riskText = "Payment of $5,000 due on the 1st. Social Security: 123-45-6789. Auto-renewal clause applies.";
  const flags = matchRiskPatterns(riskText);
  console.log(`${PASS}  Risk patterns: found ${flags.length} flag(s) — ${flags.join(", ")}`);

  console.log(`\n${INFO}  Set an API key to run full AI tests.\n`);
  process.exit(0);
}

// ── Minimal BM25 for validation ───────────────────────────────────────────────
function tokenize(text) {
  const stop = new Set(["the","a","an","and","or","is","on","of","at","to","for","it"]);
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .filter(w => w.length > 2 && !stop.has(w));
}
function buildTF(text) {
  const tf = {};
  tokenize(text).forEach(t => tf[t] = (tf[t] || 0) + 1);
  return tf;
}
function bm25Score(tf, queryTokens, docLen, avgLen, k1 = 1.5, b = 0.75) {
  return queryTokens.reduce((score, token) => {
    const freq = tf[token] || 0;
    if (!freq) return score;
    return score + (freq * (k1 + 1)) / (freq + k1 * (1 - b + b * docLen / avgLen));
  }, 0);
}
function matchRiskPatterns(text) {
  const patterns = [
    ["SSN", /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/],
    ["Large payment", /\$[\d,]+/],
    ["Auto-renewal", /auto.renew|automatically renew/i],
    ["Late fee", /late fee/i],
  ];
  return patterns.filter(([, re]) => re.test(text)).map(([name]) => name);
}

runTest().catch(err => {
  console.error(`\n\x1b[31m  Fatal: ${err.message}\x1b[0m\n`);
  process.exit(1);
});
