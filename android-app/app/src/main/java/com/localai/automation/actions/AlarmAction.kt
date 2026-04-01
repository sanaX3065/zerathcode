package com.localai.automation.actions

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.AlarmClock
import android.util.Log
import com.localai.automation.models.AgentAction
import java.util.Calendar

/**
 * AlarmAction
 *
 * Handles SET_ALARM and DISMISS_ALARM.
 *
 * Two approaches used:
 *  1. ACTION_SET_ALARM intent — shows standard alarm UI, works on all devices.
 *     No special permission needed. Best for user-visible alarms.
 *  2. AlarmManager.setExactAndAllowWhileIdle() — silent background alarm.
 *     Requires SCHEDULE_EXACT_ALARM (API 31+) or SET_ALARM_CLOCK.
 *
 * Param schemas:
 *
 * SET_ALARM:
 *   hour        : Int     — 0-23 (required)
 *   minute      : Int     — 0-59 (required)
 *   label       : String  — optional alarm label shown to user
 *   days        : List<Int> — optional repeat days (Calendar.MONDAY etc)
 *   skipUi      : Boolean — if true, uses AlarmManager silently; default false
 *   vibrate     : Boolean — default true
 *
 * DISMISS_ALARM:
 *   label       : String  — match alarm by label to dismiss (best-effort)
 */
class AlarmAction(private val context: Context) {

    companion object {
        private const val TAG = "AlarmAction"
        // Request code base for PendingIntents — offset avoids collision
        private const val ALARM_REQUEST_BASE = 50000
    }

    // ── SET ALARM ─────────────────────────────────────────────────────────────

    fun setAlarm(action: AgentAction): ActionResult {
        val hour   = action.getIntParam("hour")
            ?: return ActionResult.failure("Missing required param: hour (0-23)")
        val minute = action.getIntParam("minute")
            ?: return ActionResult.failure("Missing required param: minute (0-59)")

        if (hour !in 0..23 || minute !in 0..59) {
            return ActionResult.failure("Invalid time: hour=$hour minute=$minute")
        }

        val label   = action.getStringParam("label") ?: "ZerathCode Alarm"
        val skipUi  = action.getBoolParam("skipUi") ?: false
        val vibrate = action.getBoolParam("vibrate") ?: true

        return if (skipUi) {
            setAlarmSilent(hour, minute, label)
        } else {
            setAlarmViaIntent(hour, minute, label, vibrate, action)
        }
    }

    private fun setAlarmViaIntent(
        hour: Int,
        minute: Int,
        label: String,
        vibrate: Boolean,
        action: AgentAction
    ): ActionResult {
        return try {
            val intent = Intent(AlarmClock.ACTION_SET_ALARM).apply {
                putExtra(AlarmClock.EXTRA_HOUR, hour)
                putExtra(AlarmClock.EXTRA_MINUTES, minute)
                putExtra(AlarmClock.EXTRA_MESSAGE, label)
                putExtra(AlarmClock.EXTRA_VIBRATE, vibrate)
                putExtra(AlarmClock.EXTRA_SKIP_UI, false) // show confirmation
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

                // Repeat days
                @Suppress("UNCHECKED_CAST")
                val days = (action.params["days"] as? List<*>)
                    ?.mapNotNull { (it as? Double)?.toInt() }
                if (!days.isNullOrEmpty()) {
                    putIntegerArrayListExtra(
                        AlarmClock.EXTRA_DAYS,
                        ArrayList(days)
                    )
                }
            }

            if (intent.resolveActivity(context.packageManager) == null) {
                return ActionResult.failure("No clock app found to handle alarm intent")
            }

            context.startActivity(intent)
            Log.i(TAG, "Alarm set via intent: $hour:${minute.toString().padStart(2,'0')} — $label")
            ActionResult.success(
                "Alarm set for ${hour}:${minute.toString().padStart(2,'0')} — $label"
            )
        } catch (e: Exception) {
            ActionResult.failure("Failed to set alarm: ${e.message}")
        }
    }

    private fun setAlarmSilent(hour: Int, minute: Int, label: String): ActionResult {
        return try {
            val alarmManager = context.getSystemService(AlarmManager::class.java)

            // Build trigger time
            val cal = Calendar.getInstance().apply {
                set(Calendar.HOUR_OF_DAY, hour)
                set(Calendar.MINUTE, minute)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
                // If time already passed today, schedule for tomorrow
                if (timeInMillis <= System.currentTimeMillis()) {
                    add(Calendar.DAY_OF_YEAR, 1)
                }
            }

            val requestCode = ALARM_REQUEST_BASE + (hour * 100 + minute)
            val intent = Intent(context, AlarmReceiver::class.java).apply {
                putExtra("label", label)
                putExtra("hour", hour)
                putExtra("minute", minute)
            }
            val pendingIntent = PendingIntent.getBroadcast(
                context, requestCode, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (!alarmManager.canScheduleExactAlarms()) {
                    return ActionResult.failure(
                        "Exact alarm permission not granted. " +
                        "Go to Settings → Apps → Special app access → Alarms & reminders"
                    )
                }
            }

            alarmManager.setAlarmClock(
                AlarmManager.AlarmClockInfo(cal.timeInMillis, pendingIntent),
                pendingIntent
            )

            Log.i(TAG, "Silent alarm set: $hour:${minute.toString().padStart(2,'0')} trigger=${cal.timeInMillis}")
            ActionResult.success(
                "Alarm set (silent) for ${hour}:${minute.toString().padStart(2,'0')} — $label"
            )
        } catch (e: SecurityException) {
            ActionResult.failure("Alarm permission denied: ${e.message}")
        } catch (e: Exception) {
            ActionResult.failure("Failed to set silent alarm: ${e.message}")
        }
    }

    // ── DISMISS ALARM ─────────────────────────────────────────────────────────

    fun dismissAlarm(action: AgentAction): ActionResult {
        val label = action.getStringParam("label")

        return try {
            val intent = Intent(AlarmClock.ACTION_DISMISS_ALARM).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                if (label != null) {
                    putExtra(AlarmClock.EXTRA_MESSAGE, label)
                }
            }

            if (intent.resolveActivity(context.packageManager) == null) {
                return ActionResult.failure("No clock app found to dismiss alarm")
            }

            context.startActivity(intent)
            Log.i(TAG, "Dismiss alarm intent sent${if (label != null) ": $label" else ""}")
            ActionResult.success("Alarm dismiss request sent${if (label != null) ": $label" else ""}")
        } catch (e: Exception) {
            ActionResult.failure("Failed to dismiss alarm: ${e.message}")
        }
    }
}
