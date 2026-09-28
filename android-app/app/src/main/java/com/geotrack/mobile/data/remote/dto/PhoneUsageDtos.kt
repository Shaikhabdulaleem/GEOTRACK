package com.geotrack.mobile.data.remote.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class PhoneUsageRecordDto(
    val id: String? = null,
    @SerialName("work_date") val workDate: String,
    @SerialName("shift_assignment_id") val shiftAssignmentId: String? = null,
    @SerialName("active_minutes") val activeMinutes: Int = 0,
    @SerialName("within_shift_minutes") val withinShiftMinutes: Int = 0,
    @SerialName("total_shift_minutes") val totalShiftMinutes: Int? = null,
    @SerialName("usage_percentage") val usagePercentage: Double? = null,
    @SerialName("synced_at") val syncedAt: String? = null,
    val source: String? = null,
    @SerialName("consent_version") val consentVersion: String? = null,
)
