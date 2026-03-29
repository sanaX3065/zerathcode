package com.localai.automation.bridge

import android.content.Context
import android.media.AudioManager
import android.provider.Settings
import android.util.Log
import com.localai.automation.data.repository.LocalRepository
import com.localai.automation.engine.ActionExecutor
import com.localai.automation.models.ActionType
import com.localai.automation.models.AgentAction
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Handles ACTION and QUERY messages received from the AI bridge.
 * Converts the bridge message into an AgentAction and hands off to ActionExecutor.
 * Sends ACK or ERROR back through the bridge when done.
 */
class BridgeActionExecutor(
    private val context: Context,
    private val repository: LocalRepository,
    private val bridge: WebSocketBridge
) {
    companion object {
        private const val TAG = "BridgeActionExecutor"
    }

    private val executor = ActionExecutor(context, repository)
    private val scope    = CoroutineScope(Dispatchers.IO)

    // ── Entry point ───────────────────────────────────────────────────────────

    fun handle(message: BridgeMessage) {
        when (message.type) {
            MessageType.ACTION    -> executeAction(message)
            MessageType.QUERY     -> handleQuery(message)
            MessageType.HANDSHAKE -> handleHandshake(message)
            else -> Log.d(TAG, "No handler for message type: ${message.type}")
        }
    }

    // ── Action execution ──────────────────────────────────────────────────────

    private fun executeAction(message: BridgeMessage) {
        scope.launch {
            val action = parseAction(message.payload)

            if (action == null) {
                Log.w(TAG, "Could not parse action from payload: ${message.payload}")
                bridge.send(BridgeMessage.error(message.id, "Invalid action payload"))
                return@launch
            }

            Log.i(TAG, "Executing bridge action: ${action.actionType}")

            try {
                val result = executor.execute(
                    action,
                    triggerReason = "AI bridge command"
                )

                val ackPayload = mapOf(
                    "success"    to result.success,
                    "message"    to result.message,
                    "skipped"    to result.skipped,
                    "actionType" to action.actionType.name
                )

                bridge.send(BridgeMessage.ack(message.id, ackPayload))
                Log.i(TAG, "Action ${action.actionType} completed: ${result.message}")

            } catch (e: Exception) {
                Log.e(TAG, "Action execution threw: ${e.message}", e)
                bridge.send(BridgeMessage.error(message.id, e.message ?: "Execution failed"))
            }
        }
    }

    // ── Query handling ────────────────────────────────────────────────────────

    private fun handleQuery(message: BridgeMessage) {
        scope.launch {
            when (message.payload["query"]?.toString()) {
                "state_snapshot" -> {
                    val state = buildStateSnapshot()
                    bridge.send(
                        BridgeMessage.stateSnapshot(
                            replyToId = message.id,
                            state     = state
                        )
                    )
                }
                else -> bridge.send(
                    BridgeMessage.error(message.id, "Unknown query: ${message.payload["query"]}")
                )
            }
        }
    }

    // ── Handshake ─────────────────────────────────────────────────────────────

    private fun handleHandshake(message: BridgeMessage) {
        Log.i(TAG, "Bridge handshake received. Server: ${message.payload["server"]}")
        // Immediately push current state so AI has context
        scope.launch {
            val state = buildStateSnapshot()
            bridge.send(BridgeMessage.stateSnapshot(state = state))
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun parseAction(payload: Map<String, Any>): AgentAction? {
        return try {
            val typeName = payload["actionType"]?.toString()
                ?: return null

            val actionType = ActionType.valueOf(typeName)

            @Suppress("UNCHECKED_CAST")
            val params = (payload["params"] as? Map<String, Any>) ?: emptyMap()

            val priority = (payload["priority"] as? Double)?.toFloat() ?: 0.8f

            AgentAction(
                actionType = actionType,
                params     = params,
                priority   = priority
            )
        } catch (e: IllegalArgumentException) {
            Log.e(TAG, "Unknown action type in payload: ${payload["actionType"]}")
            null
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse action: ${e.message}")
            null
        }
    }

    fun buildStateSnapshot(): Map<String, Any> {
        return try {
            // Ringer mode
            val audio = context.getSystemService(AudioManager::class.java)
            val ringerMode = when (audio.ringerMode) {
                AudioManager.RINGER_MODE_SILENT  -> "SILENT"
                AudioManager.RINGER_MODE_VIBRATE -> "VIBRATE"
                else                              -> "NORMAL"
            }

            // Brightness
            val brightnessMode = Settings.System.getInt(
                context.contentResolver,
                Settings.System.SCREEN_BRIGHTNESS_MODE,
                Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL
            )
            val brightness = Settings.System.getInt(
                context.contentResolver,
                Settings.System.SCREEN_BRIGHTNESS,
                128
            )
            val brightnessAuto = brightnessMode == Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC

            // Battery
            val batteryMgr = context.getSystemService(android.os.BatteryManager::class.java)
            val batteryLevel  = batteryMgr.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY)
            val isCharging    = batteryMgr.isCharging

            // DND
            val notifMgr = context.getSystemService(android.app.NotificationManager::class.java)
            val dndGranted = notifMgr.isNotificationPolicyAccessGranted

            mapOf(
                "ringerMode"       to ringerMode,
                "brightness"       to brightness,
                "brightnessAuto"   to brightnessAuto,
                "batteryLevel"     to batteryLevel,
                "isCharging"       to isCharging,
                "dndPolicyGranted" to dndGranted,
                "writeSettingsGranted" to Settings.System.canWrite(context),
                "timestamp"        to System.currentTimeMillis()
            )
        } catch (e: Exception) {
            Log.e(TAG, "Failed to build state snapshot: ${e.message}")
            mapOf(
                "error"     to "Failed to read device state",
                "timestamp" to System.currentTimeMillis()
            )
        }
    }
}
