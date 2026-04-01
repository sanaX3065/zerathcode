package com.localai.automation.actions

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import com.localai.automation.R

/**
 * AlarmReceiver
 *
 * Handles alarms triggered by AlarmManager (silent alarm path).
 * Called when system fires the alarm.
 */
class AlarmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent?) {
        if (intent == null) return

        val label = intent.getStringExtra("label") ?: "Alarm"
        val hour = intent.getIntExtra("hour", -1)
        val minute = intent.getIntExtra("minute", -1)

        Log.i(TAG, "Alarm fired: $label at $hour:${minute.toString().padStart(2, '0')}")

        // Show notification
        showNotification(context, label, hour, minute)

        // TODO: Emit event to pipeline for rule reactions
        // eventEmitter?.emit("alarm_fired", { label, hour, minute })
    }

    private fun showNotification(context: Context, label: String, hour: Int, minute: Int) {
        try {
            val notificationManager =
                context.getSystemService(NotificationManager::class.java)

            // Create notification channel (required on API 26+)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val channel = NotificationChannel(
                    CHANNEL_ID,
                    "Alarms",
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = "ZerathCode alarm notifications"
                    enableVibration(true)
                }
                notificationManager?.createNotificationChannel(channel)
            }

            val timeStr = "$hour:${minute.toString().padStart(2, '0')}"
            val notification = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_launcher_foreground)
                .setContentTitle("ZerathCode Alarm")
                .setContentText("$label at $timeStr")
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .build()

            notificationManager?.notify(NOTIFICATION_ID, notification)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to show alarm notification: ${e.message}")
        }
    }

    companion object {
        private const val TAG = "AlarmReceiver"
        private const val CHANNEL_ID = "zerathcode_alarms"
        private const val NOTIFICATION_ID = 9001
    }
}
