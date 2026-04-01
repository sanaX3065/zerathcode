package com.localai.automation.document.data

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

// ── Document metadata ─────────────────────────────────────────────────────────

@Entity(tableName = "documents")
data class DocumentEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,

    /** Display name shown in UI */
    val name: String,

    /** Original URI string (content:// or file://) */
    val uri: String,

    /** MIME type: application/pdf | application/vnd.openxmlformats... | text/plain */
    val mimeType: String,

    /** File size in bytes */
    val sizeBytes: Long,

    /** Number of text chunks stored */
    val chunkCount: Int = 0,

    /** Total characters extracted */
    val charCount: Int = 0,

    /** Risk level assigned by classifier */
    val riskLevel: RiskLevel = RiskLevel.UNKNOWN,

    /** JSON array of risk flag strings */
    val riskFlagsJson: String = "[]",

    /** JSON array of obligation strings found in document */
    val obligationsJson: String = "[]",

    /** One-sentence AI-generated summary */
    val summary: String = "",

    /** Whether full processing (chunking + risk) is complete */
    val isProcessed: Boolean = false,

    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
)

// ── Document text chunk ───────────────────────────────────────────────────────

@Entity(
    tableName = "document_chunks",
    foreignKeys = [
        ForeignKey(
            entity = DocumentEntity::class,
            parentColumns = ["id"],
            childColumns  = ["documentId"],
            onDelete      = ForeignKey.CASCADE
        )
    ],
    indices = [Index("documentId")]
)
data class DocumentChunkEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,

    val documentId: Long,

    /** Sequential chunk index within the document */
    val chunkIndex: Int,

    /** The raw text content of this chunk */
    val content: String,

    /** Page number (1-based) this chunk came from. 0 = unknown */
    val pageNumber: Int = 0,

    /** BM25-style token frequency map stored as "token:count,token:count" */
    val termFrequencyData: String = "",

    /** Character offset within the full document text */
    val charOffset: Int = 0,
)

// ── Risk levels ───────────────────────────────────────────────────────────────

enum class RiskLevel {
    UNKNOWN,     // not yet assessed
    SAFE,        // no flags found
    LOW,         // minor flags (e.g. personal info)
    MEDIUM,      // moderate flags (e.g. legal clauses, financial data)
    HIGH,        // serious flags (e.g. SSN, unusual legal terms)
    CRITICAL,    // critical flags (e.g. fraud indicators, PII clusters)
}
