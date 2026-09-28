package com.geotrack.mobile.domain.model

import java.time.LocalDate

enum class OvertimeApprovalStatus { PENDING, APPROVED, REJECTED }

data class OvertimeEntry(
    val id: String,
    val date: LocalDate,
    val scheduledMinutes: Int,
    val workedMinutes: Int,
    val calculatedOtMinutes: Int,
    val approvedOtMinutes: Int?,
    val status: OvertimeApprovalStatus,
    val explanation: String?,
)

data class OvertimeSummary(
    val calculatedMinutes: Int = 0,
    val approvedMinutes: Int = 0,
)
