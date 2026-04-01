package com.localai.automation.proactive

import android.util.Log
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.localai.automation.bridge.BridgeManager
import com.localai.automation.bridge.BridgeMessage
import com.localai.automation.data.repository.LocalRepository
import com.localai.automation.engine.StateTracker
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import java.util.concurrent.TimeUnit

/**
 * ProactiveEngine
 *
 * Runs in the background (owned by AgentRuntimeService).
 * Periodically sends device event history to the Node.js proactiveAgent
 * and stores returned suggestions for the UI.
 *
 * Schedule: runs every 4 hours minimum, only if bridge is connected.
 */
class ProactiveEngine(
    private val repository:          LocalRepository,
    private val suggestionDao:        ProactiveSuggestionDao,
    private val bridgeManager:        BridgeManager,
) {
    companion object {
        private const val TAG               = "ProactiveEngine"
        private val ANALYSIS_INTERVAL_MS    = TimeUnit.HOURS.toMillis(4)
        private val EXPIRY_CUTOFF_MS        = TimeUnit.DAYS.toMillis(7)
        private val PRUNE_CUTOFF_MS         = TimeUnit.DAYS.toMillis(30)
        private const val MIN_EVENTS        = 20     // need at least this many events
        private const val TIMEOUT_MS        = 15_000L
    }

    private val scope   = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var lastRun = 0L
    private val gson    = Gson()

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    fun start() {
        scope.launch {
            while (isActive) {
                delay(TimeUnit.MINUTES.toMillis(30)) // check every 30 min
                maybeRunAnalysis()
            }
        }
        Log.i(TAG, "Proactive engine started")
    }

    fun stop() {
        scope.cancel()
        Log.i(TAG, "Proactive engine stopped")
    }

    /**
     * Trigger analysis immediately (e.g. user opens suggestion screen).
     */
    suspend fun triggerNow(): Int {
        return runAnalysis()
    }

    // ── Analysis scheduling ───────────────────────────────────────────────────

    private suspend fun maybeRunAnalysis() {
        val now = System.currentTimeMillis()
        if (now - lastRun < ANALYSIS_INTERVAL_MS) return
        if (!bridgeManager.isConnected()) return

        runAnalysis()
    }

    private suspend fun runAnalysis(): Int {
        // Expire old suggestions first
        val cutoff = System.currentTimeMillis() - EXPIRY_CUTOFF_MS
        suggestionDao.expireOldSuggestions(cutoff)
        suggestionDao.pruneOldSuggestions(System.currentTimeMillis() - PRUNE_CUTOFF_MS)

        // Gather event history
        val events = repository.getLatestEvents(limit = 100)
        if (events.size < MIN_EVENTS) {
            Log.d(TAG, "Not enough events for analysis: ${events.size}/$MIN_EVENTS")
            return 0
        }

        // Get existing rules to avoid suggesting duplicates
        val existingRules = repository.getActiveRules()

        // Get device state
        val deviceState = StateTracker.get()?.snapshot() ?: emptyMap()

        // Build payload
        val eventsPayload = events.map { e ->
            mapOf(
                "module"     to e.agentModule,
                "eventType"  to e.eventType,
                "timestamp"  to e.timestamp,
                "data"       to safeParseMap(e.dataJson),
            )
        }
        val rulesPayload = existingRules.map { r ->
            mapOf("name" to r.name, "isEnabled" to r.isEnabled)
        }

        val msgId = java.util.UUID.randomUUID().toString()
        val payload = mapOf(
            "events"        to eventsPayload,
            "existingRules" to rulesPayload,
            "deviceState"   to deviceState,
        )

        Log.i(TAG, "Sending ${events.size} events for proactive analysis")

        // Send to bridge and await response
        val result = withTimeoutOrNull(TIMEOUT_MS) {
            suspendCancellableCoroutine<List<ProactiveSuggestionEntity>> { cont ->
                val original = bridgeManager.bridge.onMessageReceived

                bridgeManager.bridge.onMessageReceived = { msg ->
                    if (msg.id == msgId && msg.type == "ack") {
                        bridgeManager.bridge.onMessageReceived = original

                        val suggestions = parseSuggestions(msg.payload)
                        cont.resume(suggestions)
                    } else if (msg.id == msgId && msg.type == "error") {
                        bridgeManager.bridge.onMessageReceived = original
                        Log.w(TAG, "Proactive error: ${msg.payload["message"]}")
                        cont.resume(emptyList())
                    } else {
                        original?.invoke(msg)
                    }
                }

                val sent = bridgeManager.bridge.send(
                    BridgeMessage(id = msgId, type = "analyze_events", payload = payload)
                )
                if (!sent) {
                    bridgeManager.bridge.onMessageReceived = original
                    cont.resume(emptyList())
                }

                cont.invokeOnCancellation {
                    bridgeManager.bridge.onMessageReceived = original
                }
            }
        } ?: emptyList()

        if (result.isNotEmpty()) {
            suggestionDao.insertSuggestions(result)
            Log.i(TAG, "Stored ${result.size} new suggestion(s)")
        }

        lastRun = System.currentTimeMillis()
        return result.size
    }

    // ── Suggestion helpers ────────────────────────────────────────────────────

    private fun parseSuggestions(payload: Map<String, Any>): List<ProactiveSuggestionEntity> {
        @Suppress("UNCHECKED_CAST")
        val raw = payload["suggestions"] as? List<Map<String, Any>> ?: return emptyList()

        return raw.mapNotNull { s ->
            try {
                ProactiveSuggestionEntity(
                    id                 = s["id"]?.toString() ?: return@mapNotNull null,
                    title              = s["title"]?.toString() ?: return@mapNotNull null,
                    description        = s["description"]?.toString() ?: "",
                    triggerDescription = s["trigger"]?.toString() ?: "",
                    actionDescription  = s["action"]?.toString() ?: "",
                    confidence         = (s["confidence"] as? Double)?.toFloat() ?: 0.5f,
                    patternStrength    = s["patternStrength"]?.toString() ?: "moderate",
                    conditionJson      = gson.toJson(s["conditionJson"] ?: return@mapNotNull null),
                    actionJson         = gson.toJson(s["actionJson"] ?: return@mapNotNull null),
                )
            } catch (e: Exception) {
                Log.w(TAG, "Failed to parse suggestion: ${e.message}")
                null
            }
        }
    }

    // ── Accept a suggestion → create the rule ─────────────────────────────────

    suspend fun acceptSuggestion(suggestionId: String): Boolean {
        val suggestion = suggestionDao.getSuggestionById(suggestionId) ?: return false

        return try {
            repository.insertRule(
                com.localai.automation.data.entities.RuleEntity(
                    name          = suggestion.title,
                    conditionJson = suggestion.conditionJson,
                    actionJson    = suggestion.actionJson,
                    priority      = suggestion.confidence,
                )
            )
            suggestionDao.updateStatus(suggestionId, SuggestionStatus.ACCEPTED)
            Log.i(TAG, "Accepted suggestion: ${suggestion.title}")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to create rule from suggestion", e)
            false
        }
    }

    suspend fun dismissSuggestion(suggestionId: String) {
        suggestionDao.updateStatus(suggestionId, SuggestionStatus.DISMISSED)
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun safeParseMap(json: String): Map<String, Any> {
        return try {
            val type = object : TypeToken<Map<String, Any>>() {}.type
            gson.fromJson(json, type) ?: emptyMap()
        } catch (e: Exception) { emptyMap() }
    }
}
