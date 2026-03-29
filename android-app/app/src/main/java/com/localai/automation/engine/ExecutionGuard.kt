package com.localai.automation.engine

import android.app.NotificationManager
import android.content.Context
import android.provider.Settings
import android.util.Log
import com.localai.automation.models.ActionType
import com.localai.automation.models.AgentAction

sealed class GuardResult {
    object Allow : GuardResult()
    data class Deny(val reason: String) : GuardResult()
    data class Skip(val reason: String) : GuardResult()  // Already satisfied — not an error
}

/**
 * Gates every action before execution.
 * Checks:
 *  1. Cooldown (via CooldownManager)
 *  2. Permissions (runtime check)
 *  3. Idempotency (via StateTracker — already in desired state)
 *  4. Oscillation detection (state changed too recently)
 */
class ExecutionGuard(private val context: Context) {

    companion object {
        private const val TAG = "ExecutionGuard"
    }

    private val cooldowns = CooldownManager.get()
    private val stateTracker = StateTracker.init(context)

    fun evaluate(action: AgentAction): GuardResult {
        // 1. Action-type cooldown
        if (!cooldowns.isActionAllowed(action.actionType.name)) {
            return GuardResult.Deny("Action ${action.actionType} is on cooldown")
        }

        // 2. Rule cooldown
        action.sourceRuleId?.let { ruleId ->
            if (!cooldowns.isRuleAllowed(ruleId)) {
                return GuardResult.Deny("Rule $ruleId is on cooldown")
            }
        }

        // 3. Permission check
        val permResult = checkPermissions(action)
        if (permResult != null) return GuardResult.Deny(permResult)

        // 4. Idempotency — is system already in desired state?
        stateTracker.syncFromSystem()
        if (stateTracker.isAlreadySatisfied(action.actionType, action.params)) {
            Log.d(TAG, "Action ${action.actionType} skipped — already satisfied")
            return GuardResult.Skip("System is already in the desired state for ${action.actionType}")
        }

        // 5. Oscillation guard for audio actions
        val oscillationKey = oscillationKey(action) ?: return GuardResult.Allow
        if (stateTracker.isOscillating(oscillationKey, windowMs = 4_000)) {
            return GuardResult.Deny("Oscillation detected for $oscillationKey — suppressing action")
        }

        return GuardResult.Allow
    }

    /** Called after successful execution to commit cooldowns. */
    fun commit(action: AgentAction) {
        cooldowns.markActionExecuted(action.actionType.name)
        action.sourceRuleId?.let { cooldowns.markRuleTriggered(it) }

        // Update state tracker after execution
        when (action.actionType) {
            ActionType.SET_SILENT_MODE -> {
                val mode = action.getStringParam("mode")?.uppercase() ?: "SILENT"
                stateTracker.update(StateTracker.Keys.AUDIO_MODE, mode)
            }
            ActionType.SET_VIBRATION -> {
                val level = action.getIntParam("level") ?: 1
                stateTracker.update(StateTracker.Keys.AUDIO_MODE, if (level == 0) "SILENT" else "VIBRATE")
            }
            ActionType.SET_BRIGHTNESS -> {
                val auto = action.getBoolParam("auto") ?: false
                stateTracker.update(StateTracker.Keys.BRIGHTNESS_AUTO, auto.toString())
                if (!auto) {
                    val level = action.getIntParam("level") ?: 128
                    stateTracker.update(StateTracker.Keys.BRIGHTNESS, level.toString())
                }
            }
            else -> {}
        }
    }

    // ─── Permission Checks ────────────────────────────────────────────────────

    private fun checkPermissions(action: AgentAction): String? {
        return when (action.actionType) {
            ActionType.SET_SILENT_MODE, ActionType.SET_VIBRATION -> {
                val nm = context.getSystemService(NotificationManager::class.java)
                if (!nm.isNotificationPolicyAccessGranted) {
                    "Do Not Disturb policy access not granted. Go to Permissions tab to enable."
                } else null
            }
            ActionType.SET_BRIGHTNESS -> {
                if (!Settings.System.canWrite(context)) {
                    "WRITE_SETTINGS permission not granted. Go to Permissions tab to enable."
                } else null
            }
            ActionType.SEND_NOTIFICATION -> null  // Uses POST_NOTIFICATIONS which is declared in manifest
            ActionType.LOG_ONLY -> null
        }
    }

    private fun oscillationKey(action: AgentAction): String? = when (action.actionType) {
        ActionType.SET_SILENT_MODE, ActionType.SET_VIBRATION -> StateTracker.Keys.AUDIO_MODE
        ActionType.SET_BRIGHTNESS -> StateTracker.Keys.BRIGHTNESS
        else -> null
    }
}
