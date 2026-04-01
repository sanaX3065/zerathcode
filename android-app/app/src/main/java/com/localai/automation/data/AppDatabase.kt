package com.localai.automation.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import com.localai.automation.data.dao.*
import com.localai.automation.data.entities.*
import com.localai.automation.document.data.DocumentEntity
import com.localai.automation.document.data.DocumentChunkEntity
import com.localai.automation.document.data.DocumentDao
import com.localai.automation.proactive.ProactiveSuggestionEntity
import com.localai.automation.proactive.ProactiveSuggestionDao

@Database(
    entities = [
        LocationEntity::class,
        RuleEntity::class,
        EventEntity::class,
        ActionEntity::class,
        PermissionHistoryEntity::class,
        ChatMessageEntity::class,
        DocumentEntity::class,
        DocumentChunkEntity::class,
        ProactiveSuggestionEntity::class,
    ],
    version = 4,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {

    abstract fun locationDao(): LocationDao
    abstract fun ruleDao(): RuleDao
    abstract fun eventDao(): EventDao
    abstract fun actionDao(): ActionDao
    abstract fun permissionDao(): PermissionDao
    abstract fun chatDao(): ChatDao
    abstract fun documentDao(): DocumentDao
    abstract fun proactiveSuggestionDao(): ProactiveSuggestionDao

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

        /**
         * v2 → v3: adds document and document_chunks tables for Phase 3.
         */
        private val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL("""
                    CREATE TABLE IF NOT EXISTS documents (
                        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        name TEXT NOT NULL,
                        uri TEXT NOT NULL,
                        mimeType TEXT NOT NULL,
                        sizeBytes INTEGER NOT NULL,
                        chunkCount INTEGER NOT NULL DEFAULT 0,
                        charCount INTEGER NOT NULL DEFAULT 0,
                        riskLevel TEXT NOT NULL DEFAULT 'UNKNOWN',
                        riskFlagsJson TEXT NOT NULL DEFAULT '[]',
                        obligationsJson TEXT NOT NULL DEFAULT '[]',
                        summary TEXT NOT NULL DEFAULT '',
                        isProcessed INTEGER NOT NULL DEFAULT 0,
                        createdAt INTEGER NOT NULL,
                        updatedAt INTEGER NOT NULL
                    )
                """.trimIndent())

                database.execSQL("""
                    CREATE TABLE IF NOT EXISTS document_chunks (
                        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        documentId INTEGER NOT NULL,
                        chunkIndex INTEGER NOT NULL,
                        content TEXT NOT NULL,
                        pageNumber INTEGER NOT NULL DEFAULT 0,
                        termFrequencyData TEXT NOT NULL DEFAULT '',
                        charOffset INTEGER NOT NULL DEFAULT 0,
                        FOREIGN KEY (documentId) REFERENCES documents(id) ON DELETE CASCADE
                    )
                """.trimIndent())

                database.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_document_chunks_documentId ON document_chunks(documentId)"
                )
            }
        }

        /**
         * v3 → v4: adds proactive_suggestions table for Phase 4.
         */
        private val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL("""
                    CREATE TABLE IF NOT EXISTS proactive_suggestions (
                        id TEXT PRIMARY KEY NOT NULL,
                        title TEXT NOT NULL,
                        description TEXT NOT NULL,
                        triggerDescription TEXT NOT NULL,
                        actionDescription TEXT NOT NULL,
                        confidence REAL NOT NULL,
                        patternStrength TEXT NOT NULL,
                        conditionJson TEXT NOT NULL,
                        actionJson TEXT NOT NULL,
                        status TEXT NOT NULL DEFAULT 'PENDING',
                        createdAt INTEGER NOT NULL
                    )
                """.trimIndent())
            }
        }

        fun getInstance(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "local_ai_automation.db"
                )
                    .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4)
                    .fallbackToDestructiveMigration()
                    .build()
                INSTANCE = instance
                instance
            }
        }
    }
}