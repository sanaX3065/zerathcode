package com.localai.automation

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build

class LocalAIApp : Application() {

    companion object {
        const val CHANNEL_ID_RUNTIME = "agent_runtime_channel"
        const val CHANNEL_ID_ALERTS = "agent_alerts_channel"
        lateinit var instance: LocalAIApp
            private set
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        createNotificationChannels()
    }

    private fun createNotificationChannels() {
        val runtimeChannel = NotificationChannel(
            CHANNEL_ID_RUNTIME,
            "Agent Runtime",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Foreground service notification for Local AI Agent Runtime"
            setShowBadge(false)
        }

        val alertsChannel = NotificationChannel(
            CHANNEL_ID_ALERTS,
            "Agent Alerts",
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = "Notifications for important automation actions"
        }

        val notificationManager = getSystemService(NotificationManager::class.java)
        notificationManager.createNotificationChannel(runtimeChannel)
        notificationManager.createNotificationChannel(alertsChannel)
    }
}
