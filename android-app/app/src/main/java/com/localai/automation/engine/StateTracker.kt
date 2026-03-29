package com.localai.automation.engine

import android.content.Context
import android.media.AudioManager
import android.provider.Settings
import android.util.Log
import com.localai.automation.models.ActionType
import java.util.concurrent.ConcurrentHashMap

/**
 * Tracks the current known system state to prevent redundant/oscillating actions.
 * Singleton initialized once from AgentRuntimeService.
 */
class StateTracker private constructor(private val context: Context) {

    companion object {
        private const val TAG = "StateTracker"

        @Volatile private var INSTANCE: StateTracker? = null

        fun init(ctx: Context): StateTracker =
            INSTANCE ?: synchronized(this) {
                INSTANCE ?: StateTracker(ctx.applicationContext).also { INSTANCE = it }
            }

        fun get(): StateTracker? = INSTANCE
    }

    object Keys {
        const val AUDIO_MODE      = "audio_mode"
        const val BRIGHTNESS      = "brightness"
        const val BRIGHTNESS_AUTO = "brightness_auto"
    }

    private val state           = ConcurrentHashMap<String, String>()
    private val stateTimestamps = ConcurrentHashMap<String, Long>()

    // ─── Sync from live system ────────────────────────────────────────────────

    fun syncFromSystem() {
        try {
            val audio = context.getSystemService(AudioManager::class.java)
            update(Keys.AUDIO_MODE, when (audio.ringerMode) {
                AudioManager.RINGER_MODE_SILENT  -> "SILENT"
                AudioManager.RINGER_MODE_VIBRATE -> "VIBRATE"
                else                              -> "NORMAL"
            })

            val autoMode = Settings.System.getInt(
                context.contentResolver,
                Settings.System.SCREEN_BRIGHTNESS_MODE,
                Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL
            )
            update(Keys.BRIGHTNESS_AUTO,
                (autoMode == Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC).toString())

            val brightness = Settings.System.getInt(
                context.contentResolver, Settings.System.SCREEN_BRIGHTNESS, 128)
            update(Keys.BRIGHTNESS, brightness.toString())

        } catch (e: Exception) {
            Log.w(TAG, "State sync failed: ${e.message}")
        }
    }

    // ─── State management ─────────────────────────────────────────────────────

    fun update(key: String, value: String) {
        val prev = state[key]
        state[key] = value
        stateTimestamps[key] = System.currentTimeMillis()
        if (prev != value) Log.d(TAG, "State: $key → $prev → $value")
    }

    fun get(key: String): String? = state[key]

    fun getStateAge(key: String): Long {
        val ts = stateTimestamps[key] ?: return Long.MAX_VALUE
        return System.currentTimeMillis() - ts
    }

    // ─── Idempotency ──────────────────────────────────────────────────────────

    fun isAlreadySatisfied(actionType: ActionType, params: Map<String, Any>): Boolean {
        return try {
            when (actionType) {
                ActionType.SET_SILENT_MODE -> {
                    val desired = params["mode"]?.toString()?.uppercase() ?: "SILENT"
                    state[Keys.AUDIO_MODE] == desired
                }
                ActionType.SET_BRIGHTNESS -> {
                    val desiredAuto = params["auto"] as? Boolean ?: false
                    if (desiredAuto) {
                        state[Keys.BRIGHTNESS_AUTO] == "true"
                    } else {
                        val desired = (params["level"] as? Number)?.toInt() ?: 128
                        val current = state[Keys.BRIGHTNESS]?.toIntOrNull() ?: -1
                        Math.abs(current - desired) <= 5
                    }
                }
                ActionType.SET_VIBRATION -> {
                    val level = (params["level"] as? Number)?.toInt() ?: 1
                    val current = state[Keys.AUDIO_MODE]
                    if (level == 0) current == "SILENT" else current == "VIBRATE"
                }
                else -> false
            }
        } catch (e: Exception) { false }
    }

    fun isOscillating(key: String, windowMs: Long = 5_000): Boolean =
        getStateAge(key) < windowMs

    fun snapshot(): Map<String, String> = HashMap(state)
}
