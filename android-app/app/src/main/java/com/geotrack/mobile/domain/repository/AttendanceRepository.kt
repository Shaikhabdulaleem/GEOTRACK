package com.geotrack.mobile.domain.repository

import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.domain.model.DailyAttendance
import java.time.LocalDate

interface AttendanceRepository {
    suspend fun getAttendanceForDate(organizationId: String, employeeId: String, date: LocalDate): AppResult<DailyAttendance?>
    
    suspend fun getAttendanceWindow(organizationId: String, employeeId: String, startDate: LocalDate, endDate: LocalDate): AppResult<List<DailyAttendance>>
    
    suspend fun checkIn(
        organizationId: String, 
        employeeId: String, 
        latitude: Double, 
        longitude: Double, 
        accuracyMeters: Float,
        isMock: Boolean,
        isAuto: Boolean = false
    ): AppResult<Unit>
    
    suspend fun checkOut(
        organizationId: String, 
        employeeId: String, 
        latitude: Double, 
        longitude: Double, 
        accuracyMeters: Float,
        isMock: Boolean,
        isAuto: Boolean = false
    ): AppResult<Unit>

    /** Local outbox state for the most recent employee action: SYNCED, PENDING_SYNC, or SYNC_FAILED. */
    suspend fun latestLocalSyncStatus(employeeId: String): String?

    /**
     * Posts a periodic in-shift location sample so the server can detect
     * sustained out-of-geofence breaches. The server only stores it while an
     * attendance session is open and never auto-checks-out from it. Returns true
     * when a sample was actually recorded.
     */
    suspend fun recordLocationPing(
        organizationId: String,
        employeeId: String,
        latitude: Double,
        longitude: Double,
        accuracyMeters: Float,
        isMock: Boolean
    ): AppResult<Boolean>
}
