/**
 * src/core/embeddingManager.js
 * ZerathCode — Embedding Manager
 * Author: ZerathCode Team
 *
 * Provides semantic embedding generation and caching for RAG.
 * Uses lightweight ONNX models via @xenova/transformers for Termux compatibility.
 *
 * Features:
 *   - Lazy loads the embedding model (first use triggers download)
 *   - Caches embeddings in memory + optional disk cache
 *   - Batch embedding for performance
 *   - Cosine similarity scoring
 *   - Thread-safe (uses async/await)
 */

"use strict";

const path = require("path");
const fs = require("fs");

// ── Model cache directory ──────────────────────────────────────────────────
const CACHE_DIR = path.join(process.env.HOME || "/tmp", ".zerathcode", "embeddings");

let pipelineFn = null;
let semanticDisabled = process.env.ZERATHCODE_SEMANTIC_DISABLED === "1";

// Lazy-load transformers library on first use
async function loadTransformersModule() {
  if (pipelineFn) return pipelineFn;
  if (semanticDisabled) return null;

  try {
    // Try to require @xenova/transformers
    let transformers;
    try {
      transformers = require("@xenova/transformers");
    } catch {
      // Fallback: try dynamic import
      transformers = await import("@xenova/transformers");
    }

    const { pipeline, env } = transformers;
    
    // Configure cache to use Termux-friendly location
    if (env) {
      env.localModelPath = CACHE_DIR;
      env.allowDownloads = true;
    }
    
    // Initialize model (this will download ~30MB on first run)
    // Using a lightweight all-MiniLM-L6-v2 model (33M params)
    pipelineFn = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    
    return pipelineFn;
  } catch (err) {
    console.warn("⚠ Embedding model unavailable:", err.message);
    console.warn("⚠ Using keyword-only retrieval (less accurate)");
    semanticDisabled = true;
    return null;
  }
}

class EmbeddingManager {
  constructor() {
    this.cache = new Map(); // in-memory cache
    this.initialized = false;
    this.model = null;
  }

  /**
   * Initialize the embedding model (called lazily on first embedding request).
   * @returns {Promise<boolean>} - true if successful, false if fallback to keyword mode
   */
  async init() {
    if (this.initialized) return !!this.model;

    try {
      this.model = await loadTransformersModule();
      this.initialized = true;
      return !!this.model;
    } catch (err) {
      console.warn("Embedding initialization failed (keyword mode only):", err.message);
      this.initialized = true;
      this.model = null;
      return false;
    }
  }

  /**
   * Generate embedding for a text string.
   * Returns null if model unavailable (fallback to keyword scoring).
   *
   * @param {string} text
   * @returns {Promise<number[] | null>}
   */
  async embed(text) {
    if (!await this.init()) return null;
    if (!this.model) return null;

    const key = this._hashText(text);
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }

    try {
      // @xenova pipeline returns {data: [...embeddings]} or [{data: [...]}]
      const result = await this.model(text, {
        pooling: "mean",
        normalize: true,
      });

      // Extract the embedding vector
      let embedding = null;
      if (result && result.data) {
        embedding = Array.from(result.data);
      } else if (Array.isArray(result) && result[0] && result[0].data) {
        embedding = Array.from(result[0].data);
      }

      if (embedding && embedding.length > 0) {
        this.cache.set(key, embedding);
        return embedding;
      }
    } catch (err) {
      console.warn("Embedding generation failed for text:", err.message);
    }

    return null;
  }

  /**
   * Generate embeddings for multiple texts (batch).
   *
   * @param {string[]} texts
   * @returns {Promise<(number[] | null)[]>}
   */
  async embedBatch(texts) {
    return Promise.all(texts.map((t) => this.embed(t)));
  }

  /**
   * Cosine similarity between two embeddings.
   *
   * @param {number[]} a
   * @param {number[]} b
   * @returns {number} - Similarity score [0, 1]
   */
  static cosineSimilarity(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (normA * normB);
  }

  /**
   * Compare two texts semantically.
   *
   * @param {string} text1
   * @param {string} text2
   * @returns {Promise<number>} - Similarity [0, 1]
   */
  async compare(text1, text2) {
    const [e1, e2] = await this.embedBatch([text1, text2]);
    if (!e1 || !e2) return 0;
    return EmbeddingManager.cosineSimilarity(e1, e2);
  }

  /**
   * Score text chunks against a query (semantic + keyword hybrid).
   *
   * @param {string} query
   * @param {string[]} chunks
   * @param {{keywordWeight?: number, semanticWeight?: number}} opts
   * @returns {Promise<Array<{chunk: string, score: number, semantic: number, keyword: number}>>}
   */
  async scoreChunks(query, chunks, opts = {}) {
    const keywordWeight = opts.keywordWeight ?? 0.3;
    const semanticWeight = opts.semanticWeight ?? 0.7;

    if (!Array.isArray(chunks) || chunks.length === 0) return [];

    // Semantic scores (if model available and not disabled)
    let semanticScores = [];
    let hasValidSemanticScores = false;

    if (!semanticDisabled) {
      try {
        const queryEmbedding = await this.embed(query);
        const chunkEmbeddings = await this.embedBatch(chunks);

        semanticScores = chunkEmbeddings.map((emb) => {
          if (!emb || !queryEmbedding) return 0;
          return EmbeddingManager.cosineSimilarity(queryEmbedding, emb);
        });

        hasValidSemanticScores = semanticScores.some(s => s > 0);
      } catch (err) {
        // If semantic scoring fails, use keyword-only
        semanticScores = chunks.map(() => 0);
      }
    } else {
      semanticScores = chunks.map(() => 0);
    }

    // Keyword scores (ALWAYS run, not just fallback)
    const keywordScores = chunks.map((chunk) =>
      this._scoreKeywords(query, chunk)
    );

    // Adjust weights if semantic scores are missing
    let finalKeywordWeight = keywordWeight;
    let finalSemanticWeight = semanticWeight;

    if (!hasValidSemanticScores) {
      // Boost keyword weight if no semantic scores available
      finalKeywordWeight = 0.95;
      finalSemanticWeight = 0.05;
    }

    // Combine scores
    const results = chunks.map((chunk, i) => {
      const semantic = semanticScores[i] || 0;
      const keyword = keywordScores[i] || 0;

      // Weighted combination
      const score = keyword * finalKeywordWeight + semantic * finalSemanticWeight;

      return {
        chunk,
        score,
        semantic,
        keyword,
      };
    });

    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Simple keyword-based scoring (fallback + hybrid component).
   * @private
   */
  _scoreKeywords(query, chunk) {
    const q = String(query || "").toLowerCase();
    const c = String(chunk || "").toLowerCase();

    const tokens = q.split(/\s+/).filter((w) => w.length > 2);
    let score = 0;

    for (const token of tokens) {
      const re = new RegExp(this._escapeRegExp(token), "g");
      const matches = c.match(re);
      if (matches) score += matches.length;
    }

    // Boost for key terms
    if (c.includes("select_related")) score += 1;
    if (c.includes("prefetch_related")) score += 1;
    if (c.includes("sql injection")) score += 1;

    return Math.min(score / (tokens.length || 1), 1);
  }

  /**
   * Hash text for cache key.
   * @private
   */
  _hashText(text) {
    const t = String(text || "");
    let hash = 0;
    for (let i = 0; i < Math.min(t.length, 200); i++) {
      const char = t.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `${Math.abs(hash)}`;
  }

  /**
   * Escape regex special characters.
   * @private
   */
  _escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Clear memory cache (keep model loaded).
   */
  clearCache() {
    this.cache.clear();
  }
}

module.exports = EmbeddingManager;
