package com.localai.automation.bridge

import android.content.Context
import android.media.AudioManager
import android.provider.Settings
import android.util.Log
import com.localai.automation.actions.Phase2ActionExecutor
import com.localai.automation.data.repository.LocalRepository
import com.localai.automation.models.ActionType
import com.localai.automation.models.AgentAction
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * BridgeActionExecutor — Phase 2 update
 *
 * Now uses Phase2ActionExecutor which handles all action types
 * including calendar, alarms, WiFi, Bluetooth, DND, SMS, apps.
 *
 * The QUERY_CALENDAR action returns structured data in the ack payload
 * so the AI can read calendar contents.
 */
class BridgeActionExecutor(
    private val context: Context,
    private val repository: LocalRepository,
    private val bridge: WebSocketBridge
) {
    companion object {
        private const val TAG = "BridgeActionExecutor"
    }

    // Phase 2: handles all action types
    private val executor = Phase2ActionExecutor(context, repository)
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
                val result = executor.execute(action, triggerReason = "AI bridge command")
                bridge.send(BridgeMessage.ack(message.id, result.toAckPayload(action.actionType.name)))
                Log.i(TAG, "Action ${action.actionType}: ${result.message}")
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
                "calendar" -> {
                    // Convenience: query next 7 days without a full action
                    val now = System.currentTimeMillis()
                    val fakeAction = AgentAction(
                        actionType = ActionType.QUERY_CALENDAR,
                        params = mapOf(
                            "startMs" to now,
                            "endMs"   to now + 7 * 24 * 60 * 60 * 1000L,
                            "maxResults" to 20
                        )
                    )
                    val result = executor.execute(fakeAction)
                    bridge.send(BridgeMessage.ack(message.id, result.toAckPayload("QUERY_CALENDAR")))
                }
                else -> bridge.send(
                    BridgeMessage.error(message.id, "Unknown query: ${message.payload["query"]}")
                )
            }
        }
    }

    // ── Handshake ─────────────────────────────────────────────────────────────

    private fun handleHandshake(message: BridgeMessage) {
        Log.i(TAG, "Bridge handshake from: ${message.payload["server"]}")
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
            val audio = context.getSystemService(AudioManager::class.java)
            val ringerMode = when (audio.ringerMode) {
                AudioManager.RINGER_MODE_SILENT  -> "SILENT"
                AudioManager.RINGER_MODE_VIBRATE -> "VIBRATE"
                else                              -> "NORMAL"
            }
            val brightness = Settings.System.getInt(
                context.contentResolver, Settings.System.SCREEN_BRIGHTNESS, 128)
            val brightnessAuto = Settings.System.getInt(
                context.contentResolver, Settings.System.SCREEN_BRIGHTNESS_MODE, 0) == 1
            val batteryMgr   = context.getSystemService(android.os.BatteryManager::class.java)
            val batteryLevel = batteryMgr.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY)
            val isCharging   = batteryMgr.isCharging
            val notifMgr     = context.getSystemService(android.app.NotificationManager::class.java)

            mapOf(
                "ringerMode"           to ringerMode,
                "brightness"           to brightness,
                "brightnessAuto"       to brightnessAuto,
                "batteryLevel"         to batteryLevel,
                "isCharging"           to isCharging,
                "dndPolicyGranted"     to notifMgr.isNotificationPolicyAccessGranted,
                "writeSettingsGranted" to Settings.System.canWrite(context),
                "calendarGranted"      to hasPermission("android.permission.READ_CALENDAR"),
                "smsGranted"           to hasPermission("android.permission.SEND_SMS"),
                "timestamp"            to System.currentTimeMillis()
            )
        } catch (e: Exception) {
            mapOf("error" to "Failed to read device state", "timestamp" to System.currentTimeMillis())
        }
    }

    private fun hasPermission(permission: String): Boolean {
        return androidx.core.content.ContextCompat.checkSelfPermission(
            context, permission
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
    }
}
