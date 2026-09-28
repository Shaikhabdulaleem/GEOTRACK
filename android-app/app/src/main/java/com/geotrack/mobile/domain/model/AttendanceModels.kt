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
