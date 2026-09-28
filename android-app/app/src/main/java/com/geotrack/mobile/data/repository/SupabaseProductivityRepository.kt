package com.geotrack.mobile.data.repository

import com.geotrack.mobile.core.common.AppError
import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.data.remote.dto.ProductivityRecordDto
import com.geotrack.mobile.data.remote.supabase.SupabaseClientHolder
import com.geotrack.mobile.domain.model.ProductivityRecord
import com.geotrack.mobile.domain.repository.ProductivityRepository
import io.github.jan.supabase.postgrest.postgrest
import javax.inject.Inject
import javax.inject.Singleton
import java.time.LocalDate

@Singleton
class SupabaseProductivityRepository @Inject constructor(
    private val holder: SupabaseClientHolder,
) : ProductivityRepository {
    override suspend fun listOwn(
        organizationId: String,
        employeeId: String,
        startDate: LocalDate,
        endDate: LocalDate,
    ): AppResult<List<ProductivityRecord>> {
        val client = holder.client ?: return AppResult.Failure(AppError.Configuration("Supabase not configured"))
        return try {
            // Keep both filters even though RLS also enforces employee ownership.
            // This prevents accidentally materializing another employee's rows.
            val rows = client.postgrest["productivity_records"].select {
                filter {
                    eq("organization_id", organizationId)
                    eq("employee_id", employeeId)
                    gte("work_date", startDate.toString())
                    lte("work_date", endDate.toString())
                }
            }.decodeList<ProductivityRecordDto>()
            AppResult.Success(rows.map {
                ProductivityRecord(
                    date = LocalDate.parse(it.workDate),
                    target = it.targetUnits,
                    completed = it.actualUnits,
                    productiveHours = it.productiveHours ?: 0.0,
                    productivityPercent = it.productivityPercent,
                )
            }.sortedBy { it.date })
        } catch (e: Exception) {
            AppResult.Failure(AppError.Network(e.message ?: "Unable to load productivity", e))
        }
    }
}
