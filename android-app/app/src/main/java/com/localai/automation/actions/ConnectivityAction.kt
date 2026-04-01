package com.localai.automation.actions

import android.app.NotificationManager
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.Intent
import android.net.wifi.WifiManager
import android.os.Build
import android.provider.Settings
import android.util.Log
import com.localai.automation.models.AgentAction

/**
 * ConnectivityAction
 *
 * Handles device connectivity:
 *   - SET_WIFI:       Enable/disable WiFi
 *   - SET_BLUETOOTH:  Enable/disable Bluetooth
 *   - SET_DND_MODE:   Set Do Not Disturb level
 *
 * Implementations differ by API level (many require Settings panel).
 */
class ConnectivityAction(private val context: Context) {

    companion object {
        private const val TAG = "ConnectivityAction"
    }

    /**
     * SET_WIFI — Enable/disable WiFi
     *
     * Params:
     *   enabled  : Boolean — true to enable, false to disable
     *   usePanel : Boolean — if true, open Settings panel (no permission needed).
     *                        if false, attempt direct toggle (requires CHANGE_WIFI_STATE)
     *
     * API Level Notes:
     * • API < 29: Direct toggle works consistently
     * • API 29+:  WifiManager methods disabled; need Settings panel on most OEMs
     * • Modern practice: Always prefer Settings panel
     */
    fun setWifi(action: AgentAction): ActionResult {
        val enabled = action.getBoolParam("enabled")
            ?: return ActionResult.failure("Missing required param: enabled (Boolean)")
        val usePanel = action.getBoolParam("usePanel") ?: true

        return if (usePanel || Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            openWifiSettings()
        } else {
            setWifiDirect(enabled)
        }
    }

    private fun setWifiDirect(enabled: Boolean): ActionResult {
        return try {
            val wifiManager = context.getSystemService(WifiManager::class.java)
            wifiManager?.isWifiEnabled = enabled
            val state = if (enabled) "enabled" else "disabled"
            Log.i(TAG, "WiFi $state")
            ActionResult.success("WiFi $state")
        } catch (e: SecurityException) {
            ActionResult.failure("WiFi permission missing. Use Settings panel instead.")
        } catch (e: Exception) {
            ActionResult.failure("Failed to toggle WiFi: ${e.message}")
        }
    }

    private fun openWifiSettings(): ActionResult {
        return try {
            val intent = Intent(Settings.ACTION_WIFI_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            Log.i(TAG, "WiFi settings panel opened")
            ActionResult.success("WiFi settings opened — adjust manually")
        } catch (e: Exception) {
            ActionResult.failure("Failed to open WiFi settings: ${e.message}")
        }
    }

    /**
     * SET_BLUETOOTH — Enable/disable Bluetooth
     *
     * Params:
     *   enabled : Boolean — true to enable, false to disable
     *
     * API Level Notes:
     * • API ≤ 30: BluetoothAdapter.enable()/disable() work
     * • API 31+:  Need BLUETOOTH_CONNECT permission on connected devices
     * • API 33+:  Some OEMs require Intent for toggle (no direct API)
     *             Fall back to Settings → Bluetooth panel
     */
    fun setBluetooth(action: AgentAction): ActionResult {
        val enabled = action.getBoolParam("enabled")
            ?: return ActionResult.failure("Missing required param: enabled (Boolean)")

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // API 33+: use Settings panel (safest)
            openBluetoothSettings()
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // API 31-32: try direct toggle with new permission name
            setBluetoothDirect(enabled)
        } else {
            // API ≤ 30: legacy toggle
            setBluetoothDirect(enabled)
        }
    }

    private fun setBluetoothDirect(enabled: Boolean): ActionResult {
        return try {
            val bluetoothAdapter = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val manager = context.getSystemService(BluetoothManager::class.java)
                manager?.adapter
            } else {
                @Suppress("DEPRECATION")
                BluetoothAdapter.getDefaultAdapter()
            }

            bluetoothAdapter?.let {
                if (enabled) {
                    it.enable()
                } else {
                    it.disable()
                }
                val state = if (enabled) "enabled" else "disabled"
                Log.i(TAG, "Bluetooth $state")
                ActionResult.success("Bluetooth $state")
            } ?: ActionResult.failure("Bluetooth adapter not found")
        } catch (e: SecurityException) {
            ActionResult.failure("Bluetooth permission missing: ${e.message}")
        } catch (e: Exception) {
            ActionResult.failure("Failed to toggle Bluetooth: ${e.message}")
        }
    }

    private fun openBluetoothSettings(): ActionResult {
        return try {
            val intent = Intent(Settings.ACTION_BLUETOOTH_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            Log.i(TAG, "Bluetooth settings panel opened")
            ActionResult.success("Bluetooth settings opened — adjust manually")
        } catch (e: Exception) {
            ActionResult.failure("Failed to open Bluetooth settings: ${e.message}")
        }
    }

    /**
     * SET_DND_MODE — Control Do Not Disturb
     *
     * Params:
     *   mode : String — one of: "off", "priority", "alarms", "silent", "all"
     *     - off      : DND disabled
     *     - priority : allow priority interruptions
     *     - alarms   : allow alarms only
     *     - silent   : mute all sounds
     *     - all      : all interruptions allowed (same as off)
     *
     * Implementation Notes:
     * • Requires NOT_NOTIFICATION_POLICY_ACCESS permission to set policy
     * • On denied, return helpful error pointing to Settings
     */
    fun setDndMode(action: AgentAction): ActionResult {
        val mode = action.getStringParam("mode")
            ?: return ActionResult.failure("Missing required param: mode (off|priority|alarms|silent|all)")

        val validModes = setOf("off", "priority", "alarms", "silent", "all")
        if (mode !in validModes) {
            return ActionResult.failure("Invalid mode: $mode. Valid: $validModes")
        }

        return try {
            val notificationManager =
                context.getSystemService(NotificationManager::class.java)

            // Check permission
            if (!notificationManager?.isNotificationPolicyAccessGranted!!) {
                return ActionResult.failure(
                    "DND permission not granted. " +
                    "Go to Settings → Apps → Special app access → Do Not Disturb"
                )
            }

            val filter = when (mode) {
                "off" -> NotificationManager.INTERRUPTION_FILTER_ALL
                "priority" -> NotificationManager.INTERRUPTION_FILTER_PRIORITY
                "alarms" -> NotificationManager.INTERRUPTION_FILTER_ALARMS
                "silent" -> NotificationManager.INTERRUPTION_FILTER_NONE
                "all" -> NotificationManager.INTERRUPTION_FILTER_ALL
                else -> return ActionResult.failure("Unknown mode: $mode")
            }

            notificationManager.setInterruptionFilter(filter)
            Log.i(TAG, "DND mode set to: $mode")
            ActionResult.success("DND mode set to: $mode")
        } catch (e: SecurityException) {
            ActionResult.failure("DND permission denied: ${e.message}")
        } catch (e: Exception) {
            ActionResult.failure("Failed to set DND mode: ${e.message}")
        }
    }
}
