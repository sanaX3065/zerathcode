package com.localai.automation.engine

import android.util.Log
import java.util.concurrent.ConcurrentHashMap

/**
 * Enforces per-rule and per-action-type cooldowns.
 * Prevents repeated triggers, battery drain, and bad UX from burst events.
 */
class CooldownManager {

    companion object {
        private const val TAG = "CooldownManager"

        // Default cooldowns per action type (ms)
        val DEFAULT_ACTION_COOLDOWNS = mapOf(
            "SET_SILENT_MODE" to 10_000L,   // 10 seconds
            "SET_VIBRATION"   to 10_000L,
            "SET_BRIGHTNESS"  to 5_000L,
            "SEND_NOTIFICATION" to 30_000L, // 30 seconds
            "LOG_ONLY"        to 1_000L
        )

        // Default per-rule cooldown if not specified
        const val DEFAULT_RULE_COOLDOWN_MS = 15_000L  // 15 seconds

        private val instance by lazy { CooldownManager() }
        fun get() = instance
    }

    // ruleId → last trigger timestamp
    private val ruleCooldowns = ConcurrentHashMap<Long, Long>()

    // actionType → last execution timestamp
    private val actionCooldowns = ConcurrentHashMap<String, Long>()

    // eventKey (module:eventType) → last seen timestamp + count
    private data class EventBurst(val count: Int, val firstSeen: Long, val lastSeen: Long)
    private val eventBursts = ConcurrentHashMap<String, EventBurst>()

    // ─── Rule Cooldown ────────────────────────────────────────────────────────

    /**
     * Returns true if this rule is allowed to fire.
     * @param cooldownMs override; uses DEFAULT_RULE_COOLDOWN_MS if null
     */
    fun isRuleAllowed(ruleId: Long, cooldownMs: Long = DEFAULT_RULE_COOLDOWN_MS): Boolean {
        val last = ruleCooldowns[ruleId] ?: return true
        val elapsed = System.currentTimeMillis() - last
        if (elapsed < cooldownMs) {
            Log.d(TAG, "Rule $ruleId on cooldown (${(cooldownMs - elapsed) / 1000}s remaining)")
            return false
        }
        return true
    }

    fun markRuleTriggered(ruleId: Long) {
        ruleCooldowns[ruleId] = System.currentTimeMillis()
    }

    // ─── Action Cooldown ──────────────────────────────────────────────────────

    /**
     * Returns true if this action type is allowed to execute.
     */
    fun isActionAllowed(actionType: String): Boolean {
        val cooldown = DEFAULT_ACTION_COOLDOWNS[actionType] ?: 0L
        if (cooldown == 0L) return true
        val last = actionCooldowns[actionType] ?: return true
        val elapsed = System.currentTimeMillis() - last
        if (elapsed < cooldown) {
            Log.d(TAG, "Action $actionType on cooldown (${(cooldown - elapsed) / 1000}s remaining)")
            return false
        }
        return true
    }

    fun markActionExecuted(actionType: String) {
        actionCooldowns[actionType] = System.currentTimeMillis()
    }

    // ─── Event Burst / Rate Limiting ──────────────────────────────────────────

    /**
     * Records an event occurrence and returns true if it should be processed.
     * Throttles burst events to max [maxPerWindow] per [windowMs].
     */
    fun shouldProcessEvent(
        module: String,
        eventType: String,
        maxPerWindow: Int = 5,
        windowMs: Long = 10_000L
    ): Boolean {
        val key = "$module:$eventType"
        val now = System.currentTimeMillis()
        val burst = eventBursts[key]

        return if (burst == null || (now - burst.firstSeen) > windowMs) {
            // New window
            eventBursts[key] = EventBurst(1, now, now)
            true
        } else if (burst.count >= maxPerWindow) {
            Log.d(TAG, "Event $key throttled (${burst.count} in ${(now - burst.firstSeen)}ms window)")
            // Update last seen but don't increment count once capped
            eventBursts[key] = burst.copy(lastSeen = now)
            false
        } else {
            eventBursts[key] = burst.copy(count = burst.count + 1, lastSeen = now)
            true
        }
    }

    // ─── Reset ────────────────────────────────────────────────────────────────

    fun resetRule(ruleId: Long) {
        ruleCooldowns.remove(ruleId)
        Log.d(TAG, "Cooldown reset for rule $ruleId")
    }

    fun resetAll() {
        ruleCooldowns.clear()
        actionCooldowns.clear()
        eventBursts.clear()
        Log.d(TAG, "All cooldowns reset")
    }

    fun getCooldownStatus(): Map<String, Any> = mapOf(
        "activRuleCooldowns" to ruleCooldowns.size,
        "activeActionCooldowns" to actionCooldowns.size,
        "trackedEventStreams" to eventBursts.size
    )
}
