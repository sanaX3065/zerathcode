package com.localai.automation.actions

/**
 * Unified result returned by all Phase 2 action handlers.
 * Maps cleanly to the bridge ACK/ERROR protocol.
 */
data class ActionResult(
    val success: Boolean,
    val message: String,
    val data: Map<String, Any> = emptyMap()
) {
    companion object {
        fun success(message: String, data: Map<String, Any> = emptyMap()) =
            ActionResult(success = true, message = message, data = data)

        fun failure(message: String) =
            ActionResult(success = false, message = message)
    }

    /** Convert to bridge ack payload map */
    fun toAckPayload(actionType: String): Map<String, Any> = buildMap {
        put("success",    success)
        put("message",    message)
        put("actionType", actionType)
        put("skipped",    false)
        if (data.isNotEmpty()) put("data", data)
    }
}
