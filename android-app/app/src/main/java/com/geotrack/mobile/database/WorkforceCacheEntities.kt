package com.geotrack.mobile.database

import androidx.room.Entity

@Entity(tableName = "cached_employee_profiles", primaryKeys = ["organizationId", "employeeId"])
data class CachedEmployeeProfileEntity(val organizationId: String, val employeeId: String, val fullName: String, val employeeCode: String, val branchId: String, val departmentId: String, val employmentStatus: String, val cachedAt: Long)

@Entity(tableName = "cached_schedules", primaryKeys = ["employeeId", "workDate"])
data class CachedScheduleEntity(val employeeId: String, val workDate: String, val state: String, val assignmentId: String?, val shiftName: String?, val startTime: String?, val endTime: String?, val crossesMidnight: Boolean, val cachedAt: Long)

@Entity(tableName = "cached_geofences", primaryKeys = ["employeeId", "geofenceId"])
data class CachedGeofenceEntity(val employeeId: String, val geofenceId: String, val name: String, val polygonJson: String, val effectiveFrom: String?, val effectiveTo: String?, val cachedAt: Long)

@Entity(tableName = "cached_attendance", primaryKeys = ["employeeId", "attendanceDate", "sessionNumber"])
data class CachedAttendanceEntity(val employeeId: String, val attendanceDate: String, val sessionNumber: Int, val status: String, val checkInAt: String?, val checkOutAt: String?, val workedMinutes: Int, val overtimeMinutes: Int, val syncStatus: String, val cachedAt: Long)

@Entity(tableName = "cached_notifications", primaryKeys = ["notificationId"])
data class CachedNotificationEntity(val notificationId: String, val recipientUserId: String, val title: String, val body: String, val notificationType: String, val readAt: String?, val createdAt: String?, val cachedAt: Long)
