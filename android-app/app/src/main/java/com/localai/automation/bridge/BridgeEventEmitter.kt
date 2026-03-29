package com.localai.automation.bridge

import android.util.Log
import com.localai.automation.models.AgentEvent
import com.localai.automation.models.EventType

/**
 * Sits between the EventPipeline and the WebSocket bridge.
 * When a device event fires, this class forwards it to the AI
 * so the AI can react in real-time.
 *
 * Not all events need to go to AI — only the high-signal ones.
 */
class BridgeEventEmitter(private val bridge: WebSocketBridge) {

    companion object {
        private const val TAG = "BridgeEventEmitter"

        /** Events forwarded to the AI bridge */
        private val FORWARDED_EVENTS = setOf(
            EventType.BATTERY_LOW,
            EventType.CHARGING_STARTED,
            EventType.CHARGING_STOPPED,
            EventType.ENTERED_ZONE,
            EventType.EXITED_ZONE,
            EventType.NOTIFICATION_RECEIVED,
        )
    }

    fun emit(event: AgentEvent) {
        if (!bridge.isConnected()) return
        if (event.eventType !in FORWARDED_EVENTS) return

        Log.d(TAG, "Forwarding to bridge: ${event.eventType}")

        // Build a clean flat payload (avoid nesting issues with Gson)
        val payload = buildMap<String, Any> {
            put("eventType", event.eventType.name)
            put("module",    event.module.name)
            put("timestamp", event.timestamp)
            event.data.forEach { (k, v) ->
                // Only include serialisable primitives
                if (v is String || v is Number || v is Boolean) {
                    put(k, v)
                }
            }
        }

        bridge.send(BridgeMessage.event(event.eventType.name, payload))
    }
}
