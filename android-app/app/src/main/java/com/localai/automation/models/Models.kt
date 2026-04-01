package com.localai.automation.models

import com.google.gson.Gson
import com.google.gson.reflect.TypeToken

enum class EventType {
    ENTERED_ZONE, EXITED_ZONE,
    NOTIFICATION_RECEIVED,
    BATTERY_LOW, CHARGING_STARTED, CHARGING_STOPPED,
    APP_OPENED, APP_CLOSED,
    SYSTEM_BOOT, RULE_TRIGGERED
}

enum class AgentModule {
    LOCATION, NOTIFICATION, BATTERY, APP_USAGE, SYSTEM
}

data class AgentEvent(
    val id: String = java.util.UUID.randomUUID().toString(),
    val module: AgentModule,
    val eventType: EventType,
    val data: Map<String, Any> = emptyMap(),
    val timestamp: Long = System.currentTimeMillis()
) {
    fun toJson(): String = Gson().toJson(this)
    fun dataJson(): String = Gson().toJson(data)
    companion object {
        fun fromDataJson(json: String): Map<String, Any> {
            val type = object : TypeToken<Map<String, Any>>() {}.type
            return Gson().fromJson(json, type) ?: emptyMap()
        }
    }
}

enum class ActionType {
    // Phase 1
    SET_SILENT_MODE, SET_VIBRATION, SET_BRIGHTNESS, SEND_NOTIFICATION, LOG_ONLY,
    // Phase 2 - Calendar
    CREATE_CALENDAR_EVENT, DELETE_CALENDAR_EVENT, QUERY_CALENDAR,
    // Phase 2 - Alarms
    SET_ALARM, DISMISS_ALARM,
    // Phase 2 - Connectivity
    SET_WIFI, SET_BLUETOOTH, SET_DND_MODE,
    // Phase 2 - Apps & SMS
    LAUNCH_APP, SEND_SMS
}
enum class SilentMode { SILENT, VIBRATE, NORMAL }

data class AgentAction(
    val id: String = java.util.UUID.randomUUID().toString(),
    val actionType: ActionType,
    val params: Map<String, Any> = emptyMap(),
    val priority: Float = 0.5f,
    val sourceRuleId: Long? = null,
    val timestamp: Long = System.currentTimeMillis()
) {
    fun paramsJson(): String = Gson().toJson(params)
    fun getParam(key: String): Any? = params[key]
    fun getStringParam(key: String): String? = params[key]?.toString()
    fun getIntParam(key: String): Int? = (params[key] as? Double)?.toInt() ?: params[key] as? Int
    fun getBoolParam(key: String): Boolean? = params[key] as? Boolean
}

enum class ConditionOperator { AND, OR }

data class ConditionClause(
    val eventType: EventType? = null,
    val module: AgentModule? = null,
    val dataMatches: Map<String, Any> = emptyMap(),
    val timeRange: TimeRange? = null,
    val batteryBelow: Int? = null,
    val batteryAbove: Int? = null
)

data class RuleCondition(
    val eventType: EventType? = null,
    val module: AgentModule? = null,
    val dataMatches: Map<String, Any> = emptyMap(),
    val timeRange: TimeRange? = null,
    val operator: ConditionOperator = ConditionOperator.AND,
    val clauses: List<ConditionClause> = emptyList(),
    val cooldownMs: Long? = null,
    val thenTriggerRule: String? = null
)

data class TimeRange(
    val startHour: Int,
    val startMinute: Int,
    val endHour: Int,
    val endMinute: Int
)

data class ParsedRule(
    val condition: RuleCondition,
    val action: AgentAction,
    val priority: Float = 0.5f
)
