package com.localai.automation.document.retrieval

import android.util.Log
import com.localai.automation.bridge.BridgeMessage
import com.localai.automation.bridge.BridgeManager
import com.localai.automation.document.data.DocumentChunkEntity
import com.localai.automation.document.data.DocumentDao
import com.localai.automation.document.processor.DocumentChunker
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

/**
 * HybridRetriever
 *
 * Phase 4 replacement for the pure BM25 retrieval in DocumentRepository.
 *
 * Retrieval pipeline:
 *   1. BM25 pre-filter (SQLite, fast) → top-30 candidates
 *   2. Send candidates to Node.js bridge → semantic scoring via EmbeddingManager
 *   3. Combine scores (35% BM25 + 65% semantic) → return top-k
 *
 * Falls back to BM25-only if bridge is unavailable.
 */
class HybridRetriever(
    private val documentDao: DocumentDao,
    private val bridgeManager: BridgeManager?,
    private val chunker: DocumentChunker = DocumentChunker(),
) {
    companion object {
        private const val TAG        = "HybridRetriever"
        private const val TOP_K      = 6
        private const val CANDIDATES = 30
        private const val TIMEOUT_MS = 5000L
    }

    private val gson = Gson()

    data class ScoredChunk(
        val chunk:         DocumentChunkEntity,
        val hybridScore:   Double,
        val semanticScore: Double,
        val bm25Score:     Double,
    )

    // ── Entry point ───────────────────────────────────────────────────────────

    suspend fun retrieve(documentId: Long, query: String): List<ScoredChunk> {
        val queryTokens = chunker.tokenize(query)

        // Step 1: BM25 pre-filter (SQLite)
        val candidates = bm25PreFilter(documentId, query, queryTokens)

        if (candidates.isEmpty()) return emptyList()

        // Step 2: Try semantic scoring via bridge
        val bridge = bridgeManager
        if (bridge == null || !bridge.isConnected()) {
            Log.d(TAG, "Bridge unavailable — BM25 only")
            return candidates.take(TOP_K)
        }

        val hybrid = semanticRescoring(documentId, query, candidates)
        return if (hybrid != null) hybrid.take(TOP_K) else candidates.take(TOP_K)
    }

    // ── BM25 pre-filter ───────────────────────────────────────────────────────

    private suspend fun bm25PreFilter(
        documentId: Long,
        query: String,
        tokens: List<String>,
    ): List<ScoredChunk> {
        // Use longest token for SQLite LIKE search
        val searchTerm = tokens.maxByOrNull { it.length }

        val rawChunks = if (searchTerm != null) {
            documentDao.searchChunksByTerm(documentId, searchTerm, CANDIDATES)
                .ifEmpty { documentDao.getChunksForDocumentPaged(documentId, CANDIDATES) }
        } else {
            documentDao.getChunksForDocumentPaged(documentId, CANDIDATES)
        }

        return rawChunks.map { chunk ->
            val bm25 = chunker.scoreChunk(chunk, tokens)
            ScoredChunk(chunk, bm25, 0.0, bm25)
        }.sortedByDescending { it.hybridScore }
    }

    // ── Semantic re-scoring via bridge ────────────────────────────────────────

    private suspend fun semanticRescoring(
        documentId: Long,
        query: String,
        candidates: List<ScoredChunk>,
    ): List<ScoredChunk>? {
        val bridge = bridgeManager ?: return null

        val payload = mapOf(
            "query"      to query,
            "documentId" to documentId,
            "candidates" to candidates.map { sc ->
                mapOf(
                    "chunkId"    to sc.chunk.id,
                    "text"       to sc.chunk.content.take(600),
                    "bm25Score"  to sc.bm25Score,
                    "pageNumber" to sc.chunk.pageNumber,
                )
            },
            "weights" to mapOf("bm25" to 0.35, "semantic" to 0.65),
        )

        val msgId = java.util.UUID.randomUUID().toString()

        return withTimeoutOrNull(TIMEOUT_MS) {
            suspendCancellableCoroutine { cont ->
                val originalHandler = bridge.bridge.onMessageReceived

                bridge.bridge.onMessageReceived = { msg ->
                    if (msg.id == msgId) {
                        bridge.bridge.onMessageReceived = originalHandler

                        if (msg.type == "ack" && msg.payload["success"] == true) {
                            @Suppress("UNCHECKED_CAST")
                            val results = msg.payload["results"] as? List<Map<String, Any>>
                            if (results != null) {
                                val scored = results.mapNotNull { r ->
                                    val chunkId = (r["chunkId"] as? Double)?.toLong() ?: return@mapNotNull null
                                    val original = candidates.find { it.chunk.id == chunkId }
                                        ?: return@mapNotNull null
                                    ScoredChunk(
                                        chunk         = original.chunk,
                                        hybridScore   = (r["hybridScore"] as? Double) ?: original.hybridScore,
                                        semanticScore = (r["semanticScore"] as? Double) ?: 0.0,
                                        bm25Score     = (r["bm25Score"] as? Double) ?: original.bm25Score,
                                    )
                                }.sortedByDescending { it.hybridScore }
                                cont.resume(scored)
                            } else {
                                cont.resume(null)
                            }
                        } else {
                            cont.resume(null)
                        }
                    } else {
                        originalHandler?.invoke(msg)
                    }
                }

                val sent = bridge.bridge.send(
                    BridgeMessage(
                        id      = msgId,
                        type    = "score_chunks",
                        payload = payload,
                    )
                )
                if (!sent) cont.resume(null)

                cont.invokeOnCancellation {
                    bridge.bridge.onMessageReceived = originalHandler
                }
            }
        }.also { result ->
            if (result == null) Log.w(TAG, "Semantic scoring timed out — using BM25")
            else Log.d(TAG, "Hybrid retrieval: top=${result.firstOrNull()?.hybridScore?.let { "%.3f".format(it) }}")
        }
    }
}
