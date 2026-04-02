package com.localai.automation.document

import android.content.Context
import android.net.Uri
import android.util.Log
import com.google.gson.Gson
import com.localai.automation.document.classifier.DocumentRiskClassifier
import com.localai.automation.document.data.*
import com.localai.automation.document.processor.DocumentChunker
import com.localai.automation.document.processor.DocumentProcessor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext

/**
 * DocumentRepository
 *
 * Orchestrates the document intelligence pipeline:
 *   1. Import document → extract text → chunk → store
 *   2. Risk classification → store assessment
 *   3. Query retrieval → BM25 scoring → return top-k chunks
 */
class DocumentRepository(
    private val context: Context,
    private val documentDao: DocumentDao,
) {
    companion object {
        private const val TAG = "DocumentRepository"
        private const val TOP_K = 6  // chunks returned per query
    }

    private val processor  = DocumentProcessor(context)
    private val chunker    = DocumentChunker()
    private val classifier = DocumentRiskClassifier()
    private val gson       = Gson()

    // ── Observe all documents ─────────────────────────────────────────────────

    fun getAllDocuments(): Flow<List<DocumentEntity>> = documentDao.getAllDocuments()

    // ── Import a new document ─────────────────────────────────────────────────

    data class ImportResult(
        val documentId: Long,
        val chunkCount: Int,
        val charCount:  Int,
        val isImagePdf: Boolean,
        val errorMessage: String? = null,
    )

    suspend fun importDocument(
        uri: Uri,
        name: String,
        mimeType: String,
        sizeBytes: Long,
    ): ImportResult = withContext(Dispatchers.IO) {

        // Check if already imported
        documentDao.getDocumentByUri(uri.toString())?.let { existing ->
            Log.i(TAG, "Document already exists: ${existing.id}")
            return@withContext ImportResult(
                documentId  = existing.id,
                chunkCount  = existing.chunkCount,
                charCount   = existing.charCount,
                isImagePdf  = false,
            )
        }

        // Create initial record
        val docId = documentDao.insertDocument(
            DocumentEntity(
                name      = name,
                uri       = uri.toString(),
                mimeType  = mimeType,
                sizeBytes = sizeBytes,
            )
        )

        Log.i(TAG, "Importing document id=$docId name=$name")

        // Extract text
        val extraction = processor.extract(uri, mimeType)

        if (extraction.errorMessage != null) {
            Log.w(TAG, "Extraction error: ${extraction.errorMessage}")
            return@withContext ImportResult(
                documentId   = docId,
                chunkCount   = 0,
                charCount    = 0,
                isImagePdf   = false,
                errorMessage = extraction.errorMessage,
            )
        }

        // Chunk the text
        val chunks = chunker.chunk(
            documentId = docId,
            fullText   = extraction.fullText,
            pages      = extraction.pages,
        )

        // Store chunks
        documentDao.insertChunks(chunks)
        documentDao.markProcessed(
            id          = docId,
            processed   = true,
            chunkCount  = chunks.size,
            charCount   = extraction.fullText.length,
            updatedAt   = System.currentTimeMillis(),
        )

        // Run risk classification (Stage 1 — pattern-based)
        val assessment = classifier.assess(extraction.fullText)
        documentDao.updateRiskAssessment(
            id           = docId,
            riskLevel    = assessment.riskLevel,
            flagsJson    = classifier.flagsToJson(assessment.flags),
            obligationsJson = classifier.obligationsToJson(assessment.obligations),
            summary      = assessment.summary,
            updatedAt    = System.currentTimeMillis(),
        )

        Log.i(TAG, "Import complete: id=$docId chunks=${chunks.size} risk=${assessment.riskLevel}")

        ImportResult(
            documentId = docId,
            chunkCount = chunks.size,
            charCount  = extraction.fullText.length,
            isImagePdf = extraction.isImagePdf,
        )
    }

    // ── Query a document ──────────────────────────────────────────────────────

    data class QueryResult(
        val chunks:       List<ScoredChunk>,
        val documentName: String,
        val documentId:   Long,
    )

    data class ScoredChunk(
        val chunk: DocumentChunkEntity,
        val score: Double,
    )

    /**
     * Retrieve the most relevant chunks for a query within a document.
     * Uses BM25 scoring on stored term frequencies.
     */
    suspend fun queryDocument(documentId: Long, query: String): QueryResult =
        withContext(Dispatchers.IO) {
            val doc = documentDao.getDocumentById(documentId)

            val queryTokens = chunker.tokenize(query)

            // Get candidate chunks via keyword pre-filter
            val candidates = if (queryTokens.isNotEmpty()) {
                // Use the most discriminative token for the SQL search
                val searchTerm = queryTokens.maxByOrNull { it.length } ?: queryTokens.first()
                documentDao.searchChunksByTerm(documentId, searchTerm, limit = 30)
                    .ifEmpty {
                        // Fall back to all chunks if no keyword match
                        documentDao.getChunksForDocumentPaged(documentId, limit = 50)
                    }
            } else {
                documentDao.getChunksForDocumentPaged(documentId, limit = TOP_K)
            }

            // Score and rank
            val scored = candidates
                .map { chunk -> ScoredChunk(chunk, chunker.scoreChunk(chunk, queryTokens)) }
                .sortedByDescending { it.score }
                .take(TOP_K)

            QueryResult(
                chunks       = scored,
                documentName = doc?.name ?: "Unknown",
                documentId   = documentId,
            )
        }

    /**
     * Query across all (processed) documents.
     */
    suspend fun queryAllDocuments(query: String): List<QueryResult> =
        withContext(Dispatchers.IO) {
            val allDocs = documentDao.getAllDocuments()
            val results = mutableListOf<QueryResult>()
            
            // Collect the first emission (current snapshot) from the Flow
            val snapshot = allDocs.first()

            for (doc in snapshot.filter { it.isProcessed }) {
                results.add(queryDocument(doc.id, query))
            }
            results.sortedByDescending { it.chunks.firstOrNull()?.score ?: 0.0 }
        }

    // ── Delete a document ─────────────────────────────────────────────────────

    suspend fun deleteDocument(documentId: Long) = withContext(Dispatchers.IO) {
        documentDao.deleteChunksForDocument(documentId)
        documentDao.deleteDocumentById(documentId)
        Log.i(TAG, "Deleted document id=$documentId")
    }

    // ── Build bridge payload for AI Q&A ───────────────────────────────────────

    /**
     * Build a context block for the AI to answer a question about a document.
     * Retrieves top-k chunks and formats them for the LLM prompt.
     */
    suspend fun buildRagContext(documentId: Long, query: String): String =
        withContext(Dispatchers.IO) {
            val result = queryDocument(documentId, query)
            val doc    = documentDao.getDocumentById(documentId)

            val header = "Document: ${doc?.name ?: "Unknown"}\n" +
                         "Query: $query\n" +
                         "Relevant excerpts:\n"

            val excerpts = result.chunks.mapIndexed { i, scored ->
                val pageInfo = if (scored.chunk.pageNumber > 0) " (p.${scored.chunk.pageNumber})" else ""
                "(${i+1})$pageInfo ${scored.chunk.content.take(600)}"
            }.joinToString("\n\n")

            header + excerpts
        }

    /**
     * Build the AI risk prompt for Stage 2 (deep) risk assessment.
     */
    suspend fun buildRiskPrompt(documentId: Long): String? =
        withContext(Dispatchers.IO) {
            val doc = documentDao.getDocumentById(documentId) ?: return@withContext null
            val chunks = documentDao.getChunksForDocumentPaged(documentId, limit = 10)
            val flags  = parseFlags(doc.riskFlagsJson)

            classifier.buildAiPrompt(
                documentName = doc.name,
                topChunks    = chunks.map { it.content },
                flags        = flags,
            )
        }

    private fun parseFlags(json: String): List<DocumentRiskClassifier.RiskFlag> {
        return try {
            val type = object : com.google.gson.reflect.TypeToken<List<Map<String, Any>>>() {}.type
            val maps: List<Map<String, Any>> = gson.fromJson(json, type) ?: emptyList()
            maps.map { m ->
                DocumentRiskClassifier.RiskFlag(
                    id          = m["id"]?.toString() ?: "",
                    description = m["description"]?.toString() ?: "",
                    category    = m["category"]?.toString() ?: "",
                    severity    = (m["severity"] as? Double)?.toInt() ?: 0,
                    matchCount  = (m["matchCount"] as? Double)?.toInt() ?: 0,
                    snippets    = emptyList(),
                )
            }
        } catch (e: Exception) {
            emptyList()
        }
    }
}
