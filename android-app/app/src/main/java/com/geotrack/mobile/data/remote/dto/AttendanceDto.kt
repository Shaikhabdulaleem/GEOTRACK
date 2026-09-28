package com.geotrack.mobile.data.remote.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class AttendanceRecordDto(
    val id: String,
    @SerialName("employee_id") val employeeId: String? = null,
    @SerialName("attendance_date") val attendanceDate: String,
    @SerialName("check_in_at") val checkInAt: String? = null,
    @SerialName("check_out_at") val checkOutAt: String? = null,
    val status: String,
    val source: String,
    @SerialName("worked_minutes") val workedMinutes: Int = 0,
    @SerialName("overtime_minutes") val overtimeMinutes: Int = 0,
    @SerialName("late_minutes") val lateMinutes: Int = 0,
    @SerialName("geofence_validated") val geofenceValidated: Boolean = false,
)
