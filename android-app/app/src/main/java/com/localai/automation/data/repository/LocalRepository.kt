package com.localai.automation.data.repository

import com.localai.automation.data.AppDatabase
import com.localai.automation.data.entities.*
import com.localai.automation.models.*
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.localai.automation.proactive.ProactiveSuggestionEntity
import com.localai.automation.proactive.SuggestionStatus
import kotlinx.coroutines.flow.Flow

class LocalRepository(db: AppDatabase) {

    private val locationDao    = db.locationDao()
    private val ruleDao        = db.ruleDao()
    private val eventDao       = db.eventDao()
    private val actionDao      = db.actionDao()
    private val permissionDao  = db.permissionDao()
    private val chatDao        = db.chatDao()
    private val suggestionDao  = db.proactiveSuggestionDao()

    private val gson = Gson()

    // ─── Locations ──────────────────────────────────────────────────────────

    fun getAllLocations(): Flow<List<LocationEntity>> = locationDao.getAllLocations()

    suspend fun getActiveLocations(): List<LocationEntity> = locationDao.getActiveLocations()

    suspend fun insertLocation(entity: LocationEntity): Long = locationDao.insertLocation(entity)

    suspend fun updateLocation(entity: LocationEntity) = locationDao.updateLocation(entity)

    suspend fun deleteLocation(entity: LocationEntity) = locationDao.deleteLocation(entity)

    suspend fun setLocationActive(id: Long, active: Boolean) =
        locationDao.setLocationActive(id, active)

    // ─── Rules ──────────────────────────────────────────────────────────────

    fun getAllRules(): Flow<List<RuleEntity>> = ruleDao.getAllRules()

    suspend fun getActiveRules(): List<RuleEntity> = ruleDao.getActiveRules()

    suspend fun insertRule(entity: RuleEntity): Long = ruleDao.insertRule(entity)

    suspend fun updateRule(entity: RuleEntity) = ruleDao.updateRule(entity)

    suspend fun deleteRule(entity: RuleEntity) = ruleDao.deleteRule(entity)

    suspend fun setRuleEnabled(id: Long, enabled: Boolean) = ruleDao.setRuleEnabled(id, enabled)

    suspend fun incrementRuleTrigger(id: Long) =
        ruleDao.incrementTriggerCount(id, System.currentTimeMillis())

    suspend fun getActiveRuleCount(): Int = ruleDao.getActiveRuleCount()

    // ─── Events ─────────────────────────────────────────────────────────────

    fun getRecentEvents(): Flow<List<EventEntity>> = eventDao.getRecentEvents()

    fun getEventsByModule(module: String): Flow<List<EventEntity>> =
        eventDao.getEventsByModule(module)

    suspend fun insertEvent(event: AgentEvent): Long {
        return eventDao.insertEvent(
            EventEntity(
                agentModule = event.module.name,
                eventType   = event.eventType.name,
                dataJson    = event.dataJson(),
                timestamp   = event.timestamp
            )
        )
    }

    suspend fun getLatestEvents(limit: Int = 50): List<EventEntity> =
        eventDao.getLatestEvents(limit)

    suspend fun pruneOldEvents(keepDays: Int = 7) {
        val cutoff = System.currentTimeMillis() - (keepDays * 24 * 60 * 60 * 1000L)
        eventDao.deleteOldEvents(cutoff)
    }

    // ─── Actions ────────────────────────────────────────────────────────────

    fun getRecentActions(): Flow<List<ActionEntity>> = actionDao.getRecentActions()

    /** Returns only FAILED / DENIED / PERMISSION_DENIED actions. */
    fun getFailedActions(): Flow<List<ActionEntity>> = actionDao.getFailedActions()

    /**
     * Insert an action into the database.
     * @param triggerReason Human-readable explanation of what caused this action.
     */
    suspend fun insertAction(action: AgentAction, triggerReason: String? = null): Long {
        return actionDao.insertAction(
            ActionEntity(
                actionType    = action.actionType.name,
                paramsJson    = action.paramsJson(),
                sourceRuleId  = action.sourceRuleId,
                timestamp     = action.timestamp,
                triggerReason = triggerReason
            )
        )
    }

    suspend fun updateActionResult(id: Long, status: String, error: String? = null) =
        actionDao.updateActionResult(id, status, error)

    // ─── Permissions ────────────────────────────────────────────────────────

    fun getAllPermissions(): Flow<List<PermissionHistoryEntity>> = permissionDao.getAllPermissions()

    suspend fun upsertPermission(permission: String, granted: Boolean, action: String? = null) {
        permissionDao.upsertPermission(
            PermissionHistoryEntity(
                permission  = permission,
                isGranted   = granted,
                lastChecked = System.currentTimeMillis(),
                lastAction  = action
            )
        )
    }

    // ─── Chat ───────────────────────────────────────────────────────────────

    fun getAllChatMessages(): Flow<List<ChatMessageEntity>> = chatDao.getAllMessages()

    suspend fun insertChatMessage(content: String, isUser: Boolean, ruleId: Long? = null): Long {
        return chatDao.insertMessage(
            ChatMessageEntity(content = content, isUser = isUser, linkedRuleId = ruleId)
        )
    }

    suspend fun clearChat() = chatDao.clearAll()

    // ─── Proactive Suggestions ───────────────────────────────────────────────

    fun getPendingSuggestions(): Flow<List<ProactiveSuggestionEntity>> = 
        suggestionDao.getPendingSuggestions()

    suspend fun acceptSuggestion(id: String): Boolean {
        val suggestion = suggestionDao.getSuggestionById(id) ?: return false
        
        // 1. Create the rule
        val ruleId = ruleDao.insertRule(
            RuleEntity(
                name          = suggestion.title,
                conditionJson = suggestion.conditionJson,
                actionJson    = suggestion.actionJson,
                priority      = 0.5f // Default
            )
        )
        
        // 2. Update suggestion status
        if (ruleId > 0) {
            suggestionDao.updateStatus(id, SuggestionStatus.ACCEPTED)
            return true
        }
        return false
    }

    suspend fun dismissSuggestion(id: String) {
        suggestionDao.updateStatus(id, SuggestionStatus.DISMISSED)
    }

    // ─── Rule Parsing Helper ─────────────────────────────────────────────────

    fun parseRuleCondition(json: String): RuleCondition? = try {
        gson.fromJson(json, RuleCondition::class.java)
    } catch (e: Exception) { null }

    fun parseRuleAction(json: String): AgentAction? = try {
        val mapType = object : TypeToken<Map<String, Any>>() {}.type
        val map: Map<String, Any> = gson.fromJson(json, mapType)
        val actionType = ActionType.valueOf(map["actionType"].toString())
        @Suppress("UNCHECKED_CAST")
        val params = (map["params"] as? Map<String, Any>) ?: emptyMap()
        AgentAction(actionType = actionType, params = params)
    } catch (e: Exception) { null }
}