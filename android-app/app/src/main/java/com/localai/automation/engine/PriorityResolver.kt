package com.localai.automation.engine

import android.util.Log
import com.localai.automation.models.ActionType
import com.localai.automation.models.AgentAction
import com.localai.automation.pipeline.EventPipeline

/**
 * Formal weighted priority scoring system.
 *
 * Score = w1*userPriority + w2*recency + w3*contextRelevance - w4*safetyPenalty
 * All weights sum to 1.0. Final score normalized to [0.0, 1.0].
 */
class PriorityEngine {

    companion object {
        private const val TAG = "PriorityEngine"

        // Scoring weights (must sum to 1.0)
        private const val W_USER_PRIORITY    = 0.45f
        private const val W_RECENCY          = 0.20f
        private const val W_CONTEXT          = 0.25f
        private const val W_SAFETY_PENALTY   = 0.10f

        // Recency decay window: score drops linearly to 0 over this period
        private const val RECENCY_WINDOW_MS = 60_000L
    }

    /**
     * Score a single action. Returns a value in [0.0, 1.0].
     * Documents each weight component for traceability.
     */
    fun score(action: AgentAction, pipeline: EventPipeline): Float {
        val userPriorityScore = action.priority.coerceIn(0f, 1f)

        val ageMs = System.currentTimeMillis() - action.timestamp
        val recencyScore = (1f - (ageMs.toFloat() / RECENCY_WINDOW_MS)).coerceIn(0f, 1f)

        val contextScore = computeContextScore(action, pipeline)

        val safetyPenalty = computeSafetyPenalty(action, pipeline)

        val raw = (W_USER_PRIORITY * userPriorityScore) +
                  (W_RECENCY * recencyScore) +
                  (W_CONTEXT * contextScore) -
                  (W_SAFETY_PENALTY * safetyPenalty)

        val normalized = raw.coerceIn(0f, 1f)

        Log.d(TAG, "${action.actionType} score: " +
            "user=${userPriorityScore} recency=${recencyScore} " +
            "ctx=${contextScore} safety_pen=${safetyPenalty} → $normalized")

        return normalized
    }

    /**
     * Score and rank a list of actions. Returns sorted list (highest first).
     */
    fun rank(actions: List<AgentAction>, pipeline: EventPipeline): List<Pair<AgentAction, Float>> =
        actions
            .map { Pair(it, score(it, pipeline)) }
            .sortedByDescending { it.second }
            .also { ranked ->
                ObservabilityLogger.system(
                    "Priority ranking: ${ranked.joinToString { "${it.first.actionType}=${it.second}" }}"
                )
            }

    // ─── Context Score ────────────────────────────────────────────────────────

    /**
     * Context score: boost actions that align with recent system context.
     */
    private fun computeContextScore(action: AgentAction, pipeline: EventPipeline): Float {
        val recentEvents = pipeline.getRecentEvents(10)
        var score = 0.5f  // neutral baseline

        when (action.actionType) {
            ActionType.SET_SILENT_MODE -> {
                // Boost silent if battery low event was recent
                val hasRecentBatteryLow = recentEvents.any {
                    it.eventType.name == "BATTERY_LOW" &&
                    (System.currentTimeMillis() - it.timestamp) < 30_000L
                }
                if (hasRecentBatteryLow) score += 0.3f
            }
            ActionType.SET_BRIGHTNESS -> {
                val hasRecentCharging = recentEvents.any {
                    it.eventType.name == "CHARGING_STARTED"
                }
                if (hasRecentCharging) score += 0.2f
            }
            else -> {}
        }
        return score.coerceIn(0f, 1f)
    }

    // ─── Safety Penalty ───────────────────────────────────────────────────────

    /**
     * Safety penalty: reduce score for potentially disruptive actions in certain contexts.
     */
    private fun computeSafetyPenalty(action: AgentAction, pipeline: EventPipeline): Float {
        var penalty = 0f
        val recentEvents = pipeline.getRecentEvents(5)

        // Penalize silencing if user just opened a media/music app
        if (action.actionType == ActionType.SET_SILENT_MODE) {
            val musicActive = recentEvents.any { event ->
                event.data["package"]?.toString()?.let {
                    it.contains("music") || it.contains("spotify") ||
                    it.contains("youtube") || it.contains("media")
                } == true
            }
            if (musicActive) penalty += 0.8f  // Strong deterrent
        }

        return penalty.coerceIn(0f, 1f)
    }
}

// ─── Action Resolver ─────────────────────────────────────────────────────────

class ActionResolver {

    companion object {
        private const val TAG = "ActionResolver"

        private val CONFLICT_GROUPS = mapOf(
            "audio"   to setOf(ActionType.SET_SILENT_MODE, ActionType.SET_VIBRATION),
            "display" to setOf(ActionType.SET_BRIGHTNESS)
        )
    }

    fun resolve(rankedActions: List<Pair<AgentAction, Float>>): List<AgentAction> {
        if (rankedActions.isEmpty()) return emptyList()
        if (rankedActions.size == 1) return listOf(rankedActions[0].first)

        val resolved = mutableListOf<AgentAction>()
        val usedGroups = mutableSetOf<String>()

        for ((action, score) in rankedActions) {
            val group = getConflictGroup(action.actionType)
            if (group != null) {
                if (group !in usedGroups) {
                    usedGroups.add(group)
                    resolved.add(action)
                    Log.d(TAG, "Resolved: ${action.actionType} score=$score group=$group")
                } else {
                    Log.d(TAG, "Conflict: dropped ${action.actionType} — group $group claimed")
                }
            } else {
                resolved.add(action)
            }
        }

        ObservabilityLogger.system("Resolved ${resolved.size}/${rankedActions.size} actions after conflict check")
        return resolved
    }

    private fun getConflictGroup(actionType: ActionType): String? =
        CONFLICT_GROUPS.entries.firstOrNull { actionType in it.value }?.key
}
