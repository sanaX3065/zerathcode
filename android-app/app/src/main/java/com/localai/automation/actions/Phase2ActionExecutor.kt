package com.localai.automation.actions

import android.content.Context
import android.util.Log
import com.localai.automation.data.repository.LocalRepository
import com.localai.automation.engine.ActionExecutor
import com.localai.automation.models.ActionType
import com.localai.automation.models.AgentAction

/**
 * Phase2ActionExecutor
 *
 * Routes Phase 2 action types to their specific handlers.
 * Falls back to Phase 1 ActionExecutor for existing action types.
 *
 * Used by BridgeActionExecutor instead of the Phase 1 ActionExecutor directly.
 */
class Phase2ActionExecutor(
    private val context: Context,
    private val repository: LocalRepository
) {
    companion object {
        private const val TAG = "Phase2ActionExecutor"
    }

    // Phase 1 executor handles existing actions
    private val phase1Executor  = ActionExecutor(context, repository)

    // Phase 2 handlers
    private val calendarAction  = CalendarAction(context)
    private val alarmAction     = AlarmAction(context)
    private val connectAction   = ConnectivityAction(context)
    private val appAction       = AppAction(context)

    /**
     * Execute any action — Phase 2 or Phase 1.
     * Returns an ActionResult for all types.
     */
    suspend fun execute(action: AgentAction, triggerReason: String? = null): ActionResult {
        Log.i(TAG, "Executing: ${action.actionType} params=${action.params}")

        return when (action.actionType) {

            // ── Phase 2: Calendar ─────────────────────────────────────────────
            ActionType.CREATE_CALENDAR_EVENT -> calendarAction.createEvent(action)
            ActionType.DELETE_CALENDAR_EVENT -> calendarAction.deleteEvent(action)
            ActionType.QUERY_CALENDAR        -> calendarAction.queryEvents(action)

            // ── Phase 2: Alarms ───────────────────────────────────────────────
            ActionType.SET_ALARM             -> alarmAction.setAlarm(action)
            ActionType.DISMISS_ALARM         -> alarmAction.dismissAlarm(action)

            // ── Phase 2: Connectivity ─────────────────────────────────────────
            ActionType.SET_WIFI              -> connectAction.setWifi(action)
            ActionType.SET_BLUETOOTH         -> connectAction.setBluetooth(action)
            ActionType.SET_DND_MODE          -> connectAction.setDndMode(action)

            // ── Phase 2: Apps & Messaging ─────────────────────────────────────
            ActionType.LAUNCH_APP            -> appAction.launchApp(action)
            ActionType.SEND_SMS              -> appAction.sendSms(action)

            // ── Phase 1: delegate to existing executor ────────────────────────
            else -> {
                val result = phase1Executor.execute(action, triggerReason)
                // Convert ExecutionResult → ActionResult
                ActionResult(
                    success = result.success,
                    message = result.message
                )
            }
        }
    }

    /**
     * Check if an action type is handled by Phase 2 executor.
     */
    fun isPhase2Action(actionType: ActionType): Boolean {
        return actionType in setOf(
            ActionType.CREATE_CALENDAR_EVENT,
            ActionType.DELETE_CALENDAR_EVENT,
            ActionType.QUERY_CALENDAR,
            ActionType.SET_ALARM,
            ActionType.DISMISS_ALARM,
            ActionType.SET_WIFI,
            ActionType.SET_BLUETOOTH,
            ActionType.SET_DND_MODE,
            ActionType.LAUNCH_APP,
            ActionType.SEND_SMS
        )
    }
}
