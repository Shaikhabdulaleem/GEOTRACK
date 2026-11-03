package com.geotrack.mobile.domain.model

import java.time.LocalDate

data class DailyAttendance(
    val date: LocalDate,
    val checkInAt: String?,
    val checkOutAt: String?,
    val status: String,
    val source: String,
    val workedMinutes: Int,
    val overtimeMinutes: Int,
    val lateMinutes: Int,
    val geofenceValidated: Boolean
)

data class AttendanceLocationResult(
    val locationEventId: String? = null,
    val attendanceRecordId: String? = null,
    val insideGeofence: Boolean? = null,
    val position: String = "unknown",
    val outcome: String,
    val checkoutAt: String? = null,
    val overtimeMinutes: Int = 0,
    val reason: String? = null,
) {
    val checkoutCompleted: Boolean get() = outcome == "checkout_completed"
    val queuedOffline: Boolean get() = outcome == "queued_offline"
}
