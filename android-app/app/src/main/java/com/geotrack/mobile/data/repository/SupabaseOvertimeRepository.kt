package com.geotrack.mobile.data.repository

import com.geotrack.mobile.core.common.AppError
import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.data.remote.dto.AttendanceRecordDto
import com.geotrack.mobile.data.remote.dto.OvertimeRecordDto
import com.geotrack.mobile.data.remote.dto.ResolvedScheduleDto
import com.geotrack.mobile.data.remote.supabase.SupabaseClientHolder
import com.geotrack.mobile.domain.model.OvertimeApprovalStatus
import com.geotrack.mobile.domain.model.OvertimeEntry
import com.geotrack.mobile.domain.repository.OvertimeRepository
import io.github.jan.supabase.postgrest.postgrest
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Duration
import java.time.LocalDate
import java.time.LocalTime
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SupabaseOvertimeRepository @Inject constructor(
    private val holder: SupabaseClientHolder,
) : OvertimeRepository {
    override suspend fun list(
        organizationId: String,
        employeeId: String,
        startDate: LocalDate,
        endDate: LocalDate,
    ): AppResult<List<OvertimeEntry>> {
        val client = holder.client ?: return AppResult.Failure(AppError.Configuration("Supabase not configured"))
        return try {
            val overtime = client.postgrest["overtime_records"].select {
                filter {
                    eq("organization_id", organizationId)
                    eq("employee_id", employeeId)
                }
            }.decodeList<OvertimeRecordDto>()

            if (overtime.isEmpty()) return AppResult.Success(emptyList())
            val attendance = client.postgrest["attendance_records"].select {
                filter {
                    eq("organization_id", organizationId)
                    eq("employee_id", employeeId)
                    gte("attendance_date", startDate.toString())
                    lte("attendance_date", endDate.toString())
                }
            }.decodeList<AttendanceRecordDto>()
            val attendanceById = attendance.associateBy { it.id }
            val schedulesByDate = client.postgrest.rpc(
                "resolve_employee_schedule",
                buildJsonObject { put("p_employee_id", employeeId); put("p_start_date", startDate.toString()); put("p_end_date", endDate.toString()) },
            ).decodeList<ResolvedScheduleDto>().associateBy { it.workDate }

            AppResult.Success(overtime.mapNotNull { record ->
                val att = attendanceById[record.attendanceRecordId] ?: return@mapNotNull null
                val date = LocalDate.parse(att.attendanceDate)
                val shift = schedulesByDate[date.toString()]
                OvertimeEntry(
                    id = record.id,
                    date = date,
                    scheduledMinutes = shift?.scheduledMinutes() ?: 0,
                    workedMinutes = att.workedMinutes,
                    calculatedOtMinutes = record.requestedMinutes,
                    approvedOtMinutes = record.approvedMinutes,
                    status = when (record.status.lowercase()) {
                        "approved" -> OvertimeApprovalStatus.APPROVED
                        "rejected" -> OvertimeApprovalStatus.REJECTED
                        else -> OvertimeApprovalStatus.PENDING
                    },
                    explanation = record.reason,
                )
            }.sortedByDescending { it.date })
        } catch (e: Exception) {
            AppResult.Failure(AppError.Network(e.message ?: "Unable to load overtime", e))
        }
    }

    override suspend fun requestExplanation(overtimeId: String, explanation: String): AppResult<Unit> {
        val trimmed = explanation.trim()
        if (trimmed.isBlank()) return AppResult.Failure(AppError.Unknown("Please enter an explanation."))
        if (trimmed.length > 2000) return AppResult.Failure(AppError.Unknown("Explanation must be 2,000 characters or fewer."))
        val client = holder.client ?: return AppResult.Failure(AppError.Configuration("Supabase not configured"))
        return try {
            client.postgrest.rpc(
                "request_overtime_explanation",
                buildJsonObject { put("p_overtime_id", overtimeId); put("p_reason", trimmed) },
            )
            AppResult.Success(Unit)
        } catch (e: Exception) {
            AppResult.Failure(AppError.Network(e.message ?: "Unable to submit overtime explanation", e))
        }
    }

    private fun ResolvedScheduleDto.scheduledMinutes(): Int {
        val start = startTime?.let { LocalTime.parse(it.take(8)) } ?: return 0
        val end = endTime?.let { LocalTime.parse(it.take(8)) } ?: return 0
        var minutes = Duration.between(start, end).toMinutes().toInt()
        if (minutes <= 0 || crossesMidnight) minutes += 24 * 60
        return (minutes - (breakMinutes ?: 0)).coerceAtLeast(0)
    }
}
