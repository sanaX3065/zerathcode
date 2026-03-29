package com.localai.automation.modules

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.util.Log
import com.localai.automation.models.AgentEvent
import com.localai.automation.models.AgentModule
import com.localai.automation.models.EventType
import com.localai.automation.pipeline.EventPipeline
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Bridge between AgentNotificationListener (which runs in its own process context)
 * and the AgentRuntimeService event pipeline.
 *
 * NotificationListenerService cannot directly reference the runtime service.
 * Instead it sends a local broadcast, which this bridge receives and forwards
 * into the unified EventPipeline. This avoids duplicate processing paths.
 */
object NotificationBridge {

    const val ACTION_NOTIFICATION_EVENT = "com.localai.automation.NOTIFICATION_EVENT"
    const val EXTRA_PACKAGE = "pkg"
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    const val EXTRA_ID = "notif_id"
    const val EXTRA_POST_TIME = "post_time"

    private const val TAG = "NotificationBridge"

    private var receiver: BroadcastReceiver? = null
    private val scope = CoroutineScope(Dispatchers.IO)

    /** Called from AgentRuntimeService.onCreate() to start listening. */
    fun register(context: Context) {
        if (receiver != null) return

        val br = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                if (intent.action != ACTION_NOTIFICATION_EVENT) return

                val pkg = intent.getStringExtra(EXTRA_PACKAGE) ?: return
                val title = intent.getStringExtra(EXTRA_TITLE) ?: ""
                val text = intent.getStringExtra(EXTRA_TEXT) ?: ""
                val id = intent.getIntExtra(EXTRA_ID, 0)
                val postTime = intent.getLongExtra(EXTRA_POST_TIME, System.currentTimeMillis())

                Log.d(TAG, "Bridge received notification from $pkg: $title")

                val event = AgentEvent(
                    module = AgentModule.NOTIFICATION,
                    eventType = EventType.NOTIFICATION_RECEIVED,
                    data = mapOf(
                        "package" to pkg,
                        "title" to title,
                        "text" to text,
                        "id" to id,
                        "postTime" to postTime
                    ),
                    timestamp = postTime
                )

                scope.launch { EventPipeline.get().emit(event) }
            }
        }

        // RECEIVER_NOT_EXPORTED requires API 33; use ContextCompat for backward compat
        androidx.core.content.ContextCompat.registerReceiver(
            context, br, IntentFilter(ACTION_NOTIFICATION_EVENT),
            androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED
        )
        receiver = br
        Log.i(TAG, "NotificationBridge registered")
    }

    fun unregister(context: Context) {
        receiver?.let {
            try { context.unregisterReceiver(it) } catch (_: Exception) {}
            receiver = null
        }
        Log.i(TAG, "NotificationBridge unregistered")
    }

    /** Called from AgentNotificationListener to publish into the bridge. */
    fun publish(context: Context, pkg: String, title: String, text: String, id: Int, postTime: Long) {
        val intent = Intent(ACTION_NOTIFICATION_EVENT).apply {
            putExtra(EXTRA_PACKAGE, pkg)
            putExtra(EXTRA_TITLE, title)
            putExtra(EXTRA_TEXT, text)
            putExtra(EXTRA_ID, id)
            putExtra(EXTRA_POST_TIME, postTime)
            setPackage(context.packageName) // Restrict to own package
        }
        context.sendBroadcast(intent)
    }
}
