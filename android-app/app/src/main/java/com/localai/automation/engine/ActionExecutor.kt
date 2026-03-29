package com.localai.automation.engine

import android.app.NotificationManager
import android.media.AudioManager
import android.content.Context
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import com.localai.automation.LocalAIApp
import com.localai.automation.R
import com.localai.automation.data.repository.LocalRepository
import com.localai.automation.models.*

data class ExecutionResult(
    val actionId: Long,
    val success: Boolean,
    val message: String,
    val skipped: Boolean = false
)

/**
 * ActionExecutor:
 * - Routes every action through ExecutionGuard first
 * - Idempotent: skips if system already in desired state
 * - Commits guard state after successful execution
 * - Stores triggerReason so the UI can explain "why did this fire"
 * - Full result logging via ObservabilityLogger
 */
class ActionExecutor(
    private val context: Context,
    private val repository: LocalRepository
) {
    companion object { private const val TAG = "ActionExecutor" }

    private val guard = ExecutionGuard(context)

    /**
     * @param action The action to execute.
     * @param triggerReason Human-readable explanation of what caused this action
     *   (e.g. "Battery dropped low (battery module)"). Stored in the database and
     *   shown in the Dashboard Actions tab.
     */
    suspend fun execute(action: AgentAction, triggerReason: String? = null): ExecutionResult {
        Log.i(TAG, "Evaluating: ${action.actionType} params=${action.params}")

        // Gate: ExecutionGuard must approve
        when (val guardResult = guard.evaluate(action)) {
            is GuardResult.Deny -> {
                ObservabilityLogger.actionDenied(action, guardResult.reason)
                val id = repository.insertAction(action, triggerReason)
                repository.updateActionResult(id, "DENIED", guardResult.reason)
                return ExecutionResult(id, false, guardResult.reason)
            }
            is GuardResult.Skip -> {
                ObservabilityLogger.actionSkipped(action, guardResult.reason)
                val id = repository.insertAction(action, triggerReason)
                repository.updateActionResult(id, "SKIPPED", guardResult.reason)
                return ExecutionResult(id, true, guardResult.reason, skipped = true)
            }
            is GuardResult.Allow -> { /* proceed */ }
        }

        ObservabilityLogger.actionAllowed(action)
        val actionId = repository.insertAction(action, triggerReason)

        return try {
            val result = when (action.actionType) {
                ActionType.SET_SILENT_MODE   -> executeSilentMode(actionId, action)
                ActionType.SET_VIBRATION     -> executeVibration(actionId, action)
                ActionType.SET_BRIGHTNESS    -> executeBrightness(actionId, action)
                ActionType.SEND_NOTIFICATION -> executeNotification(actionId, action, triggerReason)
                ActionType.LOG_ONLY          -> executeLogOnly(actionId, action)
            }

            if (result.success) guard.commit(action)

            ObservabilityLogger.actionExecuted(action, result.success, result.message)
            result
        } catch (e: Exception) {
            Log.e(TAG, "Execution failed for ${action.actionType}", e)
            repository.updateActionResult(actionId, "FAILED", e.message)
            ObservabilityLogger.actionExecuted(action, false, e.message ?: "Unknown error")
            ExecutionResult(actionId, false, e.message ?: "Unknown error")
        }
    }

    private suspend fun executeSilentMode(id: Long, action: AgentAction): ExecutionResult {
        val nm = context.getSystemService(NotificationManager::class.java)
        if (!nm.isNotificationPolicyAccessGranted) {
            repository.updateActionResult(id, "PERMISSION_DENIED", "DND policy not granted")
            return ExecutionResult(id, false, "DND policy access not granted")
        }
        val modeStr = action.getStringParam("mode")?.uppercase() ?: "SILENT"
        val audio = context.getSystemService(AudioManager::class.java)
        audio.ringerMode = when (modeStr) {
            "SILENT"  -> AudioManager.RINGER_MODE_SILENT
            "VIBRATE" -> AudioManager.RINGER_MODE_VIBRATE
            else      -> AudioManager.RINGER_MODE_NORMAL
        }
        repository.updateActionResult(id, "SUCCESS")
        return ExecutionResult(id, true, "Ringer set to $modeStr")
    }

    private suspend fun executeVibration(id: Long, action: AgentAction): ExecutionResult {
        val level = action.getIntParam("level") ?: 1
        val audio = context.getSystemService(AudioManager::class.java)
        audio.ringerMode = if (level == 0) AudioManager.RINGER_MODE_SILENT
                           else AudioManager.RINGER_MODE_VIBRATE
        repository.updateActionResult(id, "SUCCESS")
        return ExecutionResult(id, true, "Vibration level=$level applied")
    }

    private suspend fun executeBrightness(id: Long, action: AgentAction): ExecutionResult {
        if (!Settings.System.canWrite(context)) {
            repository.updateActionResult(id, "PERMISSION_DENIED", "WRITE_SETTINGS not granted")
            return ExecutionResult(id, false, "WRITE_SETTINGS not granted")
        }
        val auto = action.getBoolParam("auto") ?: false
        Settings.System.putInt(
            context.contentResolver,
            Settings.System.SCREEN_BRIGHTNESS_MODE,
            if (auto) Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC
            else Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL
        )
        if (!auto) {
            val level = action.getIntParam("level")?.coerceIn(0, 255) ?: 128
            Settings.System.putInt(context.contentResolver, Settings.System.SCREEN_BRIGHTNESS, level)
        }
        val msg = "Brightness set to ${if (auto) "auto" else action.getIntParam("level")}"
        repository.updateActionResult(id, "SUCCESS")
        return ExecutionResult(id, true, msg)
    }

    private suspend fun executeNotification(
        id: Long,
        action: AgentAction,
        triggerReason: String?
    ): ExecutionResult {
        val title   = action.getStringParam("title") ?: "Agent Action"
        val baseText = action.getStringParam("text") ?: ""
        // Append trigger reason to notification body for transparency
        val text = if (!triggerReason.isNullOrBlank()) "$baseText\n↳ $triggerReason"
                   else baseText
        val nm = context.getSystemService(NotificationManager::class.java)
        val notif = androidx.core.app.NotificationCompat.Builder(context, LocalAIApp.CHANNEL_ID_ALERTS)
            .setSmallIcon(R.drawable.ic_agent)
            .setContentTitle(title)
            .setContentText(baseText)
            .setStyle(androidx.core.app.NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(androidx.core.app.NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .build()
        nm.notify(System.currentTimeMillis().toInt(), notif)
        repository.updateActionResult(id, "SUCCESS")
        return ExecutionResult(id, true, "Notification sent: $title")
    }

    private suspend fun executeLogOnly(id: Long, action: AgentAction): ExecutionResult {
        val msg = action.getStringParam("message") ?: "Rule triggered"
        Log.i(TAG, "LOG_ONLY: $msg")
        repository.updateActionResult(id, "SUCCESS")
        return ExecutionResult(id, true, msg)
    }
}