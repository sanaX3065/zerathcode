package com.localai.automation.service

import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import com.localai.automation.LocalAIApp
import com.localai.automation.R
import com.localai.automation.bridge.BridgeManager
import com.localai.automation.data.AppDatabase
import com.localai.automation.data.repository.LocalRepository
import com.localai.automation.engine.*
import com.localai.automation.models.AgentEvent
import com.localai.automation.models.AgentModule
import com.localai.automation.modules.*
import com.localai.automation.pipeline.EventPipeline
import com.localai.automation.ui.MainActivity
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach

class AgentRuntimeService : LifecycleService() {

    companion object {
        private const val TAG = "AgentRuntimeService"
        private const val NOTIFICATION_ID = 1001
        const val ACTION_START = "ACTION_START"
        const val ACTION_STOP  = "ACTION_STOP"

        @Volatile var isRunning = false
            private set

        fun startService(context: Context) {
            val i = Intent(context, AgentRuntimeService::class.java).apply { action = ACTION_START }
            context.startForegroundService(i)
        }

        fun stopService(context: Context) {
            val i = Intent(context, AgentRuntimeService::class.java).apply { action = ACTION_STOP }
            context.startService(i)
        }
    }

    private val locationModule     = LocationModule()
    private val notificationModule = NotificationModule()
    private val batteryModule      = BatteryModule()

    private lateinit var repository:     LocalRepository
    private lateinit var ruleEngine:     RuleEngine
    private lateinit var priorityEngine: PriorityEngine
    private lateinit var actionResolver: ActionResolver
    private lateinit var actionExecutor: ActionExecutor
    private lateinit var bridgeManager:  BridgeManager
    private val pipeline = EventPipeline.get()

    override fun onCreate() {
        super.onCreate()
        val db = AppDatabase.getInstance(applicationContext)
        repository     = LocalRepository(db)
        ruleEngine     = RuleEngine(repository)
        priorityEngine = PriorityEngine()
        actionResolver = ActionResolver()
        actionExecutor = ActionExecutor(applicationContext, repository)
        bridgeManager  = BridgeManager(applicationContext, repository)

        StateTracker.init(applicationContext)
        ObservabilityLogger.system("AgentRuntimeService created")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        if (intent?.action == ACTION_STOP) { stopRuntime(); return START_NOT_STICKY }
        startRuntime()
        return START_STICKY
    }

    // ─── Runtime lifecycle ────────────────────────────────────────────────────

    private fun startRuntime() {
        if (isRunning) return
        isRunning = true

        startForeground(NOTIFICATION_ID, buildNotification("Agent running"))
        ObservabilityLogger.system("Runtime starting")

        StabilityLayer.scheduleWatchdog(applicationContext)

        startModuleSafe(AgentModule.LOCATION)    { locationModule.start(applicationContext) }
        startModuleSafe(AgentModule.NOTIFICATION){ notificationModule.start(applicationContext) }
        startModuleSafe(AgentModule.BATTERY)     { batteryModule.start(applicationContext) }

        bridgeManager.start()
        ObservabilityLogger.system("Bridge manager started — connecting to ws://localhost:8765")

        NotificationBridge.register(applicationContext)
        StateTracker.get()?.syncFromSystem()
        subscribeToEvents()

        ObservabilityLogger.system("Runtime started — ${pipeline.getQueueDepth()} queued events")
    }

    private fun stopRuntime() {
        isRunning = false
        locationModule.stop()
        notificationModule.stop()
        batteryModule.stop()
        bridgeManager.stop()
        NotificationBridge.unregister(applicationContext)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        ObservabilityLogger.system("Runtime stopped")
    }

    // ─── Module management ────────────────────────────────────────────────────

    private fun startModuleSafe(module: AgentModule, block: () -> Unit) {
        try {
            block()
            val state = getModuleStates()[module]
            ObservabilityLogger.moduleState(module.name, state?.status?.name ?: "?", state?.message ?: "")
        } catch (e: Exception) {
            Log.e(TAG, "Module $module failed to start — isolated", e)
            ObservabilityLogger.system("Module $module start failed: ${e.message}",
                ObservabilityLogger.Level.ERROR)
        }
    }

    fun restartModule(module: AgentModule) {
        startModuleSafe(module) {
            when (module) {
                AgentModule.LOCATION     -> { locationModule.stop();     locationModule.start(applicationContext) }
                AgentModule.NOTIFICATION -> { notificationModule.stop(); notificationModule.start(applicationContext) }
                AgentModule.BATTERY      -> { batteryModule.stop();      batteryModule.start(applicationContext) }
                else -> {}
            }
        }
    }

    fun getModuleStates(): Map<AgentModule, ModuleState> = mapOf(
        AgentModule.LOCATION     to locationModule.getState(),
        AgentModule.NOTIFICATION to notificationModule.getState(),
        AgentModule.BATTERY      to batteryModule.getState()
    )

    // ─── Event pipeline ───────────────────────────────────────────────────────

    private fun subscribeToEvents() {
        pipeline.events
            .onEach { event -> processEvent(event) }
            .catch  { e -> Log.e(TAG, "Pipeline error", e) }
            .launchIn(lifecycleScope)
    }

    private suspend fun processEvent(event: AgentEvent) {
        ObservabilityLogger.eventReceived(event)

        // Forward event to AI bridge for real-time AI awareness
        bridgeManager.forwardEvent(event)

        // Persist event
        try { repository.insertEvent(event) } catch (e: Exception) {
            Log.e(TAG, "Failed to persist event", e)
        }

        // Rule engine
        val candidates = try { ruleEngine.evaluate(event) }
        catch (e: Exception) { Log.e(TAG, "Rule engine error", e); emptyList() }

        if (candidates.isEmpty()) return

        // Priority scoring
        val ranked = priorityEngine.rank(candidates, pipeline)

        // Conflict resolution
        val resolved = actionResolver.resolve(ranked)

        // Build a human-readable reason for this event
        val triggerReason = buildTriggerReason(event)

        // Execute — passing reason so it appears in the Dashboard
        for (action in resolved) {
            try {
                val result = actionExecutor.execute(action, triggerReason = triggerReason)
                if (!result.skipped) {
                    updateNotification("Last: ${event.eventType.name} → ${action.actionType.name}")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Action execution error", e)
            }
        }
    }

    /**
     * Converts an AgentEvent into a short human-readable explanation shown in the
     * Actions tab: e.g. "Battery dropped low (15%) · battery module"
     */
    private fun buildTriggerReason(event: AgentEvent): String {
        val module = event.module.name.lowercase().replaceFirstChar { it.uppercase() }
        val typeLabel = event.eventType.name.replace("_", " ").lowercase()
            .replaceFirstChar { it.uppercase() }

        val detail = when (event.eventType.name) {
            "BATTERY_LOW"       -> {
                val level = event.data["level"]?.toString() ?: "?"
                "Battery at $level%"
            }
            "CHARGING_STARTED"  -> {
                val level = event.data["level"]?.toString() ?: "?"
                "Charger connected at $level%"
            }
            "CHARGING_STOPPED"  -> {
                val level = event.data["level"]?.toString() ?: "?"
                "Charger disconnected at $level%"
            }
            "ENTERED_ZONE"      -> {
                val name = event.data["locationName"]?.toString() ?: "Unknown zone"
                "Entered zone: $name"
            }
            "EXITED_ZONE"       -> {
                val name = event.data["locationName"]?.toString() ?: "Unknown zone"
                "Exited zone: $name"
            }
            "NOTIFICATION_RECEIVED" -> {
                val pkg = event.data["package"]?.toString() ?: "?"
                "Notification from $pkg"
            }
            else -> typeLabel
        }
        return "$detail · $module module"
    }

    // ─── Notification ─────────────────────────────────────────────────────────

    private fun buildNotification(status: String): Notification {
        val pi = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, LocalAIApp.CHANNEL_ID_RUNTIME)
            .setContentTitle("Local AI Agent")
            .setContentText(status)
            .setSmallIcon(R.drawable.ic_agent)
            .setContentIntent(pi)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    private fun updateNotification(status: String) {
        val nm = getSystemService(android.app.NotificationManager::class.java)
        nm.notify(NOTIFICATION_ID, buildNotification(status))
    }

    override fun onDestroy() {
        super.onDestroy()
        isRunning = false
        bridgeManager.cleanup()
        ObservabilityLogger.system("Service destroyed — watchdog will revive")
    }
}