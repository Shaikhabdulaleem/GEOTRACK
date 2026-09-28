package com.geotrack.mobile.data.remote.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class ShiftAssignmentWithShiftDto(
    val id: String,
    @SerialName("employee_id") val employeeId: String? = null,
    @SerialName("shift_id") val shiftId: String? = null,
    @SerialName("work_date") val workDate: String,
    val status: String,
    val shift: ShiftDto? = null
)

@Serializable
data class HolidayDto(
    val id: String,
    @SerialName("holiday_date") val holidayDate: String,
    val name: String,
)

@Serializable
data class LeaveRequestDto(
    val id: String,
    @SerialName("employee_id") val employeeId: String? = null,
    @SerialName("leave_type") val leaveType: String,
    @SerialName("from_date") val fromDate: String,
    @SerialName("to_date") val toDate: String,
    val status: String,
)

@Serializable
data class WeeklyOffDto(
    val id: String,
    @SerialName("employee_id") val employeeId: String? = null,
    @SerialName("effective_from") val effectiveFrom: String? = null,
    @SerialName("effective_to") val effectiveTo: String? = null,
    val weekday: Int,
)
