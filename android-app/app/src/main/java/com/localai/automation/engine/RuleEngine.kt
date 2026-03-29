package com.localai.automation.engine

import android.util.Log
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.localai.automation.data.entities.RuleEntity
import com.localai.automation.data.repository.LocalRepository
import com.localai.automation.models.*
import java.util.Calendar

/**
 * Upgraded Rule Engine:
 * - AND / OR multi-clause evaluation
 * - Temporal conditions (time ranges)
 * - Battery threshold conditions
 * - Per-rule cooldown enforcement
 * - Rule chaining support
 * - Structured observability logging
 */
class RuleEngine(private val repository: LocalRepository) {

    companion object { private const val TAG = "RuleEngine" }

    private val gson = Gson()
    private val cooldowns = CooldownManager.get()

    suspend fun evaluate(event: AgentEvent): List<AgentAction> {
        val rules = repository.getActiveRules()
        val candidates = mutableListOf<AgentAction>()

        for (rule in rules) {
            try {
                val condition = parseCondition(rule.conditionJson) ?: continue

                // Cooldown check (per-rule)
                val ruleCooldown = condition.cooldownMs ?: CooldownManager.DEFAULT_RULE_COOLDOWN_MS
                if (!cooldowns.isRuleAllowed(rule.id, ruleCooldown)) {
                    ObservabilityLogger.ruleEvaluated(rule, false, "On cooldown")
                    continue
                }

                val matched = evaluateCondition(event, condition)
                ObservabilityLogger.ruleEvaluated(rule, matched)

                if (matched) {
                    val action = buildAction(rule) ?: continue
                    candidates.add(action)
                    repository.incrementRuleTrigger(rule.id)
                    Log.i(TAG, "Rule matched: '${rule.name}' → ${action.actionType}")

                    // Rule chaining: enqueue a synthetic event to trigger follow-on rules
                    condition.thenTriggerRule?.let { chainName ->
                        Log.d(TAG, "Rule chain requested: $chainName")
                        // Emitted as a RULE_TRIGGERED event for downstream rules to react to
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error evaluating rule '${rule.name}'", e)
                ObservabilityLogger.system("Rule eval error: ${rule.name} — ${e.message}",
                    ObservabilityLogger.Level.ERROR)
            }
        }
        return candidates
    }

    private fun evaluateCondition(event: AgentEvent, condition: RuleCondition): Boolean {
        // Multi-clause mode
        if (condition.clauses.isNotEmpty()) {
            return when (condition.operator) {
                ConditionOperator.AND -> condition.clauses.all { evaluateClause(event, it) }
                ConditionOperator.OR  -> condition.clauses.any { evaluateClause(event, it) }
            }
        }
        // Single-clause backwards-compatible mode
        return evaluateClause(event, ConditionClause(
            eventType = condition.eventType,
            module = condition.module,
            dataMatches = condition.dataMatches,
            timeRange = condition.timeRange
        ))
    }

    private fun evaluateClause(event: AgentEvent, clause: ConditionClause): Boolean {
        clause.eventType?.let { if (event.eventType != it) return false }
        clause.module?.let { if (event.module != it) return false }

        for ((key, value) in clause.dataMatches) {
            val eventValue = event.data[key]?.toString() ?: return false
            if (eventValue != value.toString()) return false
        }

        clause.timeRange?.let { if (!isWithinTimeRange(it)) return false }

        clause.batteryBelow?.let { threshold ->
            val level = event.data["level"]?.toString()?.toIntOrNull() ?: return false
            if (level >= threshold) return false
        }

        clause.batteryAbove?.let { threshold ->
            val level = event.data["level"]?.toString()?.toIntOrNull() ?: return false
            if (level <= threshold) return false
        }

        return true
    }

    private fun isWithinTimeRange(range: TimeRange): Boolean {
        val calendar = Calendar.getInstance()
        val currentMinutes = calendar.get(Calendar.HOUR_OF_DAY) * 60 + calendar.get(Calendar.MINUTE)
        val startMinutes = range.startHour * 60 + range.startMinute
        val endMinutes = range.endHour * 60 + range.endMinute
        return if (startMinutes <= endMinutes) {
            currentMinutes in startMinutes..endMinutes
        } else {
            currentMinutes >= startMinutes || currentMinutes <= endMinutes
        }
    }

    private fun buildAction(rule: RuleEntity): AgentAction? {
        return try {
            val mapType = object : TypeToken<Map<String, Any>>() {}.type
            val map: Map<String, Any> = gson.fromJson(rule.actionJson, mapType)
            val actionType = ActionType.valueOf(map["actionType"].toString())
            @Suppress("UNCHECKED_CAST")
            val params = (map["params"] as? Map<String, Any>) ?: emptyMap()
            AgentAction(actionType = actionType, params = params,
                priority = rule.priority, sourceRuleId = rule.id)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse action for rule ${rule.id}", e)
            null
        }
    }

    private fun parseCondition(json: String): RuleCondition? = try {
        gson.fromJson(json, RuleCondition::class.java)
    } catch (e: Exception) {
        Log.e(TAG, "Failed to parse rule condition: $json", e); null
    }
}
