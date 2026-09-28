package com.geotrack.mobile.database

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "offline_attendance_events")
data class OfflineAttendanceEventEntity(
    @PrimaryKey val localEventId: String,
    val organizationId: String,
    val employeeId: String,
    val actionType: String,
    val deviceTimestampEpochMillis: Long,
    val originalEventTime: String,
    val latitude: Double,
    val longitude: Double,
    val accuracyMeters: Float,
    val isMockLocation: Boolean,
    /** The server-side geofence assignment selected while online or from cache. */
    val geofenceId: String? = null,
    val geofenceValidation: String,
    val syncStatus: String,
    val retryCount: Int = 0,
    val lastError: String? = null,
    val serverEventId: String? = null,
    val updatedAtEpochMillis: Long,
)
