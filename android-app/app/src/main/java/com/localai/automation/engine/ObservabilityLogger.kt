package com.localai.automation.engine

import android.util.Log
import com.localai.automation.models.AgentAction
import com.localai.automation.models.AgentEvent
import com.localai.automation.data.entities.RuleEntity
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.ConcurrentLinkedDeque

/**
 * Structured observability layer for debugging rule evaluation and action decisions.
 * Keeps an in-memory ring buffer of decision logs accessible from the UI.
 */
object ObservabilityLogger {

    private const val TAG = "AgentObservability"
    private const val MAX_ENTRIES = 300

    enum class Level { DEBUG, INFO, WARN, ERROR }
    enum class Category { EVENT_RECEIVED, RULE_EVALUATED, RULE_MATCHED, RULE_SKIPPED,
        ACTION_ALLOWED, ACTION_DENIED, ACTION_SKIPPED, ACTION_EXECUTED, ACTION_FAILED,
        MODULE_STATE, SYSTEM }

    data class LogEntry(
        val timestamp: Long = System.currentTimeMillis(),
        val level: Level,
        val category: Category,
        val message: String,
        val detail: String = ""
    ) {
        fun formatted(): String {
            val time = SimpleDateFormat("HH:mm:ss.SSS", Locale.getDefault()).format(Date(timestamp))
            return "[$time][${level.name}][${category.name}] $message"
        }
    }

    private val buffer = ConcurrentLinkedDeque<LogEntry>()

    // ─── Logging helpers ──────────────────────────────────────────────────────

    fun eventReceived(event: AgentEvent) {
        log(Level.INFO, Category.EVENT_RECEIVED,
            "${event.module}/${event.eventType}",
            "data=${event.data}")
    }

    fun ruleEvaluated(rule: RuleEntity, matched: Boolean, reason: String = "") {
        val cat = if (matched) Category.RULE_MATCHED else Category.RULE_SKIPPED
        val lvl = if (matched) Level.INFO else Level.DEBUG
        log(lvl, cat, "Rule '${rule.name}' (id=${rule.id}) matched=$matched", reason)
    }

    fun actionAllowed(action: AgentAction) {
        log(Level.INFO, Category.ACTION_ALLOWED,
            "${action.actionType} allowed (priority=${action.priority})",
            "params=${action.params}")
    }

    fun actionDenied(action: AgentAction, reason: String) {
        log(Level.WARN, Category.ACTION_DENIED,
            "${action.actionType} DENIED", reason)
    }

    fun actionSkipped(action: AgentAction, reason: String) {
        log(Level.DEBUG, Category.ACTION_SKIPPED,
            "${action.actionType} skipped (idempotent)", reason)
    }

    fun actionExecuted(action: AgentAction, success: Boolean, message: String) {
        val cat = if (success) Category.ACTION_EXECUTED else Category.ACTION_FAILED
        val lvl = if (success) Level.INFO else Level.ERROR
        log(lvl, cat, "${action.actionType} → ${if (success) "SUCCESS" else "FAILED"}", message)
    }

    fun moduleState(module: String, status: String, message: String) {
        log(Level.INFO, Category.MODULE_STATE, "$module → $status", message)
    }

    fun system(message: String, level: Level = Level.INFO) {
        log(level, Category.SYSTEM, message)
    }

    // ─── Core ─────────────────────────────────────────────────────────────────

    private fun log(level: Level, category: Category, message: String, detail: String = "") {
        val entry = LogEntry(level = level, category = category, message = message, detail = detail)
        if (buffer.size >= MAX_ENTRIES) buffer.pollFirst()
        buffer.addLast(entry)

        // Also forward to Android logcat
        val logMsg = if (detail.isNotBlank()) "$message | $detail" else message
        when (level) {
            Level.DEBUG -> Log.d(TAG, "[$category] $logMsg")
            Level.INFO  -> Log.i(TAG, "[$category] $logMsg")
            Level.WARN  -> Log.w(TAG, "[$category] $logMsg")
            Level.ERROR -> Log.e(TAG, "[$category] $logMsg")
        }
    }

    // ─── Read ─────────────────────────────────────────────────────────────────

    fun getRecentLogs(limit: Int = 100): List<LogEntry> =
        buffer.toList().takeLast(limit.coerceAtMost(buffer.size))

    fun getLogsByCategory(category: Category, limit: Int = 50): List<LogEntry> =
        buffer.filter { it.category == category }.takeLast(limit)

    fun clearLogs() = buffer.clear()

    fun summary(): String {
        val all = buffer.toList()
        val errors = all.count { it.level == Level.ERROR }
        val warns = all.count { it.level == Level.WARN }
        val matched = all.count { it.category == Category.RULE_MATCHED }
        val executed = all.count { it.category == Category.ACTION_EXECUTED }
        return "Total=${all.size} Errors=$errors Warns=$warns RulesMatched=$matched ActionsExecuted=$executed"
    }
}
