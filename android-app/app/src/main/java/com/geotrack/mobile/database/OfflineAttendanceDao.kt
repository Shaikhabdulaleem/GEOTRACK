package com.geotrack.mobile.database

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert

@Dao
interface OfflineAttendanceDao {
    @Upsert suspend fun upsert(event: OfflineAttendanceEventEntity)
    @Query("SELECT * FROM offline_attendance_events WHERE syncStatus IN ('PENDING_SYNC','SYNC_FAILED') ORDER BY deviceTimestampEpochMillis")
    suspend fun pending(): List<OfflineAttendanceEventEntity>
    @Query("SELECT * FROM offline_attendance_events WHERE employeeId = :employeeId ORDER BY deviceTimestampEpochMillis DESC")
    suspend fun forEmployee(employeeId: String): List<OfflineAttendanceEventEntity>
    @Query("SELECT * FROM offline_attendance_events WHERE employeeId = :employeeId AND actionType = :actionType AND syncStatus = 'PENDING_SYNC' ORDER BY deviceTimestampEpochMillis DESC LIMIT 1")
    suspend fun pendingAction(employeeId: String, actionType: String): OfflineAttendanceEventEntity?
    @Query("UPDATE offline_attendance_events SET syncStatus = :status, retryCount = :retryCount, lastError = :error, serverEventId = :serverEventId, updatedAtEpochMillis = :updatedAt WHERE localEventId = :localEventId")
    suspend fun updateStatus(localEventId: String, status: String, retryCount: Int, error: String?, serverEventId: String?, updatedAt: Long)

    @Query("DELETE FROM offline_attendance_events")
    suspend fun clearAll()
}
