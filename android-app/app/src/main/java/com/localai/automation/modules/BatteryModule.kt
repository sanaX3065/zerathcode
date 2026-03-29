package com.localai.automation.modules

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.util.Log
import com.localai.automation.models.AgentEvent
import com.localai.automation.models.AgentModule
import com.localai.automation.models.EventType
import com.localai.automation.pipeline.EventPipeline
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class BatteryModule : AgentModuleInterface {

    override val moduleType = AgentModule.BATTERY
    override val requiredPermissions = emptyList<String>() // No special permission needed

    private var state = ModuleState(AgentModule.BATTERY, ModuleStatus.STOPPED)
    private var receiver: BroadcastReceiver? = null

    companion object {
        private const val TAG = "BatteryModule"
        const val LOW_BATTERY_THRESHOLD = 20
    }

    override fun start(context: Context) {
        if (receiver != null) return

        val batteryReceiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                handleBatteryIntent(intent)
            }
        }

        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_BATTERY_CHANGED)
            addAction(Intent.ACTION_BATTERY_LOW)
            addAction(Intent.ACTION_POWER_CONNECTED)
            addAction(Intent.ACTION_POWER_DISCONNECTED)
        }

        context.registerReceiver(batteryReceiver, filter)
        receiver = batteryReceiver
        state = ModuleState(AgentModule.BATTERY, ModuleStatus.RUNNING, "Monitoring battery")
        Log.d(TAG, "Battery module started")
    }

    override fun stop() {
        receiver = null
        state = ModuleState(AgentModule.BATTERY, ModuleStatus.STOPPED)
    }

    override fun getState() = state

    override fun hasRequiredPermissions(context: Context) = true

    private fun handleBatteryIntent(intent: Intent) {
        val scope = CoroutineScope(Dispatchers.IO)

        when (intent.action) {
            Intent.ACTION_BATTERY_LOW -> {
                val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
                val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
                val percentage = if (scale > 0) (level * 100 / scale) else level

                scope.launch {
                    EventPipeline.get().emit(AgentEvent(
                        module = AgentModule.BATTERY,
                        eventType = EventType.BATTERY_LOW,
                        data = mapOf("level" to percentage, "threshold" to LOW_BATTERY_THRESHOLD)
                    ))
                }
                state = state.copy(
                    message = "Battery low: $percentage%",
                    lastEventTime = System.currentTimeMillis()
                )
            }

            Intent.ACTION_POWER_CONNECTED -> {
                val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
                scope.launch {
                    EventPipeline.get().emit(AgentEvent(
                        module = AgentModule.BATTERY,
                        eventType = EventType.CHARGING_STARTED,
                        data = mapOf("level" to level)
                    ))
                }
                state = state.copy(
                    message = "Charging started at $level%",
                    lastEventTime = System.currentTimeMillis()
                )
            }

            Intent.ACTION_POWER_DISCONNECTED -> {
                val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
                scope.launch {
                    EventPipeline.get().emit(AgentEvent(
                        module = AgentModule.BATTERY,
                        eventType = EventType.CHARGING_STOPPED,
                        data = mapOf("level" to level)
                    ))
                }
                state = state.copy(
                    message = "Charging stopped at $level%",
                    lastEventTime = System.currentTimeMillis()
                )
            }

            Intent.ACTION_BATTERY_CHANGED -> {
                // Update state but don't spam events for every change
                val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
                val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
                val percentage = if (scale > 0) (level * 100 / scale) else level
                val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
                val isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
                        status == BatteryManager.BATTERY_STATUS_FULL

                state = state.copy(
                    message = "Battery: $percentage% ${if (isCharging) "⚡ Charging" else ""}"
                )
            }
        }
    }

    fun getCurrentBatteryInfo(context: Context): Map<String, Any> {
        val batteryManager = context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        val level = batteryManager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        val isCharging = batteryManager.isCharging
        return mapOf("level" to level, "isCharging" to isCharging)
    }
}
