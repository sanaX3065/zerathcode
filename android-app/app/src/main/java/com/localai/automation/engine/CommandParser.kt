package com.localai.automation.engine

import android.util.Log
import com.google.gson.Gson
import com.localai.automation.models.*

/**
 * Structured command parser.
 * Returns ParseResult with both raw JSON (for rule storage) and
 * human-readable display fields (for the preview confirmation dialog).
 */
class CommandParser {

    companion object {
        private const val TAG = "CommandParser"

        val SUPPORTED_COMMANDS = """
Supported commands:
  • "When battery is low, set [silent|vibrate|normal] mode"
  • "When charging starts, set [silent|vibrate|normal|brightness N]"
  • "When charging stops, set [silent|vibrate|normal]"
  • "When I enter a zone, set [silent|vibrate|normal] mode"
  • "When I leave a zone, set [silent|vibrate|normal] mode"
  • "When I enter a zone between HH:MM and HH:MM, set [mode]"
  • "Set brightness to [low|medium|high|N] when charging"
  • "Notify me when battery is low"
  • "Log when charging starts"
        """.trimIndent()
    }

    private val gson = Gson()

    data class ParseResult(
        val success: Boolean,
        val ruleName: String = "",
        val conditionJson: String = "",
        val actionJson: String = "",
        val priority: Float = 0.5f,
        val feedback: String = "",
        // Human-readable fields for the preview dialog
        val triggerDisplay: String = "",
        val conditionDisplay: String = "",
        val actionDisplay: String = "",
        val priorityDisplay: String = ""
    )

    fun parse(input: String): ParseResult {
        val s = input.trim().lowercase()
        Log.d(TAG, "Parsing: $input")

        return when {
            matchesBatteryLow(s)    -> buildBatteryLowRule(s)
            matchesChargingStart(s) -> buildChargingRule(s, started = true)
            matchesChargingStop(s)  -> buildChargingRule(s, started = false)
            matchesEnterZone(s)     -> buildZoneRule(s, entering = true)
            matchesExitZone(s)      -> buildZoneRule(s, entering = false)
            matchesNotify(s)        -> buildNotifyRule(s)
            matchesLogOnly(s)       -> buildLogRule(s)
            else -> ParseResult(
                success = false,
                feedback = "⚠️ I didn't recognise that command.\n\n$SUPPORTED_COMMANDS"
            )
        }
    }

    // ─── Matchers ─────────────────────────────────────────────────────────────

    private fun matchesBatteryLow(s: String)    = s.contains("battery") && s.contains("low")
    private fun matchesChargingStart(s: String) = s.contains("charg") &&
        (s.contains("start") || (!s.contains("stop") && !s.contains("disconnect")))
    private fun matchesChargingStop(s: String)  = s.contains("charg") &&
        (s.contains("stop") || s.contains("disconnect") || s.contains("unplug"))
    private fun matchesEnterZone(s: String)     = (s.contains("enter") || s.contains("arrive") ||
        s.contains("reach")) && (s.contains("zone") || s.contains("location") || s.contains("place"))
    private fun matchesExitZone(s: String)      = (s.contains("leave") || s.contains("exit") ||
        s.contains("depart")) && (s.contains("zone") || s.contains("location") || s.contains("place"))
    private fun matchesNotify(s: String)        = s.contains("notify") || s.contains("alert")
    private fun matchesLogOnly(s: String)       = s.contains("log") && !s.contains("silent")

    // ─── Builders ─────────────────────────────────────────────────────────────

    private fun buildBatteryLowRule(s: String): ParseResult {
        val condition = RuleCondition(
            eventType = EventType.BATTERY_LOW,
            cooldownMs = 30_000L
        )
        val mode = extractMode(s) ?: "SILENT"
        val actionMap = actionMap(ActionType.SET_SILENT_MODE, mapOf("mode" to mode))
        val priorityLabel = priorityLabel(0.8f)
        return ParseResult(
            success = true,
            ruleName = "Battery low → $mode",
            conditionJson = gson.toJson(condition),
            actionJson = gson.toJson(actionMap),
            priority = 0.8f,
            feedback = "✅ Rule created: When battery is low → set **$mode** mode.\n_Cooldown: 30s between triggers._",
            triggerDisplay = "Battery level drops low (system threshold)",
            conditionDisplay = "Any time  •  Cooldown: 30s",
            actionDisplay = "Set ringer to ${mode.lowercase().replaceFirstChar { it.uppercase() }}",
            priorityDisplay = priorityLabel
        )
    }

    private fun buildChargingRule(s: String, started: Boolean): ParseResult {
        val eventType = if (started) EventType.CHARGING_STARTED else EventType.CHARGING_STOPPED
        val condition = RuleCondition(eventType = eventType, cooldownMs = 10_000L)
        val verb = if (started) "starts" else "stops"

        return if (s.contains("bright")) {
            val level = extractBrightnessLevel(s)
            val actionMap = actionMap(ActionType.SET_BRIGHTNESS, mapOf("level" to level, "auto" to false))
            val priorityLabel = priorityLabel(0.55f)
            ParseResult(
                success = true,
                ruleName = "Charging $verb → brightness $level",
                conditionJson = gson.toJson(condition),
                actionJson = gson.toJson(actionMap),
                priority = 0.55f,
                feedback = "✅ Rule created: When charging $verb → brightness **$level/255**.",
                triggerDisplay = "Charger ${if (started) "connected" else "disconnected"}",
                conditionDisplay = "Any time  •  Cooldown: 10s",
                actionDisplay = "Set screen brightness to $level / 255",
                priorityDisplay = priorityLabel
            )
        } else {
            val mode = extractMode(s) ?: if (started) "NORMAL" else "VIBRATE"
            val actionMap = actionMap(ActionType.SET_SILENT_MODE, mapOf("mode" to mode))
            val priorityLabel = priorityLabel(0.6f)
            ParseResult(
                success = true,
                ruleName = "Charging $verb → $mode",
                conditionJson = gson.toJson(condition),
                actionJson = gson.toJson(actionMap),
                priority = 0.6f,
                feedback = "✅ Rule created: When charging $verb → **$mode** mode.",
                triggerDisplay = "Charger ${if (started) "connected" else "disconnected"}",
                conditionDisplay = "Any time  •  Cooldown: 10s",
                actionDisplay = "Set ringer to ${mode.lowercase().replaceFirstChar { it.uppercase() }}",
                priorityDisplay = priorityLabel
            )
        }
    }

    private fun buildZoneRule(s: String, entering: Boolean): ParseResult {
        val eventType = if (entering) EventType.ENTERED_ZONE else EventType.EXITED_ZONE
        val timeRange = extractTimeRange(s)
        val condition = RuleCondition(eventType = eventType, timeRange = timeRange, cooldownMs = 20_000L)
        val mode = extractMode(s) ?: if (entering) "VIBRATE" else "NORMAL"
        val actionMap = actionMap(ActionType.SET_SILENT_MODE, mapOf("mode" to mode))
        val verb = if (entering) "enter" else "leave"
        val timeNote = if (timeRange != null)
            "${timeRange.startHour}:%02d – ${timeRange.endHour}:%02d".format(
                timeRange.startMinute, timeRange.endMinute)
        else "Any time"
        val priorityLabel = priorityLabel(0.7f)
        return ParseResult(
            success = true,
            ruleName = "Zone $verb → $mode${if (timeRange != null) " ($timeNote)" else ""}",
            conditionJson = gson.toJson(condition),
            actionJson = gson.toJson(actionMap),
            priority = 0.7f,
            feedback = "✅ Rule created: When you $verb a zone → **$mode** mode.",
            triggerDisplay = "You ${if (entering) "enter" else "exit"} any configured geofence zone",
            conditionDisplay = "Time: $timeNote  •  Cooldown: 20s",
            actionDisplay = "Set ringer to ${mode.lowercase().replaceFirstChar { it.uppercase() }}",
            priorityDisplay = priorityLabel
        )
    }

    private fun buildNotifyRule(s: String): ParseResult {
        val condition = RuleCondition(eventType = EventType.BATTERY_LOW, cooldownMs = 60_000L)
        val actionMap = actionMap(ActionType.SEND_NOTIFICATION,
            mapOf("title" to "Agent Alert", "text" to "Battery is low"))
        return ParseResult(
            success = true,
            ruleName = "Notify on battery low",
            conditionJson = gson.toJson(condition),
            actionJson = gson.toJson(actionMap),
            priority = 0.4f,
            feedback = "✅ Rule created: You'll receive a notification when battery is low.",
            triggerDisplay = "Battery level drops low",
            conditionDisplay = "Any time  •  Cooldown: 60s",
            actionDisplay = "Send notification: \"Agent Alert — Battery is low\"",
            priorityDisplay = priorityLabel(0.4f)
        )
    }

    private fun buildLogRule(s: String): ParseResult {
        val condition = RuleCondition(eventType = EventType.CHARGING_STARTED)
        val actionMap = actionMap(ActionType.LOG_ONLY, mapOf("message" to "Charging started — logged by rule"))
        return ParseResult(
            success = true,
            ruleName = "Log charging start",
            conditionJson = gson.toJson(condition),
            actionJson = gson.toJson(actionMap),
            priority = 0.2f,
            feedback = "✅ Rule created: Charging events will be logged to the Dashboard.",
            triggerDisplay = "Charger connected",
            conditionDisplay = "Any time  •  No cooldown",
            actionDisplay = "Log event to Dashboard",
            priorityDisplay = priorityLabel(0.2f)
        )
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    private fun extractMode(s: String): String? = when {
        s.contains("vibrat") -> "VIBRATE"
        s.contains("normal") || s.contains("unmute") || s.contains("ring") -> "NORMAL"
        s.contains("silent") || s.contains("mute") -> "SILENT"
        else -> null
    }

    private fun extractBrightnessLevel(s: String): Int = when {
        s.contains("low") || s.contains("dim") -> 40
        s.contains("high") || s.contains("max") || s.contains("full") -> 230
        s.contains("medium") || s.contains("mid") -> 128
        else -> Regex("""\d+""").find(s)?.value?.toIntOrNull()?.coerceIn(0, 255) ?: 128
    }

    private fun extractTimeRange(s: String): TimeRange? {
        val pattern = Regex("""(\d{1,2}):(\d{2})\s*(?:and|to|-)\s*(\d{1,2}):(\d{2})""")
        val match = pattern.find(s) ?: return null
        val (sh, sm, eh, em) = match.destructured
        return TimeRange(sh.toInt(), sm.toInt(), eh.toInt(), em.toInt())
    }

    private fun actionMap(type: ActionType, params: Map<String, Any>): Map<String, Any> =
        mapOf("actionType" to type.name, "params" to params)

    private fun priorityLabel(p: Float): String = when {
        p >= 0.8f -> "High (${"%.1f".format(p)}) — executes before lower-priority rules"
        p >= 0.6f -> "Medium (${"%.1f".format(p)}) — standard priority"
        p >= 0.4f -> "Normal (${"%.1f".format(p)})"
        else      -> "Low (${"%.1f".format(p)}) — informational only"
    }
}