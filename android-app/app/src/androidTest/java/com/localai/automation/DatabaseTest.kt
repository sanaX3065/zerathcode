package com.localai.automation

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.localai.automation.data.AppDatabase
import com.localai.automation.data.entities.RuleEntity
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Instrumented Room database tests.
 * Run with: ./gradlew connectedAndroidTest
 */
@RunWith(AndroidJUnit4::class)
class DatabaseTest {

    private lateinit var db: AppDatabase

    @Before
    fun createDb() {
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        db = Room.inMemoryDatabaseBuilder(ctx, AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()
    }

    @After
    fun closeDb() = db.close()

    @Test
    fun insertAndReadRule() = runBlocking {
        val rule = RuleEntity(
            name = "Test Rule",
            conditionJson = """{"eventType":"BATTERY_LOW"}""",
            actionJson = """{"actionType":"SET_SILENT_MODE","params":{"mode":"SILENT"}}""",
            priority = 0.8f
        )
        val id = db.ruleDao().insertRule(rule)
        assertTrue("Rule ID should be > 0", id > 0)

        val fetched = db.ruleDao().getRuleById(id)
        assertNotNull("Fetched rule should not be null", fetched)
        assertEquals("Test Rule", fetched!!.name)
        assertEquals(0.8f, fetched.priority, 0.001f)
    }

    @Test
    fun ruleEnabledToggle() = runBlocking {
        val rule = RuleEntity(
            name = "Toggle Rule",
            conditionJson = """{"eventType":"CHARGING_STARTED"}""",
            actionJson = """{"actionType":"LOG_ONLY","params":{}}"""
        )
        val id = db.ruleDao().insertRule(rule)
        db.ruleDao().setRuleEnabled(id, false)

        val active = db.ruleDao().getActiveRules()
        assertTrue("Disabled rule should not appear in active rules",
            active.none { it.id == id })
    }

    @Test
    fun triggerCountIncrement() = runBlocking {
        val rule = RuleEntity(
            name = "Counter Rule",
            conditionJson = "{}",
            actionJson = "{}"
        )
        val id = db.ruleDao().insertRule(rule)
        db.ruleDao().incrementTriggerCount(id, System.currentTimeMillis())
        db.ruleDao().incrementTriggerCount(id, System.currentTimeMillis())

        val fetched = db.ruleDao().getRuleById(id)
        assertEquals("Trigger count should be 2", 2, fetched?.triggerCount)
    }
}
