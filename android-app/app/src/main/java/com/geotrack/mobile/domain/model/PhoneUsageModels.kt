package com.geotrack.mobile.domain.model

import java.time.Instant
import java.time.LocalDate

enum class PhoneUsageDataStatus { PERMISSION_GRANTED, PERMISSION_NOT_GRANTED, NO_DATA, PARTIAL_DATA }

data class PhoneUsageSummary(
    val date: LocalDate,
    val shiftAssignmentId: String?,
    val shiftName: String?,
    val totalShiftMinutes: Int,
    val phoneUsageMinutes: Int?,
    val usagePercentage: Double?,
    val syncedAt: Instant?,
    val status: PhoneUsageDataStatus,
)
