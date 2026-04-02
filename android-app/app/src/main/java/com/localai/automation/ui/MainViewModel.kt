package com.localai.automation.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.localai.automation.data.AppDatabase
import com.localai.automation.data.entities.*
import com.localai.automation.data.repository.LocalRepository
import com.localai.automation.engine.CommandParser
import com.localai.automation.models.*
import com.localai.automation.proactive.ProactiveSuggestionEntity
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

class MainViewModel(app: Application) : AndroidViewModel(app) {

    private val db = AppDatabase.getInstance(app)
    val repository = LocalRepository(db)
    private val commandParser = CommandParser()

    // ─── Exposed Flows ────────────────────────────────────────────────────────
    val locations     = repository.getAllLocations().stateIn(viewModelScope, SharingStarted.Lazily, emptyList())
    val rules         = repository.getAllRules().stateIn(viewModelScope, SharingStarted.Lazily, emptyList())
    val events        = repository.getRecentEvents().stateIn(viewModelScope, SharingStarted.Lazily, emptyList())
    val actions       = repository.getRecentActions().stateIn(viewModelScope, SharingStarted.Lazily, emptyList())
    val chatMessages  = repository.getAllChatMessages().stateIn(viewModelScope, SharingStarted.Lazily, emptyList())
    val failedActions = repository.getFailedActions().stateIn(viewModelScope, SharingStarted.Lazily, emptyList())

    // ─── Proactive state ──────────────────────────────────────────────────────
    val pendingSuggestions: StateFlow<List<ProactiveSuggestionEntity>> = repository.getPendingSuggestions()
        .stateIn(viewModelScope, SharingStarted.Lazily, emptyList())

    suspend fun triggerProactiveAnalysis(): Int {
        // This is typically handled by the ProactiveEngine owned by the Service.
        // We return 0 here as a placeholder if not directly triggering from VM.
        return 0
    }

    suspend fun acceptSuggestion(suggestionId: String): Boolean {
        return repository.acceptSuggestion(suggestionId)
    }

    suspend fun dismissSuggestion(suggestionId: String) {
        repository.dismissSuggestion(suggestionId)
    }

    // ─── Chat: parse only (no side effects) ──────────────────────────────────

    /**
     * Pure parse — returns a result for showing the preview dialog.
     * Does NOT insert anything into the database.
     */
    fun parseCommand(input: String): CommandParser.ParseResult =
        commandParser.parse(input)

    /**
     * Called after user confirms the preview dialog.
     * Saves both the user message and the created rule.
     */
    fun confirmRule(userInput: String, result: CommandParser.ParseResult) {
        viewModelScope.launch {
            repository.insertChatMessage(userInput, isUser = true)
            val ruleId = repository.insertRule(
                RuleEntity(
                    name = result.ruleName,
                    conditionJson = result.conditionJson,
                    actionJson = result.actionJson,
                    priority = result.priority
                )
            )
            repository.insertChatMessage(result.feedback, isUser = false, ruleId = ruleId)
        }
    }

    /**
     * Called when parsing fails — shows the error feedback in chat.
     */
    fun sendErrorFeedback(userInput: String, feedback: String) {
        viewModelScope.launch {
            repository.insertChatMessage(userInput, isUser = true)
            repository.insertChatMessage(feedback, isUser = false)
        }
    }

    fun clearChat() = viewModelScope.launch { repository.clearChat() }

    // ─── Locations ────────────────────────────────────────────────────────────

    fun addLocation(name: String, lat: Double, lng: Double, radius: Float) {
        viewModelScope.launch {
            repository.insertLocation(
                LocationEntity(name = name, latitude = lat, longitude = lng, radius = radius)
            )
        }
    }

    fun deleteLocation(entity: LocationEntity) =
        viewModelScope.launch { repository.deleteLocation(entity) }

    fun toggleLocation(id: Long, active: Boolean) =
        viewModelScope.launch { repository.setLocationActive(id, active) }

    // ─── Rules ────────────────────────────────────────────────────────────────

    fun toggleRule(id: Long, enabled: Boolean) =
        viewModelScope.launch { repository.setRuleEnabled(id, enabled) }

    fun deleteRule(entity: RuleEntity) =
        viewModelScope.launch { repository.deleteRule(entity) }

    fun addManualRule(name: String, conditionJson: String, actionJson: String, priority: Float) {
        viewModelScope.launch {
            repository.insertRule(
                RuleEntity(
                    name = name,
                    conditionJson = conditionJson,
                    actionJson = actionJson,
                    priority = priority
                )
            )
        }
    }
}
