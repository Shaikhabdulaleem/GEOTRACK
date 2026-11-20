package com.geotrack.mobile.database

import android.content.Context
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class OfflineAttendanceMigrationTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val databaseName = "offline-attendance-migration-test.db"

    @After
    fun tearDown() {
        context.deleteDatabase(databaseName)
    }

    @Test
    fun version4FailuresBecomeVisibleReviewEventsAndAreNotReplayed() {
        createVersion4Database()

        val helper = openVersion5Database()
        val db = helper.writableDatabase

        val failed = event(db, "failed-event")
        assertEquals("failed-event", failed["localEventId"])
        assertEquals("check_out", failed["actionType"])
        assertEquals(1_000L, failed["deviceTimestampEpochMillis"])
        assertEquals("2026-11-12T08:00:00Z", failed["originalEventTime"])
        assertEquals("REQUIRES_REVIEW", failed["syncStatus"])
        assertEquals(4L, failed["retryCount"])
        assertEquals("server rejected event", failed["lastError"])
        assertEquals("server-failed", failed["serverEventId"])
        assertEquals(1_100L, failed["updatedAtEpochMillis"])
        assertEquals("legacy_sync_failed", failed["failureClass"])
        assertEquals(0L, failed["nextAttemptAtEpochMillis"])
        assertNull(failed["lastAttemptAtEpochMillis"])

        // A newer successful event must not hide the older review item.
        assertEquals("REQUIRES_REVIEW", displayStatus(db, "employee-1"))

        val replayIds = readyForSync(db, nowEpochMillis = 10_000L, maxRetries = 10)
        assertEquals(listOf("pending-event"), replayIds)
        assertFalse(replayIds.contains("failed-event"))

        assertEquals("PENDING_SYNC", event(db, "pending-event")["syncStatus"])
        assertEquals("SYNCED", event(db, "synced-event")["syncStatus"])
        assertEquals("server-synced", event(db, "synced-event")["serverEventId"])

        helper.close()
    }

    private fun createVersion4Database() {
        context.deleteDatabase(databaseName)
        val helper = helper(object : SupportSQLiteOpenHelper.Callback(4) {
            override fun onCreate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    CREATE TABLE offline_attendance_events (
                        localEventId TEXT NOT NULL PRIMARY KEY,
                        organizationId TEXT NOT NULL,
                        employeeId TEXT NOT NULL,
                        actionType TEXT NOT NULL,
                        deviceTimestampEpochMillis INTEGER NOT NULL,
                        originalEventTime TEXT NOT NULL,
                        latitude REAL NOT NULL,
                        longitude REAL NOT NULL,
                        accuracyMeters REAL NOT NULL,
                        isMockLocation INTEGER NOT NULL,
                        geofenceValidation TEXT NOT NULL,
                        syncStatus TEXT NOT NULL,
                        retryCount INTEGER NOT NULL,
                        lastError TEXT,
                        serverEventId TEXT,
                        updatedAtEpochMillis INTEGER NOT NULL,
                        geofenceId TEXT
                    )
                    """.trimIndent(),
                )
                insertEvent(db, "failed-event", "check_out", 1_000, "SYNC_FAILED", 4, "server rejected event", "server-failed", 1_100)
                insertEvent(db, "pending-event", "check_in", 2_000, "PENDING_SYNC", 2, "offline", null, 2_100)
                insertEvent(db, "synced-event", "check_in", 3_000, "SYNCED", 0, null, "server-synced", 3_100)
            }

            override fun onUpgrade(db: SupportSQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit
        })
        helper.writableDatabase
        helper.close()
    }

    private fun openVersion5Database(): SupportSQLiteOpenHelper = helper(
        object : SupportSQLiteOpenHelper.Callback(5) {
            override fun onCreate(db: SupportSQLiteDatabase) = error("Expected a version 4 database")

            override fun onUpgrade(db: SupportSQLiteDatabase, oldVersion: Int, newVersion: Int) {
                assertEquals(4, oldVersion)
                assertEquals(5, newVersion)
                DatabaseMigrations.MIGRATION_4_5.migrate(db)
            }
        },
    )

    private fun helper(callback: SupportSQLiteOpenHelper.Callback): SupportSQLiteOpenHelper =
        FrameworkSQLiteOpenHelperFactory().create(
            SupportSQLiteOpenHelper.Configuration.builder(context)
                .name(databaseName)
                .callback(callback)
                .build(),
        )

    private fun insertEvent(
        db: SupportSQLiteDatabase,
        id: String,
        action: String,
        timestamp: Long,
        status: String,
        retryCount: Int,
        error: String?,
        serverId: String?,
        updatedAt: Long,
    ) {
        db.execSQL(
            """
            INSERT INTO offline_attendance_events VALUES
            (?, 'org-1', 'employee-1', ?, ?, '2026-11-12T08:00:00Z', 24.7, 46.7, 8.0, 0,
             'pending_server_validation', ?, ?, ?, ?, ?, 'geofence-1')
            """.trimIndent(),
            arrayOf(id, action, timestamp, status, retryCount, error, serverId, updatedAt),
        )
    }

    private fun event(db: SupportSQLiteDatabase, id: String): Map<String, Any?> {
        db.query("SELECT * FROM offline_attendance_events WHERE localEventId = ?", arrayOf(id)).use { cursor ->
            assertTrue(cursor.moveToFirst())
            return cursor.columnNames.associateWith { column ->
                val index = cursor.getColumnIndexOrThrow(column)
                when (cursor.getType(index)) {
                    android.database.Cursor.FIELD_TYPE_NULL -> null
                    android.database.Cursor.FIELD_TYPE_INTEGER -> cursor.getLong(index)
                    android.database.Cursor.FIELD_TYPE_FLOAT -> cursor.getDouble(index)
                    else -> cursor.getString(index)
                }
            }
        }
    }

    private fun displayStatus(db: SupportSQLiteDatabase, employeeId: String): String? {
        val sql = OfflineAttendanceQueries.DISPLAY_STATUS.replace(":employeeId", "?")
        db.query(sql, arrayOf(employeeId)).use { cursor ->
            return if (cursor.moveToFirst()) cursor.getString(0) else null
        }
    }

    private fun readyForSync(db: SupportSQLiteDatabase, nowEpochMillis: Long, maxRetries: Int): List<String> {
        val sql = OfflineAttendanceQueries.READY_FOR_SYNC
            .replace(":maxRetries", "?")
            .replace(":nowEpochMillis", "?")
        db.query(sql, arrayOf(maxRetries, nowEpochMillis)).use { cursor ->
            val ids = mutableListOf<String>()
            while (cursor.moveToNext()) ids += cursor.getString(cursor.getColumnIndexOrThrow("localEventId"))
            return ids
        }
    }
}
