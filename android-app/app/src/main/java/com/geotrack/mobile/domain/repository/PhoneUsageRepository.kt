package com.geotrack.mobile.domain.repository

import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.domain.model.PhoneUsageSummary
import java.time.LocalDate

data class PhoneUsageSyncInput(
    val organizationId: String,
    val employeeId: String,
    val deviceId: String,
    val date: LocalDate,
    val shiftAssignmentId: String?,
    val totalShiftMinutes: Int,
    val phoneUsageMinutes: Int?,
    val usagePercentage: Double?,
    val status: String,
    val consentVersion: String,
)

interface PhoneUsageRepository {
    suspend fun sync(input: PhoneUsageSyncInput): AppResult<Unit>
    suspend fun listOwn(organizationId: String, employeeId: String, startDate: LocalDate, endDate: LocalDate): AppResult<List<PhoneUsageSummary>>
}
