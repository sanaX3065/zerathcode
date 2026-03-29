package com.localai.automation.bridge

import com.google.gson.Gson
import com.google.gson.annotations.SerializedName
import com.google.gson.reflect.TypeToken
import java.util.UUID

// ── Message envelope ──────────────────────────────────────────────────────────

data class BridgeMessage(
    val id: String = UUID.randomUUID().toString(),
    val type: String,
    val payload: Map<String, Any> = emptyMap(),
    val timestamp: Long = System.currentTimeMillis()
) {
    fun toJson(): String = gson.toJson(this)

    companion object {
        private val gson = Gson()

        fun fromJson(json: String): BridgeMessage {
            val mapType = object : TypeToken<Map<String, Any>>() {}.type
            val raw: Map<String, Any> = gson.fromJson(json, mapType)

            return BridgeMessage(
                id        = raw["id"]?.toString()        ?: UUID.randomUUID().toString(),
                type      = raw["type"]?.toString()      ?: "unknown",
                payload   = (raw["payload"] as? Map<String, Any>) ?: emptyMap(),
                timestamp = (raw["timestamp"] as? Double)?.toLong() ?: System.currentTimeMillis()
            )
        }

        // ── Pre-built responses ───────────────────────────────────────────────

        fun ack(originalId: String, result: Map<String, Any> = emptyMap()) = BridgeMessage(
            id      = originalId,
            type    = MessageType.ACK,
            payload = result
        )

        fun error(originalId: String, message: String) = BridgeMessage(
            id      = originalId,
            type    = MessageType.ERROR,
            payload = mapOf("message" to message)
        )

        fun event(eventType: String, data: Map<String, Any> = emptyMap()) = BridgeMessage(
            type    = MessageType.EVENT,
            payload = mapOf("eventType" to eventType) + data
        )

        fun stateSnapshot(replyToId: String? = null, state: Map<String, Any>) = BridgeMessage(
            id      = replyToId ?: UUID.randomUUID().toString(),
            type    = MessageType.STATE_SNAPSHOT,
            payload = state
        )

        fun pong(pingId: String) = BridgeMessage(
            id   = pingId,
            type = MessageType.PONG
        )
    }
}

// ── Message type constants ────────────────────────────────────────────────────

object MessageType {
    // Server → Device
    const val ACTION         = "action"
    const val QUERY          = "query"
    const val PING           = "ping"
    const val HANDSHAKE      = "handshake"

    // Device → Server
    const val ACK            = "ack"
    const val ERROR          = "error"
    const val EVENT          = "event"
    const val STATE_SNAPSHOT = "state_snapshot"
    const val PONG           = "pong"
}
