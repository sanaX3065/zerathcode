package com.localai.automation.proactive

import androidx.room.*
import kotlinx.coroutines.flow.Flow

// ── Entity ────────────────────────────────────────────────────────────────────

@Entity(tableName = "proactive_suggestions")
data class ProactiveSuggestionEntity(
    @PrimaryKey
    val id: String,                   // AI-generated unique ID

    val title: String,
    val description: String,
    val triggerDescription: String,   // "When battery drops low…"
    val actionDescription: String,    // "Set phone to silent"

    val confidence: Float,            // 0.0 – 1.0
    val patternStrength: String,      // "weak" | "moderate" | "strong"

    val conditionJson: String,        // ready to insert as RuleEntity.conditionJson
    val actionJson: String,           // ready to insert as RuleEntity.actionJson

    val status: SuggestionStatus = SuggestionStatus.PENDING,
    val createdAt: Long = System.currentTimeMillis(),
)

enum class SuggestionStatus {
    PENDING,    // shown to user, no action taken
    ACCEPTED,   // user tapped "Create Rule" → rule was created
    DISMISSED,  // user dismissed
    EXPIRED,    // older than 7 days without action
}

// ── DAO ───────────────────────────────────────────────────────────────────────

@Dao
interface ProactiveSuggestionDao {

    @Query("SELECT * FROM proactive_suggestions WHERE status = 'PENDING' ORDER BY confidence DESC")
    fun getPendingSuggestions(): Flow<List<ProactiveSuggestionEntity>>

    @Query("SELECT * FROM proactive_suggestions ORDER BY createdAt DESC LIMIT 50")
    fun getAllSuggestions(): Flow<List<ProactiveSuggestionEntity>>

    @Query("SELECT * FROM proactive_suggestions WHERE id = :id")
    suspend fun getSuggestionById(id: String): ProactiveSuggestionEntity?

    @Insert(onConflict = OnConflictStrategy.IGNORE)  // ignore duplicates
    suspend fun insertSuggestions(suggestions: List<ProactiveSuggestionEntity>)

    @Query("UPDATE proactive_suggestions SET status = :status WHERE id = :id")
    suspend fun updateStatus(id: String, status: SuggestionStatus)

    @Query("UPDATE proactive_suggestions SET status = 'EXPIRED' WHERE status = 'PENDING' " +
           "AND createdAt < :cutoffMs")
    suspend fun expireOldSuggestions(cutoffMs: Long)

    @Query("DELETE FROM proactive_suggestions WHERE status IN ('DISMISSED', 'EXPIRED') " +
           "AND createdAt < :cutoffMs")
    suspend fun pruneOldSuggestions(cutoffMs: Long)

    @Query("SELECT COUNT(*) FROM proactive_suggestions WHERE status = 'PENDING'")
    suspend fun getPendingCount(): Int
}
