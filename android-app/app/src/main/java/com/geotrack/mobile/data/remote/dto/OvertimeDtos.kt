package com.geotrack.mobile.data.remote.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class OvertimeRecordDto(
    val id: String,
    @SerialName("attendance_record_id") val attendanceRecordId: String,
    @SerialName("requested_minutes") val requestedMinutes: Int = 0,
    @SerialName("approved_minutes") val approvedMinutes: Int? = null,
    val status: String,
    val reason: String? = null,
)

@Serializable
data class OvertimeRecordWithDateDto(
    val id: String,
    @SerialName("attendance_record_id") val attendanceRecordId: String,
    @SerialName("requested_minutes") val requestedMinutes: Int = 0,
    @SerialName("approved_minutes") val approvedMinutes: Int? = null,
    val status: String,
    val reason: String? = null,
    @SerialName("attendance_date") val attendanceDate: String,
)
