package com.localai.automation.pipeline

import android.util.Log
import com.localai.automation.engine.CooldownManager
import com.localai.automation.models.AgentEvent
import com.localai.automation.models.EventType
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import java.util.concurrent.ConcurrentLinkedDeque

/**
 * Upgraded Event Pipeline:
 * - Backpressure via extraBufferCapacity + DROP strategy for burst events
 * - Per-event-type throttling via CooldownManager
 * - Priority-aware emission (critical events bypass throttle)
 * - Deduplication within configurable window
 * - Ring buffer of recent events for context enrichment
 */
class EventPipeline {

    companion object {
        private const val TAG = "EventPipeline"
        private const val DEDUP_WINDOW_MS = 500L
        private const val RING_BUFFER_SIZE = 500
        private const val BUFFER_CAPACITY = 128  // extraBufferCapacity

        // Events that are always high-priority and bypass throttle
        private val CRITICAL_EVENT_TYPES = setOf(
            EventType.BATTERY_LOW,
            EventType.ENTERED_ZONE,
            EventType.EXITED_ZONE,
            EventType.SYSTEM_BOOT
        )

        // Per-type throttle window (ms) — low-priority bursts are throttled
        private val TYPE_THROTTLE_MS = mapOf(
            EventType.NOTIFICATION_RECEIVED to 2_000L,
            EventType.CHARGING_STARTED      to 5_000L,
            EventType.CHARGING_STOPPED      to 5_000L,
            EventType.APP_OPENED            to 1_000L,
            EventType.APP_CLOSED            to 1_000L
        )

        private val _instance by lazy { EventPipeline() }
        fun get() = _instance
    }

    private val _events = MutableSharedFlow<AgentEvent>(
        replay = 0,
        extraBufferCapacity = BUFFER_CAPACITY
    )
    val events: SharedFlow<AgentEvent> = _events.asSharedFlow()

    // Deduplication: key → last emission timestamp
    private val lastEmitted = mutableMapOf<String, Long>()

    // Per-type last emission for throttle (separate from dedup)
    private val typeThrottle = mutableMapOf<EventType, Long>()

    // Ring buffer for context enrichment
    private val recentEvents = ConcurrentLinkedDeque<AgentEvent>()

    // ─── Emit ─────────────────────────────────────────────────────────────────

    suspend fun emit(event: AgentEvent) {
        if (!shouldEmit(event)) return
        commitEmit(event)
        _events.emit(event)
    }

    /** Non-suspending emit for broadcast receivers — drops silently if buffer full. */
    fun emitBlocking(event: AgentEvent) {
        if (!shouldEmit(event)) return
        commitEmit(event)
        val emitted = _events.tryEmit(event)
        if (!emitted) Log.w(TAG, "Event dropped (buffer full): ${event.eventType}")
    }

    // ─── Filtering ────────────────────────────────────────────────────────────

    private fun shouldEmit(event: AgentEvent): Boolean {
        val now = System.currentTimeMillis()
        val isCritical = event.eventType in CRITICAL_EVENT_TYPES

        // 1. Deduplication (always applies, including critical)
        val dedupKey = dedupKey(event)
        val lastDup = lastEmitted[dedupKey]
        if (lastDup != null && (now - lastDup) < DEDUP_WINDOW_MS) {
            Log.d(TAG, "Dedup suppressed: ${event.eventType}")
            return false
        }

        // 2. Per-type throttle (skipped for critical events)
        if (!isCritical) {
            val throttleMs = TYPE_THROTTLE_MS[event.eventType]
            if (throttleMs != null) {
                val lastThrottle = typeThrottle[event.eventType]
                if (lastThrottle != null && (now - lastThrottle) < throttleMs) {
                    Log.d(TAG, "Throttled: ${event.eventType} (${(throttleMs - (now - lastThrottle))}ms remaining)")
                    return false
                }
            }

            // 3. Burst rate limit via CooldownManager
            if (!CooldownManager.get().shouldProcessEvent(
                    event.module.name, event.eventType.name, maxPerWindow = 8, windowMs = 15_000L)) {
                return false
            }
        }

        return true
    }

    private fun commitEmit(event: AgentEvent) {
        val now = System.currentTimeMillis()
        lastEmitted[dedupKey(event)] = now
        typeThrottle[event.eventType] = now

        if (recentEvents.size >= RING_BUFFER_SIZE) recentEvents.pollFirst()
        recentEvents.addLast(event)

        Log.i(TAG, "Emitting: ${event.module}/${event.eventType}")
    }

    // ─── Context queries ──────────────────────────────────────────────────────

    fun getRecentEvents(limit: Int = 20): List<AgentEvent> =
        recentEvents.toList().takeLast(limit.coerceAtMost(recentEvents.size))

    fun getRecentEventsByType(type: EventType, limit: Int = 5): List<AgentEvent> =
        recentEvents.filter { it.eventType == type }.takeLast(limit)

    fun getQueueDepth(): Int = recentEvents.size

    private fun dedupKey(event: AgentEvent): String =
        "${event.module}:${event.eventType}:${event.data.entries
            .sortedBy { it.key }.joinToString(",") { "${it.key}=${it.value}" }}"

    fun clearDedup() { lastEmitted.clear(); typeThrottle.clear() }
}
