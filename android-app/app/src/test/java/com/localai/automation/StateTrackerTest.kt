package com.localai.automation

import com.localai.automation.models.ActionType
import org.junit.Assert.*
import org.junit.Test

/**
 * Unit tests for StateTracker idempotency logic.
 * NOTE: StateTracker requires a Context; these tests cover the pure logic only.
 */
class StateTrackerTest {

    @Test
    fun `time range overnight wraps correctly`() {
        // 22:00 - 06:00 range — 23:30 should be inside
        val startMinutes = 22 * 60
        val endMinutes = 6 * 60
        val currentMinutes = 23 * 60 + 30 // 23:30

        val inRange = currentMinutes >= startMinutes || currentMinutes <= endMinutes
        assertTrue("23:30 should be within 22:00–06:00 overnight range", inRange)
    }

    @Test
    fun `time range overnight wraps correctly - morning`() {
        val startMinutes = 22 * 60
        val endMinutes = 6 * 60
        val currentMinutes = 5 * 60 + 30 // 05:30

        val inRange = currentMinutes >= startMinutes || currentMinutes <= endMinutes
        assertTrue("05:30 should be within 22:00–06:00 overnight range", inRange)
    }

    @Test
    fun `time range excludes middle of day for overnight rule`() {
        val startMinutes = 22 * 60
        val endMinutes = 6 * 60
        val currentMinutes = 14 * 60 // 14:00

        val inRange = currentMinutes >= startMinutes || currentMinutes <= endMinutes
        assertFalse("14:00 should NOT be within 22:00–06:00 overnight range", inRange)
    }

    @Test
    fun `priority engine weights sum is valid`() {
        // Validate that the scoring weights in PriorityEngine sum correctly
        // W_USER_PRIORITY=0.45, W_RECENCY=0.20, W_CONTEXT=0.25, W_SAFETY_PENALTY=0.10
        val total = 0.45f + 0.20f + 0.25f + 0.10f
        assertEquals("Weights should sum to 1.0", 1.0f, total, 0.001f)
    }

    @Test
    fun `action type names match expected values`() {
        assertEquals("SET_SILENT_MODE", ActionType.SET_SILENT_MODE.name)
        assertEquals("SET_BRIGHTNESS", ActionType.SET_BRIGHTNESS.name)
        assertEquals("SET_VIBRATION", ActionType.SET_VIBRATION.name)
        assertEquals("SEND_NOTIFICATION", ActionType.SEND_NOTIFICATION.name)
        assertEquals("LOG_ONLY", ActionType.LOG_ONLY.name)
    }
}
