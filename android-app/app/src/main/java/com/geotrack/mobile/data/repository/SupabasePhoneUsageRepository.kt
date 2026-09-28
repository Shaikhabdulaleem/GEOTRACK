package com.geotrack.mobile.data.repository

import com.geotrack.mobile.core.common.AppError
import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.data.remote.dto.PhoneUsageRecordDto
import com.geotrack.mobile.data.remote.supabase.SupabaseClientHolder
import com.geotrack.mobile.domain.model.PhoneUsageDataStatus
import com.geotrack.mobile.domain.model.PhoneUsageSummary
import com.geotrack.mobile.domain.repository.PhoneUsageRepository
import com.geotrack.mobile.domain.repository.PhoneUsageSyncInput
import io.github.jan.supabase.postgrest.postgrest
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Instant
import java.time.LocalDate
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SupabasePhoneUsageRepository @Inject constructor(
    private val holder: SupabaseClientHolder,
) : PhoneUsageRepository {
    override suspend fun sync(input: PhoneUsageSyncInput): AppResult<Unit> {
        val client = holder.client ?: return AppResult.Failure(AppError.Configuration("Supabase not configured"))
        return try {
            client.postgrest.rpc(
                "upsert_phone_usage_summary",
                buildJsonObject {
                    put("p_organization_id", input.organizationId)
                    put("p_employee_id", input.employeeId)
                    put("p_device_id", input.deviceId)
                    put("p_work_date", input.date.toString())
                    put("p_shift_assignment_id", input.shiftAssignmentId)
                    put("p_active_minutes", input.phoneUsageMinutes ?: 0)
                    put("p_within_shift_minutes", input.phoneUsageMinutes ?: 0)
                    put("p_total_shift_minutes", input.totalShiftMinutes)
                    put("p_usage_percentage", input.usagePercentage)
                    put("p_source", "android_usage_stats_${input.status}")
                    put("p_consent_version", input.consentVersion)
                    put("p_synced_at", Instant.now().toString())
                },
            )
            AppResult.Success(Unit)
        } catch (e: Exception) {
            AppResult.Failure(AppError.Network(e.message ?: "Unable to sync phone usage", e))
        }
    }

    override suspend fun listOwn(organizationId: String, employeeId: String, startDate: LocalDate, endDate: LocalDate): AppResult<List<PhoneUsageSummary>> {
        val client = holder.client ?: return AppResult.Failure(AppError.Configuration("Supabase not configured"))
        return try {
            val rows = client.postgrest["phone_usage_records"].select {
                filter {
                    eq("organization_id", organizationId)
                    eq("employee_id", employeeId)
                    gte("work_date", startDate.toString())
                    lte("work_date", endDate.toString())
                }
            }.decodeList<PhoneUsageRecordDto>()
            AppResult.Success(rows.map { row ->
                val status = when {
                    row.source?.endsWith("permission_not_granted") == true -> PhoneUsageDataStatus.PERMISSION_NOT_GRANTED
                    row.source?.endsWith("no_data") == true -> PhoneUsageDataStatus.NO_DATA
                    row.source?.endsWith("partial_data") == true -> PhoneUsageDataStatus.PARTIAL_DATA
                    else -> PhoneUsageDataStatus.PERMISSION_GRANTED
                }
                PhoneUsageSummary(
                    date = LocalDate.parse(row.workDate),
                    shiftAssignmentId = row.shiftAssignmentId,
                    shiftName = null,
                    totalShiftMinutes = row.totalShiftMinutes ?: 0,
                    phoneUsageMinutes = if (status == PhoneUsageDataStatus.NO_DATA || status == PhoneUsageDataStatus.PERMISSION_NOT_GRANTED) null else row.withinShiftMinutes,
                    usagePercentage = row.usagePercentage,
                    syncedAt = row.syncedAt?.let { runCatching { Instant.parse(it) }.getOrNull() },
                    status = status,
                )
            }.sortedByDescending { it.date })
        } catch (e: Exception) {
            AppResult.Failure(AppError.Network(e.message ?: "Unable to load phone usage", e))
        }
    }
}
