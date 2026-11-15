package com.geotrack.mobile.database

import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

object DatabaseMigrations {
    val MIGRATION_4_5: Migration = object : Migration(4, 5) {
        override fun migrate(db: SupportSQLiteDatabase) {
            // Preserve every payroll-relevant outbox event while separating
            // bounded transport retries from permanent/reviewable failures.
            db.execSQL("ALTER TABLE offline_attendance_events ADD COLUMN nextAttemptAtEpochMillis INTEGER NOT NULL DEFAULT 0")
            db.execSQL("ALTER TABLE offline_attendance_events ADD COLUMN lastAttemptAtEpochMillis INTEGER")
            db.execSQL("ALTER TABLE offline_attendance_events ADD COLUMN failureClass TEXT")

            // Version 4 used SYNC_FAILED for both temporary and permanent
            // failures. Never replay those ambiguous events automatically;
            // surface them for a person to review instead.
            db.execSQL(
                """
                UPDATE offline_attendance_events
                SET syncStatus = 'REQUIRES_REVIEW',
                    failureClass = 'legacy_sync_failed'
                WHERE syncStatus = 'SYNC_FAILED'
                """.trimIndent(),
            )
        }
    }
}
