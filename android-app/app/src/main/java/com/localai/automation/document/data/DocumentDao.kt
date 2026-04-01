package com.localai.automation.document.data

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Dao
interface DocumentDao {

    // ── Documents ─────────────────────────────────────────────────────────────

    @Query("SELECT * FROM documents ORDER BY createdAt DESC")
    fun getAllDocuments(): Flow<List<DocumentEntity>>

    @Query("SELECT * FROM documents WHERE id = :id")
    suspend fun getDocumentById(id: Long): DocumentEntity?

    @Query("SELECT * FROM documents WHERE uri = :uri LIMIT 1")
    suspend fun getDocumentByUri(uri: String): DocumentEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertDocument(document: DocumentEntity): Long

    @Update
    suspend fun updateDocument(document: DocumentEntity)

    @Query("UPDATE documents SET isProcessed = :processed, chunkCount = :chunkCount, " +
           "charCount = :charCount, updatedAt = :updatedAt WHERE id = :id")
    suspend fun markProcessed(id: Long, processed: Boolean, chunkCount: Int, charCount: Int, updatedAt: Long)

    @Query("UPDATE documents SET riskLevel = :riskLevel, riskFlagsJson = :flagsJson, " +
           "obligationsJson = :obligationsJson, summary = :summary, updatedAt = :updatedAt WHERE id = :id")
    suspend fun updateRiskAssessment(
        id: Long, riskLevel: RiskLevel, flagsJson: String,
        obligationsJson: String, summary: String, updatedAt: Long
    )

    @Delete
    suspend fun deleteDocument(document: DocumentEntity)

    @Query("DELETE FROM documents WHERE id = :id")
    suspend fun deleteDocumentById(id: Long)

    @Query("SELECT COUNT(*) FROM documents")
    suspend fun getDocumentCount(): Int

    // ── Chunks ────────────────────────────────────────────────────────────────

    @Query("SELECT * FROM document_chunks WHERE documentId = :documentId ORDER BY chunkIndex ASC")
    suspend fun getChunksForDocument(documentId: Long): List<DocumentChunkEntity>

    @Query("SELECT * FROM document_chunks WHERE documentId = :documentId " +
           "ORDER BY chunkIndex ASC LIMIT :limit")
    suspend fun getChunksForDocumentPaged(documentId: Long, limit: Int): List<DocumentChunkEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertChunks(chunks: List<DocumentChunkEntity>)

    @Query("DELETE FROM document_chunks WHERE documentId = :documentId")
    suspend fun deleteChunksForDocument(documentId: Long)

    @Query("SELECT COUNT(*) FROM document_chunks WHERE documentId = :documentId")
    suspend fun getChunkCountForDocument(documentId: Long): Int

    // ── Keyword search (BM25-style via LIKE) ──────────────────────────────────
    // For Phase 3 we use SQLite FTS-style search as a starting point.
    // Phase 4 can upgrade to proper vector similarity.

    @Query("""
        SELECT * FROM document_chunks
        WHERE documentId = :documentId
        AND content LIKE '%' || :term || '%'
        ORDER BY chunkIndex ASC
        LIMIT :limit
    """)
    suspend fun searchChunksByTerm(documentId: Long, term: String, limit: Int = 20): List<DocumentChunkEntity>

    @Query("""
        SELECT * FROM document_chunks
        WHERE documentId IN (:documentIds)
        AND content LIKE '%' || :term || '%'
        ORDER BY documentId ASC, chunkIndex ASC
        LIMIT :limit
    """)
    suspend fun searchChunksAcrossDocuments(
        documentIds: List<Long>, term: String, limit: Int = 30
    ): List<DocumentChunkEntity>
}
