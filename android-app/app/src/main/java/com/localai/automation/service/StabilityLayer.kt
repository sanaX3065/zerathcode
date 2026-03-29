package com.localai.automation.service

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.work.*
import com.localai.automation.modules.ModuleState
import com.localai.automation.modules.ModuleStatus
import com.localai.automation.models.AgentModule
import java.util.concurrent.TimeUnit

/**
 * Stability layer that handles:
 *  1. WorkManager-based watchdog (revives service if killed)
 *  2. Battery optimization exemption guidance
 *  3. OEM-specific mitigations (Samsung, Xiaomi, MIUI, etc.)
 *  4. Runtime permission monitoring
 *  5. Degraded mode fallback when critical permissions are missing
 */
object StabilityLayer {

    private const val TAG = "StabilityLayer"
    private const val WATCHDOG_WORK_NAME = "agent_runtime_watchdog"

    // ─── WorkManager Watchdog ─────────────────────────────────────────────────

    /**
     * Schedules a periodic WorkManager job that restarts the runtime service
     * if it has been killed by the system. This survives doze mode and app standby.
     */
    fun scheduleWatchdog(context: Context) {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.NOT_REQUIRED)
            .build()

        val watchdogRequest = PeriodicWorkRequestBuilder<RuntimeWatchdogWorker>(
            15, TimeUnit.MINUTES,
            5, TimeUnit.MINUTES  // flex interval
        )
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES)
            .addTag(WATCHDOG_WORK_NAME)
            .build()

        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            WATCHDOG_WORK_NAME,
            ExistingPeriodicWorkPolicy.KEEP,
            watchdogRequest
        )
        Log.i(TAG, "Watchdog scheduled via WorkManager")
    }

    fun cancelWatchdog(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(WATCHDOG_WORK_NAME)
        Log.i(TAG, "Watchdog cancelled")
    }

    // ─── Battery Optimization ─────────────────────────────────────────────────

    fun isIgnoringBatteryOptimizations(context: Context): Boolean {
        val pm = context.getSystemService(PowerManager::class.java)
        return pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    fun buildBatteryOptimizationIntent(context: Context): Intent {
        return Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
            data = Uri.parse("package:${context.packageName}")
        }
    }

    // ─── Permission Monitor ───────────────────────────────────────────────────

    data class PermissionReport(
        val permission: String,
        val granted: Boolean,
        val critical: Boolean,
        val degradedBehavior: String  // What the system does if this is missing
    )

    fun checkAllPermissions(context: Context): List<PermissionReport> {
        return listOf(
            PermissionReport(
                Manifest.permission.ACCESS_FINE_LOCATION,
                hasPermission(context, Manifest.permission.ACCESS_FINE_LOCATION),
                critical = true,
                degradedBehavior = "Location module disabled — geofence zones will not trigger"
            ),
            PermissionReport(
                Manifest.permission.ACCESS_BACKGROUND_LOCATION,
                hasPermission(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION),
                critical = false,
                degradedBehavior = "Geofences only trigger while app is in foreground"
            ),
            PermissionReport(
                "NOTIFICATION_LISTENER",
                com.localai.automation.modules.NotificationModule.isNotificationListenerEnabled(context),
                critical = false,
                degradedBehavior = "Notification module disabled — no notification-based triggers"
            ),
            PermissionReport(
                "WRITE_SETTINGS",
                Settings.System.canWrite(context),
                critical = false,
                degradedBehavior = "Brightness actions will fail silently"
            ),
            PermissionReport(
                "DND_POLICY",
                context.getSystemService(android.app.NotificationManager::class.java)
                    .isNotificationPolicyAccessGranted,
                critical = false,
                degradedBehavior = "Silent/vibrate mode actions will fail"
            )
        )
    }

    /**
     * Based on which permissions are granted, determine which modules
     * can safely run in degraded mode vs full mode.
     */
    fun computeDegradedModuleStates(context: Context): Map<AgentModule, ModuleState> {
        val perms = checkAllPermissions(context).associateBy { it.permission }
        val result = mutableMapOf<AgentModule, ModuleState>()

        val hasLocation = perms[Manifest.permission.ACCESS_FINE_LOCATION]?.granted ?: false
        result[AgentModule.LOCATION] = if (hasLocation) {
            ModuleState(AgentModule.LOCATION, ModuleStatus.RUNNING, "Full mode")
        } else {
            ModuleState(AgentModule.LOCATION, ModuleStatus.PERMISSION_DENIED,
                "Degraded — location permission missing")
        }

        val hasNotifListener = perms["NOTIFICATION_LISTENER"]?.granted ?: false
        result[AgentModule.NOTIFICATION] = if (hasNotifListener) {
            ModuleState(AgentModule.NOTIFICATION, ModuleStatus.RUNNING, "Full mode")
        } else {
            ModuleState(AgentModule.NOTIFICATION, ModuleStatus.PERMISSION_DENIED,
                "Degraded — notification listener not enabled")
        }

        // Battery module needs no special permission
        result[AgentModule.BATTERY] = ModuleState(AgentModule.BATTERY, ModuleStatus.RUNNING, "Full mode")

        return result
    }

    // ─── OEM Handling ─────────────────────────────────────────────────────────

    data class OemGuidance(val manufacturer: String, val steps: List<String>)

    fun getOemGuidance(): OemGuidance? {
        val mfr = Build.MANUFACTURER.lowercase()
        return when {
            mfr.contains("xiaomi") || mfr.contains("redmi") -> OemGuidance(
                "Xiaomi / MIUI",
                listOf(
                    "Settings → Apps → Manage Apps → Local AI Agent",
                    "Set Autostart to ON",
                    "Battery Saver → No Restrictions",
                    "Security → Permissions → Background activity → Allow"
                )
            )
            mfr.contains("samsung") -> OemGuidance(
                "Samsung",
                listOf(
                    "Settings → Apps → Local AI Agent → Battery → Unrestricted",
                    "Settings → Device Care → Battery → Background usage limits → Never sleeping apps → Add"
                )
            )
            mfr.contains("huawei") || mfr.contains("honor") -> OemGuidance(
                "Huawei / Honor",
                listOf(
                    "Phone Manager → Protected Apps → Enable Local AI Agent",
                    "Settings → Battery → App Launch → Manage manually → Enable all options"
                )
            )
            mfr.contains("oppo") || mfr.contains("realme") || mfr.contains("oneplus") -> OemGuidance(
                "OPPO / Realme / OnePlus",
                listOf(
                    "Settings → Battery → Battery Optimization → Local AI Agent → Don't Optimize",
                    "Settings → Apps → Local AI Agent → Battery → Allow background activity"
                )
            )
            else -> null  // Stock Android — standard battery optimization flow
        }
    }

    private fun hasPermission(context: Context, permission: String): Boolean =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
}

// ─── WorkManager Watchdog Worker ─────────────────────────────────────────────

class RuntimeWatchdogWorker(
    private val context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        Log.d("WatchdogWorker", "Watchdog tick — isRunning=${AgentRuntimeService.isRunning}")
        if (!AgentRuntimeService.isRunning) {
            Log.w("WatchdogWorker", "Runtime not running — restarting")
            AgentRuntimeService.startService(context)
        }
        return Result.success()
    }
}
