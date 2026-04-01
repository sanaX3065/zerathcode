package com.localai.automation.document.processor

import com.localai.automation.document.data.DocumentChunkEntity

/**
 * DocumentChunker
 *
 * Splits extracted document text into overlapping chunks for retrieval.
 * Also computes a lightweight BM25-compatible term frequency index per chunk.
 *
 * Strategy:
 *  - Try to split on paragraph/sentence boundaries
 *  - Fall back to character-level splitting with overlap
 *  - Each chunk stores its term frequencies for keyword scoring
 */
class DocumentChunker {

    companion object {
        const val CHUNK_SIZE    = 800    // chars per chunk
        const val OVERLAP       = 150    // overlap between consecutive chunks
        const val MIN_CHUNK     = 80     // discard chunks shorter than this

        // Common English stop words — excluded from term frequency index
        private val STOP_WORDS = setOf(
            "the","a","an","and","or","but","in","on","at","to","for","of",
            "by","with","from","as","is","are","was","were","be","been",
            "has","have","had","do","does","did","will","would","could","should",
            "may","might","can","its","it","this","that","these","those",
            "not","no","nor","so","yet","both","either","neither","each",
            "i","you","he","she","we","they","me","him","her","us","them",
        )
    }

    /**
     * Chunk a full document text into overlapping segments.
     *
     * @param documentId  Parent document ID for foreign key
     * @param fullText    Extracted text from DocumentProcessor
     * @param pages       Optional page-aware splitting (preserves page numbers)
     */
    fun chunk(
        documentId: Long,
        fullText: String,
        pages: List<DocumentProcessor.PageText> = emptyList()
    ): List<DocumentChunkEntity> {
        if (fullText.isBlank()) return emptyList()

        val chunks = if (pages.isNotEmpty()) {
            chunkByPages(documentId, pages)
        } else {
            chunkFlat(documentId, fullText)
        }

        return chunks
    }

    // ── Page-aware chunking ───────────────────────────────────────────────────

    private fun chunkByPages(
        documentId: Long,
        pages: List<DocumentProcessor.PageText>
    ): List<DocumentChunkEntity> {
        val result  = mutableListOf<DocumentChunkEntity>()
        var chunkIdx = 0

        for (page in pages) {
            if (page.text.isBlank()) continue

            // Split page text into chunks
            val pageChunks = splitText(page.text)
            for (text in pageChunks) {
                if (text.length < MIN_CHUNK) continue
                result.add(
                    DocumentChunkEntity(
                        documentId        = documentId,
                        chunkIndex        = chunkIdx++,
                        content           = text.trim(),
                        pageNumber        = page.pageNumber,
                        termFrequencyData = buildTermFrequency(text),
                    )
                )
            }
        }

        return result
    }

    // ── Flat chunking (for DOCX/TXT without page info) ────────────────────────

    private fun chunkFlat(documentId: Long, text: String): List<DocumentChunkEntity> {
        val result   = mutableListOf<DocumentChunkEntity>()
        val segments = splitText(text)

        segments.forEachIndexed { idx, segment ->
            if (segment.length >= MIN_CHUNK) {
                result.add(
                    DocumentChunkEntity(
                        documentId        = documentId,
                        chunkIndex        = idx,
                        content           = segment.trim(),
                        termFrequencyData = buildTermFrequency(segment),
                    )
                )
            }
        }

        return result
    }

    // ── Text splitting ────────────────────────────────────────────────────────

    /**
     * Split text into overlapping CHUNK_SIZE segments, preferring
     * paragraph/sentence boundaries.
     */
    private fun splitText(text: String): List<String> {
        val segments = mutableListOf<String>()
        var pos      = 0

        while (pos < text.length) {
            val end = minOf(pos + CHUNK_SIZE, text.length)

            // Find a good split point: paragraph > sentence > word > char
            val splitAt = when {
                end == text.length -> end
                else -> findSplitPoint(text, pos, end)
            }

            val segment = text.substring(pos, splitAt)
            if (segment.isNotBlank()) segments.add(segment)

            // Move forward with overlap
            pos = maxOf(splitAt - OVERLAP, pos + 1)
        }

        return segments
    }

    /**
     * Find the best split point at or before `end`, scanning backwards
     * for paragraph → sentence → word boundary.
     */
    private fun findSplitPoint(text: String, start: Int, end: Int): Int {
        val window = maxOf(end - 200, start)

        // Prefer double newline (paragraph break)
        val para = text.lastIndexOf("\n\n", end)
        if (para > window) return para + 2

        // Single newline
        val line = text.lastIndexOf('\n', end)
        if (line > window) return line + 1

        // Sentence boundary
        for (ch in listOf(". ", "! ", "? ")) {
            val sent = text.lastIndexOf(ch, end)
            if (sent > window) return sent + 2
        }

        // Word boundary
        val word = text.lastIndexOf(' ', end)
        if (word > window) return word + 1

        return end
    }

    // ── BM25 term frequency ───────────────────────────────────────────────────

    /**
     * Compute term frequencies for a chunk.
     * Stored as "term:count,term:count" string for SQLite retrieval.
     */
    private fun buildTermFrequency(text: String): String {
        val tokens = tokenize(text)
        val freq   = mutableMapOf<String, Int>()

        for (token in tokens) {
            freq[token] = (freq[token] ?: 0) + 1
        }

        return freq.entries
            .sortedByDescending { it.value }
            .take(50) // store top 50 terms only
            .joinToString(",") { "${it.key}:${it.value}" }
    }

    /**
     * Score a chunk against a query using BM25-lite (term frequency / doc length).
     * k1=1.5, b=0.75 (standard BM25 params)
     */
    fun scoreChunk(chunk: DocumentChunkEntity, queryTokens: List<String>): Double {
        if (queryTokens.isEmpty()) return 0.0
        val tf = parseTermFrequency(chunk.termFrequencyData)
        val docLength = chunk.content.length.toDouble()
        val avgLength = 600.0  // assumed average chunk length

        var score = 0.0
        val k1 = 1.5
        val b  = 0.75

        for (token in queryTokens) {
            val freq = (tf[token] ?: 0).toDouble()
            if (freq == 0.0) continue

            val tfNorm = (freq * (k1 + 1)) / (freq + k1 * (1 - b + b * docLength / avgLength))
            // IDF approximation: log((N + 1) / (df + 0.5)) — simplified as 1.0 for single doc
            score += tfNorm * 1.0
        }

        return score
    }

    private fun parseTermFrequency(data: String): Map<String, Int> {
        if (data.isBlank()) return emptyMap()
        return data.split(",").associate { pair ->
            val idx = pair.lastIndexOf(':')
            if (idx <= 0) return@associate "" to 0
            pair.substring(0, idx) to (pair.substring(idx + 1).toIntOrNull() ?: 0)
        }
    }

    fun tokenize(text: String): List<String> {
        return text.lowercase()
            .replace(Regex("[^a-z0-9\\s]"), " ")
            .split(Regex("\\s+"))
            .filter { it.length > 2 && it !in STOP_WORDS }
    }
}
