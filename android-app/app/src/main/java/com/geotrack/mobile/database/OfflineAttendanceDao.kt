package com.geotrack.mobile.database

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert

@Dao
interface OfflineAttendanceDao {
    @Upsert suspend fun upsert(event: OfflineAttendanceEventEntity)
    @Query(OfflineAttendanceQueries.READY_FOR_SYNC)
    suspend fun readyForSync(nowEpochMillis: Long, maxRetries: Int): List<OfflineAttendanceEventEntity>
    @Query("SELECT * FROM offline_attendance_events WHERE employeeId = :employeeId ORDER BY deviceTimestampEpochMillis DESC")
    suspend fun forEmployee(employeeId: String): List<OfflineAttendanceEventEntity>
    @Query(OfflineAttendanceQueries.DISPLAY_STATUS)
    suspend fun displayStatus(employeeId: String): String?
    @Query("SELECT * FROM offline_attendance_events WHERE employeeId = :employeeId AND actionType = :actionType AND syncStatus IN ('PENDING_SYNC', 'RETRYABLE_FAILURE', 'REAUTHENTICATION_REQUIRED') ORDER BY deviceTimestampEpochMillis DESC LIMIT 1")
    suspend fun pendingAction(employeeId: String, actionType: String): OfflineAttendanceEventEntity?
    @Query("""
        UPDATE offline_attendance_events
        SET syncStatus = :status,
            retryCount = :retryCount,
            lastError = :error,
            serverEventId = :serverEventId,
            updatedAtEpochMillis = :updatedAt,
            nextAttemptAtEpochMillis = :nextAttemptAt,
            lastAttemptAtEpochMillis = :lastAttemptAt,
            failureClass = :failureClass
        WHERE localEventId = :localEventId
    """)
    suspend fun updateStatus(
        localEventId: String,
        status: String,
        retryCount: Int,
        error: String?,
        serverEventId: String?,
        updatedAt: Long,
        nextAttemptAt: Long,
        lastAttemptAt: Long?,
        failureClass: String?,
    )

    @Query("DELETE FROM offline_attendance_events")
    suspend fun clearAll()
}

object OfflineAttendanceQueries {
    const val READY_FOR_SYNC = """
        SELECT * FROM offline_attendance_events
        WHERE syncStatus IN ('PENDING_SYNC', 'RETRYABLE_FAILURE', 'REAUTHENTICATION_REQUIRED')
          AND retryCount < :maxRetries
          AND nextAttemptAtEpochMillis <= :nowEpochMillis
        ORDER BY deviceTimestampEpochMillis
    """

    const val DISPLAY_STATUS = """
        SELECT syncStatus FROM offline_attendance_events
        WHERE employeeId = :employeeId
        ORDER BY CASE
            WHEN syncStatus IN ('REQUIRES_REVIEW', 'PERMANENT_FAILURE', 'REAUTHENTICATION_REQUIRED') THEN 0
            ELSE 1
        END,
        deviceTimestampEpochMillis DESC
        LIMIT 1
    """
}
