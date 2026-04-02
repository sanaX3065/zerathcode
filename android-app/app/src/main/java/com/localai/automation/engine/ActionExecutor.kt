package com.localai.automation.engine

import android.app.NotificationManager
import android.media.AudioManager
import android.content.Context
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import com.localai.automation.LocalAIApp
import com.localai.automation.R
import com.localai.automation.actions.*
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

    // Phase 2 Action Handlers
    private val calendarAction = CalendarAction(context)
    private val alarmAction    = AlarmAction(context)
    private val connectivity   = ConnectivityAction(context)
    private val appAction      = AppAction(context)

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
            val res: ActionResult = when (action.actionType) {
                // Phase 1
                ActionType.SET_SILENT_MODE   -> wrapLegacy(executeSilentMode(actionId, action))
                ActionType.SET_VIBRATION     -> wrapLegacy(executeVibration(actionId, action))
                ActionType.SET_BRIGHTNESS    -> wrapLegacy(executeBrightness(actionId, action))
                ActionType.SEND_NOTIFICATION -> wrapLegacy(executeNotification(actionId, action, triggerReason))
                ActionType.LOG_ONLY          -> wrapLegacy(executeLogOnly(actionId, action))

                // Phase 2 - Calendar
                ActionType.CREATE_CALENDAR_EVENT -> calendarAction.createEvent(action)
                ActionType.DELETE_CALENDAR_EVENT -> calendarAction.deleteEvent(action)
                ActionType.QUERY_CALENDAR        -> calendarAction.queryEvents(action)

                // Phase 2 - Alarms
                ActionType.SET_ALARM     -> alarmAction.setAlarm(action)
                ActionType.DISMISS_ALARM -> alarmAction.dismissAlarm(action)

                // Phase 2 - Connectivity
                ActionType.SET_WIFI      -> connectivity.setWifi(action)
                ActionType.SET_BLUETOOTH -> connectivity.setBluetooth(action)
                ActionType.SET_DND_MODE  -> connectivity.setDndMode(action)

                // Phase 2 - Apps & SMS
                ActionType.LAUNCH_APP -> appAction.launchApp(action)
                ActionType.SEND_SMS   -> appAction.sendSms(action)
            }

            // Convert ActionResult to ExecutionResult and update DB
            val execResult = ExecutionResult(actionId, res.success, res.message)
            repository.updateActionResult(actionId, if (res.success) "SUCCESS" else "FAILED", res.message)

            if (execResult.success) guard.commit(action)

            ObservabilityLogger.actionExecuted(action, execResult.success, execResult.message)
            execResult
        } catch (e: Exception) {
            Log.e(TAG, "Execution failed for ${action.actionType}", e)
            repository.updateActionResult(actionId, "FAILED", e.message)
            ObservabilityLogger.actionExecuted(action, false, e.message ?: "Unknown error")
            ExecutionResult(actionId, false, e.message ?: "Unknown error")
        }
    }

    private fun wrapLegacy(legacy: ExecutionResult): ActionResult {
        return if (legacy.success) ActionResult.success(legacy.message)
        else ActionResult.failure(legacy.message)
    }

    private suspend fun executeSilentMode(id: Long, action: AgentAction): ExecutionResult {
        val nm = context.getSystemService(NotificationManager::class.java)
        if (!nm.isNotificationPolicyAccessGranted) {
            return ExecutionResult(id, false, "DND policy access not granted")
        }
        val modeStr = action.getStringParam("mode")?.uppercase() ?: "SILENT"
        val audio = context.getSystemService(AudioManager::class.java)
        audio.ringerMode = when (modeStr) {
            "SILENT"  -> AudioManager.RINGER_MODE_SILENT
            "VIBRATE" -> AudioManager.RINGER_MODE_VIBRATE
            else      -> AudioManager.RINGER_MODE_NORMAL
        }
        return ExecutionResult(id, true, "Ringer set to $modeStr")
    }

    private suspend fun executeVibration(id: Long, action: AgentAction): ExecutionResult {
        val level = action.getIntParam("level") ?: 1
        val audio = context.getSystemService(AudioManager::class.java)
        audio.ringerMode = if (level == 0) AudioManager.RINGER_MODE_SILENT
                           else AudioManager.RINGER_MODE_VIBRATE
        return ExecutionResult(id, true, "Vibration level=$level applied")
    }

    private suspend fun executeBrightness(id: Long, action: AgentAction): ExecutionResult {
        if (!Settings.System.canWrite(context)) {
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
        return ExecutionResult(id, true, "Notification sent: $title")
    }

    private suspend fun executeLogOnly(id: Long, action: AgentAction): ExecutionResult {
        val msg = action.getStringParam("message") ?: "Rule triggered"
        Log.i(TAG, "LOG_ONLY: $msg")
        return ExecutionResult(id, true, msg)
    }
}