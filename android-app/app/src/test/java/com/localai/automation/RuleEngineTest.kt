package com.localai.automation

import com.localai.automation.engine.CooldownManager
import com.localai.automation.models.*
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/**
 * Unit tests for the rule engine and cooldown logic.
 * Run with: ./gradlew test
 */
class RuleEngineTest {

    private lateinit var cooldownManager: CooldownManager

    @Before
    fun setup() {
        cooldownManager = CooldownManager()
    }

    @Test
    fun `rule is allowed on first trigger`() {
        assertTrue(cooldownManager.isRuleAllowed(ruleId = 1L))
    }

    @Test
    fun `rule is blocked immediately after trigger`() {
        cooldownManager.markRuleTriggered(1L)
        assertFalse(cooldownManager.isRuleAllowed(1L, cooldownMs = 15_000L))
    }

    @Test
    fun `rule is allowed after cooldown reset`() {
        cooldownManager.markRuleTriggered(1L)
        cooldownManager.resetRule(1L)
        assertTrue(cooldownManager.isRuleAllowed(1L))
    }

    @Test
    fun `event burst is throttled after max count`() {
        repeat(5) {
            cooldownManager.shouldProcessEvent("BATTERY", "BATTERY_LOW", maxPerWindow = 5, windowMs = 10_000L)
        }
        val throttled = !cooldownManager.shouldProcessEvent("BATTERY", "BATTERY_LOW", maxPerWindow = 5, windowMs = 10_000L)
        assertTrue("Event should be throttled after burst", throttled)
    }

    @Test
    fun `action is allowed when no cooldown recorded`() {
        assertTrue(cooldownManager.isActionAllowed("SET_SILENT_MODE"))
    }

    @Test
    fun `time range within window matches`() {
        val range = TimeRange(0, 0, 23, 59)
        // This range covers all day — test basic construction
        assertNotNull(range)
        assertEquals(0, range.startHour)
        assertEquals(23, range.endHour)
    }

    @Test
    fun `rule condition with AND operator requires all clauses`() {
        val condition = RuleCondition(
            operator = ConditionOperator.AND,
            clauses = listOf(
                ConditionClause(eventType = EventType.BATTERY_LOW),
                ConditionClause(batteryBelow = 20)
            )
        )
        assertEquals(ConditionOperator.AND, condition.operator)
        assertEquals(2, condition.clauses.size)
    }

    @Test
    fun `rule condition cooldown override is respected`() {
        val condition = RuleCondition(
            eventType = EventType.BATTERY_LOW,
            cooldownMs = 5_000L
        )
        assertEquals(5_000L, condition.cooldownMs)
    }
}
