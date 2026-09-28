package com.geotrack.mobile.database

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert

@Dao
interface WorkforceCacheDao {
    @Upsert suspend fun upsertEmployee(profile: CachedEmployeeProfileEntity)
    @Query("SELECT * FROM cached_employee_profiles WHERE organizationId = :organizationId AND employeeId = :employeeId LIMIT 1")
    suspend fun employee(organizationId: String, employeeId: String): CachedEmployeeProfileEntity?

    @Upsert suspend fun upsertSchedules(rows: List<CachedScheduleEntity>)
    @Query("SELECT * FROM cached_schedules WHERE employeeId = :employeeId AND workDate BETWEEN :fromDate AND :toDate ORDER BY workDate")
    suspend fun schedules(employeeId: String, fromDate: String, toDate: String): List<CachedScheduleEntity>

    @Upsert suspend fun upsertGeofence(row: CachedGeofenceEntity)
    @Query("SELECT * FROM cached_geofences WHERE employeeId = :employeeId ORDER BY cachedAt DESC")
    suspend fun geofences(employeeId: String): List<CachedGeofenceEntity>

    @Upsert suspend fun upsertAttendance(rows: List<CachedAttendanceEntity>)
    @Query("SELECT * FROM cached_attendance WHERE employeeId = :employeeId ORDER BY attendanceDate DESC, sessionNumber DESC LIMIT :limit")
    suspend fun recentAttendance(employeeId: String, limit: Int): List<CachedAttendanceEntity>

    @Upsert suspend fun upsertNotifications(rows: List<CachedNotificationEntity>)
    @Query("SELECT * FROM cached_notifications WHERE recipientUserId = :userId ORDER BY cachedAt DESC")
    suspend fun notifications(userId: String): List<CachedNotificationEntity>

    @Query("DELETE FROM cached_employee_profiles")
    suspend fun clearEmployees()

    @Query("DELETE FROM cached_schedules")
    suspend fun clearSchedules()

    @Query("DELETE FROM cached_geofences")
    suspend fun clearGeofences()

    @Query("DELETE FROM cached_attendance")
    suspend fun clearAttendance()

    @Query("DELETE FROM cached_notifications")
    suspend fun clearNotifications()

    suspend fun clearAll() {
        clearEmployees()
        clearSchedules()
        clearGeofences()
        clearAttendance()
        clearNotifications()
    }
}
