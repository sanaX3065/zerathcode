/**
 * src/core/documentEmbedder.js
 * ZerathCode — Document Embedding Service (Phase 4)
 *
 * Bridges Android document chunks → semantic embeddings → similarity scores.
 * Reuses the existing EmbeddingManager from ZerathCode v2.0.
 *
 * Message types handled:
 *   embed_query   — embed a query string, return vector
 *   embed_chunks  — embed a batch of text chunks, return vectors
 *   score_chunks  — embed query + chunks, return ranked scores (hybrid BM25 + semantic)
 */

"use strict";

const EmbeddingManager = require("../core/embeddingManager");
const renderer         = require("../ui/renderer");

class DocumentEmbedder {
  constructor() {
    this.embedder    = new EmbeddingManager();
    this._ready      = false;
    this._initPromise = null;
  }

  async init() {
    if (this._ready) return true;
    if (this._initPromise) return this._initPromise;

    this._initPromise = this.embedder.init().then((ok) => {
      this._ready = ok;
      if (ok) {
        renderer.agentLog("system", "ok", "Document embedder ready (semantic mode)");
      } else {
        renderer.agentLog("system", "warn", "Document embedder: keyword-only fallback");
      }
      return ok;
    });

    return this._initPromise;
  }

  /**
   * Handle a bridge message from Android.
   * Returns the response message or null.
   */
  async handle(message) {
    const { type, payload, id } = message;

    switch (type) {
      case "embed_query":   return this._handleEmbedQuery(id, payload);
      case "embed_chunks":  return this._handleEmbedChunks(id, payload);
      case "score_chunks":  return this._handleScoreChunks(id, payload);
      default:              return null;
    }
  }

  // ── Embed single query ────────────────────────────────────────────────────

  async _handleEmbedQuery(msgId, payload) {
    const { query } = payload;
    if (!query) return this._error(msgId, "Missing query");

    await this.init();

    try {
      const vector = await this.embedder.embed(query);
      return this._ack(msgId, {
        vector:     vector,    // null if embedding unavailable
        hasVector:  !!vector,
        actionType: "embed_query",
      });
    } catch (err) {
      return this._error(msgId, err.message);
    }
  }

  // ── Embed batch of chunks ─────────────────────────────────────────────────

  async _handleEmbedChunks(msgId, payload) {
    const { chunks, documentId } = payload;
    if (!Array.isArray(chunks) || chunks.length === 0) {
      return this._error(msgId, "Missing or empty chunks array");
    }

    await this.init();

    try {
      renderer.agentLog("system", "info",
        `Embedding ${chunks.length} chunks for doc ${documentId}`);

      const vectors = await this.embedder.embedBatch(chunks);

      renderer.agentLog("system", "ok",
        `Embedded ${vectors.filter(Boolean).length}/${chunks.length} chunks`);

      return this._ack(msgId, {
        vectors:    vectors,   // array of float[] or null per chunk
        count:      vectors.length,
        documentId: documentId,
        actionType: "embed_chunks",
      });
    } catch (err) {
      return this._error(msgId, err.message);
    }
  }

  // ── Hybrid score: BM25 + semantic ────────────────────────────────────────

  /**
   * Score chunks against a query using hybrid retrieval.
   * Android sends BM25 scores (from Phase 3 SQLite retrieval) + chunk text.
   * This handler adds semantic scores and combines them.
   *
   * Payload:
   *   query      : string          — user query
   *   candidates : Array<{
   *     chunkId   : number,
   *     text      : string,
   *     bm25Score : number,        — from Android's BM25 index
   *     pageNumber: number,
   *   }>
   *   weights: { bm25: 0.35, semantic: 0.65 }  — optional
   */
  async _handleScoreChunks(msgId, payload) {
    const { query, candidates, weights, documentId } = payload;

    if (!query || !Array.isArray(candidates) || candidates.length === 0) {
      return this._error(msgId, "Missing query or candidates");
    }

    await this.init();

    const w = {
      bm25:     weights?.bm25     ?? 0.35,
      semantic: weights?.semantic ?? 0.65,
    };

    renderer.agentLog("system", "info",
      `Hybrid scoring: "${query.slice(0, 50)}" against ${candidates.length} chunks`);

    try {
      const texts = candidates.map((c) => c.text);
      const scored = await this.embedder.scoreChunks(query, texts, {
        keywordWeight: w.bm25,
        semanticWeight: w.semantic,
      });

      // Merge with incoming BM25 scores and chunkIds
      const results = scored.map((s, i) => {
        const candidate = candidates[i];
        const bm25Norm  = normalizeBm25(candidate.bm25Score, candidates);

        // Hybrid: weighted combination
        const hybridScore = (bm25Norm * w.bm25) + (s.semantic * w.semantic);

        return {
          chunkId:      candidate.chunkId,
          pageNumber:   candidate.pageNumber,
          hybridScore:  hybridScore,
          semanticScore:s.semantic,
          bm25Score:    bm25Norm,
          text:         candidate.text,
        };
      });

      // Sort descending
      results.sort((a, b) => b.hybridScore - a.hybridScore);

      renderer.agentLog("system", "ok",
        `Top chunk score: ${results[0]?.hybridScore?.toFixed(3)} (doc ${documentId})`);

      return this._ack(msgId, {
        results:    results,
        documentId: documentId,
        hasSemanticScores: this._ready,
        actionType: "score_chunks",
      });
    } catch (err) {
      renderer.agentLog("system", "warn", `Scoring failed: ${err.message} — using BM25 only`);

      // Fallback: return BM25-only ranking
      const fallback = candidates
        .map((c, i) => ({ chunkId: c.chunkId, hybridScore: c.bm25Score,
                          semanticScore: 0, bm25Score: c.bm25Score,
                          pageNumber: c.pageNumber, text: c.text }))
        .sort((a, b) => b.hybridScore - a.hybridScore);

      return this._ack(msgId, {
        results:    fallback,
        documentId: documentId,
        hasSemanticScores: false,
        actionType: "score_chunks",
      });
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _ack(msgId, payload) {
    return { id: msgId, type: "ack", payload: { success: true, ...payload }, timestamp: Date.now() };
  }

  _error(msgId, message) {
    return { id: msgId, type: "error", payload: { message }, timestamp: Date.now() };
  }
}

/**
 * Normalize BM25 scores within a candidate set to [0, 1].
 */
function normalizeBm25(score, candidates) {
  const max = Math.max(...candidates.map((c) => c.bm25Score), 0.001);
  return score / max;
}

// ── Singleton ─────────────────────────────────────────────────────────────────
let _instance = null;
function getDocumentEmbedder() {
  if (!_instance) _instance = new DocumentEmbedder();
  return _instance;
}

module.exports = { DocumentEmbedder, getDocumentEmbedder };
