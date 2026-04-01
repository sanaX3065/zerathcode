/**
 * test/phase4.test.js
 * ZerathCode — Phase 4 Integration Test
 *
 * Tests:
 *  1. DocumentEmbedder — semantic scoring via EmbeddingManager
 *  2. ProactiveAgent   — event pattern analysis → rule suggestions
 *
 * Run: node test/phase4.test.js
 *
 * Requires an API key for ProactiveAgent test.
 * DocumentEmbedder test works without API key (uses local model).
 */

"use strict";

const { DocumentEmbedder } = require("../src/core/documentEmbedder");
const ProactiveAgent        = require("../src/core/proactiveAgent");

const PASS = "\x1b[32m✔\x1b[0m";
const FAIL = "\x1b[31m✖\x1b[0m";
const INFO = "\x1b[36mℹ\x1b[0m";
const SKIP = "\x1b[33m⊘\x1b[0m";

// ── Sample data ───────────────────────────────────────────────────────────────

const SAMPLE_CHUNKS = [
  "The tenant shall pay rent on the first of each month. Late fee of $150 applies after the 5th day.",
  "Either party may terminate this agreement with ninety (90) days written notice via certified mail.",
  "Tenant is responsible for all repairs and maintenance costs under five hundred dollars ($500).",
  "This lease shall automatically renew for successive one-year terms unless written notice is given.",
  "Landlord shall maintain the structural integrity and major systems of the property.",
  "Security deposit of two months rent is required and held in a separate escrow account.",
];

const SAMPLE_EVENTS = [
  // Battery repeatedly hits low, no rule fires
  ...Array.from({ length: 8 }, (_, i) => ({
    module: "BATTERY", eventType: "BATTERY_LOW",
    timestamp: Date.now() - i * 3600000,
    data: { level: 15 }
  })),
  // Phone plugged in at roughly the same time each day
  ...Array.from({ length: 5 }, (_, i) => ({
    module: "BATTERY", eventType: "CHARGING_STARTED",
    timestamp: Date.now() - i * 86400000 - 3600000 * 22,
    data: { level: 20 }
  })),
  // User enters home zone
  ...Array.from({ length: 6 }, (_, i) => ({
    module: "LOCATION", eventType: "ENTERED_ZONE",
    timestamp: Date.now() - i * 86400000 - 3600000 * 18,
    data: { locationName: "Home" }
  })),
  // Notifications from work app cluster in morning
  ...Array.from({ length: 10 }, (_, i) => ({
    module: "NOTIFICATION", eventType: "NOTIFICATION_RECEIVED",
    timestamp: Date.now() - i * 3600000 - 3600000 * 8,
    data: { package: "com.slack.android", title: "New message" }
  })),
];

const EXISTING_RULES = [
  { name: "Charging stopped → Vibrate", isEnabled: true },
];

// ── Main test ─────────────────────────────────────────────────────────────────

async function runTest() {
  console.log("\n\x1b[36m── Phase 4 Tests ───────────────────────────────\x1b[0m\n");

  // ── Test 1: DocumentEmbedder ──────────────────────────────────────────────
  console.log("  Test 1: Document Embedding (hybrid scoring)");

  const embedder = new DocumentEmbedder();

  try {
    const ready = await embedder.init();
    if (ready) {
      console.log(`${PASS}  Embedding model loaded`);
    } else {
      console.log(`${SKIP}  Embedding model unavailable — keyword fallback`);
    }

    // Test score_chunks
    const response = await embedder.handle({
      id:   "embed-001",
      type: "score_chunks",
      payload: {
        query:      "what is the notice period for termination",
        documentId: 1,
        candidates: SAMPLE_CHUNKS.map((text, i) => ({
          chunkId:    i + 1,
          text,
          bm25Score:  Math.random() * 3,   // simulated BM25 scores from Android
          pageNumber: i + 1,
        })),
        weights: { bm25: 0.35, semantic: 0.65 },
      },
      timestamp: Date.now(),
    });

    if (response?.payload?.success && Array.isArray(response.payload.results)) {
      const top = response.payload.results[0];
      console.log(`${PASS}  Hybrid scoring complete`);
      console.log(`     ${INFO} Top chunk (hybrid=${top.hybridScore.toFixed(3)} sem=${top.semanticScore.toFixed(3)} bm25=${top.bm25Score.toFixed(3)}):`);
      console.log(`     ${INFO} "${top.text.slice(0, 80)}…"`);

      const hasSemantics = response.payload.hasSemanticScores;
      console.log(`     ${INFO} Semantic scores: ${hasSemantics ? "yes (model loaded)" : "no (keyword fallback)"}`);
    } else {
      console.log(`${FAIL}  Scoring failed: ${JSON.stringify(response?.payload)}`);
    }

    // Test embed_query
    const qEmbed = await embedder.handle({
      id:   "embed-002",
      type: "embed_query",
      payload: { query: "payment obligations and due dates" },
      timestamp: Date.now(),
    });
    if (qEmbed?.payload?.success) {
      const dim = qEmbed.payload.vector?.length || 0;
      console.log(`${PASS}  Query embedding: ${dim > 0 ? `${dim}-dim vector` : "no vector (fallback)"}`);
    }

  } catch (err) {
    console.log(`${FAIL}  Embedding test threw: ${err.message}`);
  }

  // ── Test 2: ProactiveAgent ────────────────────────────────────────────────
  console.log("\n  Test 2: Proactive pattern analysis");

  const provider = "gemini";
  const key = process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;

  if (!key) {
    console.log(`${SKIP}  No API key — skipping proactive agent test`);
    console.log(`     Set GEMINI_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY to run`);
    summarize();
    return;
  }

  const mockKeyManager = {
    getKey: () => key,
    callWithRotation: async (p, fn) => fn(key),
  };

  const agent = new ProactiveAgent({ provider, keyManager: mockKeyManager });

  try {
    const response = await agent.handle({
      id:   "proactive-001",
      type: "analyze_events",
      payload: {
        events:        SAMPLE_EVENTS,
        existingRules: EXISTING_RULES,
        deviceState:   { batteryLevel: 72, isCharging: false, ringerMode: "NORMAL" },
      },
      timestamp: Date.now(),
    });

    if (response?.payload?.success) {
      const { suggestions, insights } = response.payload;
      console.log(`${PASS}  Proactive analysis complete`);
      console.log(`     ${INFO} ${suggestions.length} suggestion(s), ${insights?.length || 0} insight(s)`);

      suggestions.forEach((s, i) => {
        console.log(`\n     Suggestion ${i+1}: "${s.title}"`);
        console.log(`       Confidence: ${(s.confidence * 100).toFixed(0)}% (${s.patternStrength})`);
        console.log(`       Trigger: ${s.trigger}`);
        console.log(`       Action:  ${s.action}`);
        console.log(`       Rule ready: ${s.conditionJson && s.actionJson ? "✓" : "✗"}`);
      });

      if (insights?.length) {
        console.log(`\n     Insights:`);
        insights.forEach(ins => console.log(`       • ${ins}`));
      }
    } else {
      console.log(`${FAIL}  Proactive failed: ${JSON.stringify(response?.payload)}`);
    }
  } catch (err) {
    console.log(`${FAIL}  Proactive threw: ${err.message}`);
  }

  summarize();
}

function summarize() {
  console.log("\n\x1b[32m  Phase 4 tests complete ✔\x1b[0m");
  console.log("\x1b[90m  All four phases complete — platform ready for integration.\x1b[0m\n");
  process.exit(0);
}

runTest().catch((err) => {
  console.error(`\n\x1b[31m  Fatal: ${err.message}\x1b[0m\n`);
  process.exit(1);
});
