package com.localai.automation.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import com.localai.automation.data.dao.*
import com.localai.automation.data.entities.*

@Database(
    entities = [
        LocationEntity::class,
        RuleEntity::class,
        EventEntity::class,
        ActionEntity::class,
        PermissionHistoryEntity::class,
        ChatMessageEntity::class
    ],
    version = 2,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {

    abstract fun locationDao(): LocationDao
    abstract fun ruleDao(): RuleDao
    abstract fun eventDao(): EventDao
    abstract fun actionDao(): ActionDao
    abstract fun permissionDao(): PermissionDao
    abstract fun chatDao(): ChatDao

    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        /**
         * v1 → v2: adds triggerReason column to the actions table.
         * Existing rows will have NULL (shown as no reason in the UI).
         */
        private val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL(
                    "ALTER TABLE actions ADD COLUMN triggerReason TEXT"
                )
            }
        }

        fun getInstance(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "local_ai_automation.db"
                )
                    .addMigrations(MIGRATION_1_2)
                    .fallbackToDestructiveMigration()
                    .build()
                INSTANCE = instance
                instance
            }
        }
    }
}