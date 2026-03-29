package com.localai.automation.modules

import android.content.ComponentName
import android.content.Context
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import com.localai.automation.models.AgentModule

// ─── Module state manager ─────────────────────────────────────────────────────

class NotificationModule : AgentModuleInterface {

    override val moduleType = AgentModule.NOTIFICATION
    override val requiredPermissions = listOf("android.permission.BIND_NOTIFICATION_LISTENER_SERVICE")

    private var state = ModuleState(AgentModule.NOTIFICATION, ModuleStatus.STOPPED)

    override fun start(context: Context) {
        state = if (hasRequiredPermissions(context)) {
            ModuleState(AgentModule.NOTIFICATION, ModuleStatus.RUNNING,
                "Listening via NotificationBridge")
        } else {
            ModuleState(AgentModule.NOTIFICATION, ModuleStatus.PERMISSION_DENIED,
                "Enable notification listener in Permissions tab")
        }
    }

    override fun stop() {
        state = ModuleState(AgentModule.NOTIFICATION, ModuleStatus.STOPPED)
    }

    override fun getState() = state

    override fun hasRequiredPermissions(context: Context) =
        isNotificationListenerEnabled(context)

    fun recordEvent() {
        state = state.copy(lastEventTime = System.currentTimeMillis())
    }

    companion object {
        fun isNotificationListenerEnabled(context: Context): Boolean {
            val cn = ComponentName(context, AgentNotificationListener::class.java)
            val flat = Settings.Secure.getString(
                context.contentResolver, "enabled_notification_listeners")
            return flat != null && flat.contains(cn.flattenToString())
        }
    }
}

// ─── Packages to filter ────────────────────────────────────────────────────────

private val LOW_VALUE_PACKAGES = setOf(
    "com.android.systemui", "com.android.packageinstaller",
    "com.google.android.gms", "android"
)

// ─── NotificationListenerService (independent process context) ────────────────
//
// IMPORTANT: This service runs in its own lifecycle, independent of AgentRuntimeService.
// It does NOT hold a reference to the runtime or its components.
// All events are forwarded through NotificationBridge (local broadcast IPC).

class AgentNotificationListener : NotificationListenerService() {

    companion object {
        private const val TAG = "NotificationListener"
        var isConnected = false
            private set
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        isConnected = true
        Log.d(TAG, "Connected")
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        isConnected = false
        Log.d(TAG, "Disconnected")
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName in LOW_VALUE_PACKAGES) return
        if (sbn.isOngoing) return

        val extras = sbn.notification?.extras ?: return
        val title   = extras.getCharSequence("android.title")?.toString() ?: ""
        val text    = extras.getCharSequence("android.text")?.toString() ?: ""
        val bigText = extras.getCharSequence("android.bigText")?.toString() ?: ""

        if (title.isBlank() && text.isBlank()) return

        // Forward via bridge — no direct coupling to runtime service
        NotificationBridge.publish(
            context = applicationContext,
            pkg = sbn.packageName,
            title = title,
            text = bigText.ifBlank { text },
            id = sbn.id,
            postTime = sbn.postTime
        )
    }
}
