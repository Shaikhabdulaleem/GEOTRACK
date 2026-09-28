package com.geotrack.mobile.data.remote.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class ProductivityRecordDto(
    @SerialName("employee_id") val employeeId: String? = null,
    @SerialName("work_date") val workDate: String,
    @SerialName("target_units") val targetUnits: Int = 0,
    @SerialName("actual_units") val actualUnits: Int = 0,
    @SerialName("productive_hours") val productiveHours: Double? = null,
    @SerialName("productivity_percent") val productivityPercent: Double? = null,
)
