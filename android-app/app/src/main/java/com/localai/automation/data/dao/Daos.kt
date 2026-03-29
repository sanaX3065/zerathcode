package com.localai.automation.data.dao

import androidx.room.*
import com.localai.automation.data.entities.*
import kotlinx.coroutines.flow.Flow

// ─── Location DAO ─────────────────────────────────────────────────────────────

@Dao
interface LocationDao {
    @Query("SELECT * FROM locations ORDER BY createdAt DESC")
    fun getAllLocations(): Flow<List<LocationEntity>>

    @Query("SELECT * FROM locations WHERE isActive = 1")
    suspend fun getActiveLocations(): List<LocationEntity>

    @Query("SELECT * FROM locations WHERE id = :id")
    suspend fun getLocationById(id: Long): LocationEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertLocation(location: LocationEntity): Long

    @Update
    suspend fun updateLocation(location: LocationEntity)

    @Delete
    suspend fun deleteLocation(location: LocationEntity)

    @Query("UPDATE locations SET isActive = :isActive WHERE id = :id")
    suspend fun setLocationActive(id: Long, isActive: Boolean)
}

// ─── Rule DAO ─────────────────────────────────────────────────────────────────

@Dao
interface RuleDao {
    @Query("SELECT * FROM rules ORDER BY priority DESC, createdAt DESC")
    fun getAllRules(): Flow<List<RuleEntity>>

    @Query("SELECT * FROM rules WHERE isEnabled = 1 ORDER BY priority DESC")
    suspend fun getActiveRules(): List<RuleEntity>

    @Query("SELECT * FROM rules WHERE id = :id")
    suspend fun getRuleById(id: Long): RuleEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertRule(rule: RuleEntity): Long

    @Update
    suspend fun updateRule(rule: RuleEntity)

    @Delete
    suspend fun deleteRule(rule: RuleEntity)

    @Query("UPDATE rules SET isEnabled = :isEnabled WHERE id = :id")
    suspend fun setRuleEnabled(id: Long, isEnabled: Boolean)

    @Query("UPDATE rules SET triggerCount = triggerCount + 1, lastTriggered = :timestamp WHERE id = :id")
    suspend fun incrementTriggerCount(id: Long, timestamp: Long)

    @Query("SELECT COUNT(*) FROM rules WHERE isEnabled = 1")
    suspend fun getActiveRuleCount(): Int
}

// ─── Event DAO ────────────────────────────────────────────────────────────────

@Dao
interface EventDao {
    @Query("SELECT * FROM events ORDER BY timestamp DESC LIMIT 200")
    fun getRecentEvents(): Flow<List<EventEntity>>

    @Query("SELECT * FROM events WHERE agentModule = :module ORDER BY timestamp DESC LIMIT 50")
    fun getEventsByModule(module: String): Flow<List<EventEntity>>

    @Query("SELECT * FROM events ORDER BY timestamp DESC LIMIT :limit")
    suspend fun getLatestEvents(limit: Int = 50): List<EventEntity>

    @Insert
    suspend fun insertEvent(event: EventEntity): Long

    @Query("UPDATE events SET processed = 1 WHERE id = :id")
    suspend fun markProcessed(id: Long)

    @Query("DELETE FROM events WHERE timestamp < :before")
    suspend fun deleteOldEvents(before: Long)

    @Query("SELECT COUNT(*) FROM events")
    suspend fun getEventCount(): Int
}

// ─── Action DAO ───────────────────────────────────────────────────────────────

@Dao
interface ActionDao {
    @Query("SELECT * FROM actions ORDER BY timestamp DESC LIMIT 200")
    fun getRecentActions(): Flow<List<ActionEntity>>

    @Query("SELECT * FROM actions ORDER BY timestamp DESC LIMIT :limit")
    suspend fun getLatestActions(limit: Int = 50): List<ActionEntity>

    /** All failed, denied, or permission-denied actions — drives the Errors tab. */
    @Query("""
        SELECT * FROM actions
        WHERE resultStatus IN ('FAILED', 'DENIED', 'PERMISSION_DENIED')
        ORDER BY timestamp DESC
        LIMIT 100
    """)
    fun getFailedActions(): Flow<List<ActionEntity>>

    @Insert
    suspend fun insertAction(action: ActionEntity): Long

    @Query("UPDATE actions SET resultStatus = :status, errorMessage = :error WHERE id = :id")
    suspend fun updateActionResult(id: Long, status: String, error: String? = null)

    @Query("DELETE FROM actions WHERE timestamp < :before")
    suspend fun deleteOldActions(before: Long)
}

// ─── Permission DAO ───────────────────────────────────────────────────────────

@Dao
interface PermissionDao {
    @Query("SELECT * FROM permission_history")
    fun getAllPermissions(): Flow<List<PermissionHistoryEntity>>

    @Query("SELECT * FROM permission_history WHERE permission = :permission")
    suspend fun getPermission(permission: String): PermissionHistoryEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertPermission(permission: PermissionHistoryEntity)
}

// ─── Chat DAO ─────────────────────────────────────────────────────────────────

@Dao
interface ChatDao {
    @Query("SELECT * FROM chat_messages ORDER BY timestamp ASC")
    fun getAllMessages(): Flow<List<ChatMessageEntity>>

    @Insert
    suspend fun insertMessage(message: ChatMessageEntity): Long

    @Query("DELETE FROM chat_messages")
    suspend fun clearAll()
}