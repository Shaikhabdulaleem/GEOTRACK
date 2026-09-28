package com.geotrack.mobile.data.repository

import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.data.remote.supabase.SupabaseClientHolder
import com.geotrack.mobile.domain.repository.AdminRepository
import com.geotrack.mobile.domain.repository.SystemSummary
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Count
import java.time.LocalDate
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SupabaseAdminRepository @Inject constructor(
    private val clientHolder: SupabaseClientHolder
) : AdminRepository {

    override suspend fun getSystemSummary(organizationId: String): AppResult<SystemSummary> {
        val client = clientHolder.client ?: return AppResult.Failure(com.geotrack.mobile.core.common.AppError.Configuration("Supabase not configured"))
        
        return try {
            val today = LocalDate.now().toString()
            
            // Total Employees
            val totalEmployees = client.postgrest["employee_profiles"]
                .select {
                    filter { eq("organization_id", organizationId) }
                    count(Count.EXACT)
                }.countOrNull() ?: 0L
                
            // Checked In Today
            val checkedInToday = client.postgrest["attendance_records"]
                .select {
                    filter {
                        eq("organization_id", organizationId)
                        eq("attendance_date", today)
                        neq("check_in_at", "null")
                    }
                    count(Count.EXACT)
                }.countOrNull() ?: 0L
                
            // Pending Approvals (Manual requests + Overtime + Leave)
            // Just count manual requests for summary
            val pendingManual = client.postgrest["manual_attendance_requests"]
                .select {
                    filter {
                        eq("organization_id", organizationId)
                        eq("status", "pending")
                    }
                    count(Count.EXACT)
                }.countOrNull() ?: 0L
                
            val pendingLeave = client.postgrest["leave_requests"]
                .select {
                    filter {
                        eq("organization_id", organizationId)
                        eq("status", "pending")
                    }
                    count(Count.EXACT)
                }.countOrNull() ?: 0L

            val pendingOvertime = client.postgrest["overtime_records"]
                .select {
                    filter {
                        eq("organization_id", organizationId)
                        eq("status", "pending")
                    }
                    count(Count.EXACT)
                }.countOrNull() ?: 0L

            val geofenceExceptions = client.postgrest["attendance_records"]
                .select {
                    filter {
                        eq("organization_id", organizationId)
                        eq("attendance_date", today)
                        eq("status", "outside_geofence")
                    }
                    count(Count.EXACT)
                }.countOrNull() ?: 0L

            AppResult.Success(
                SystemSummary(
                    totalEmployees = totalEmployees.toInt(),
                    checkedInToday = checkedInToday.toInt(),
                    exceptions = geofenceExceptions.toInt(),
                    pendingApprovals = (pendingManual + pendingLeave + pendingOvertime).toInt()
                )
            )
        } catch (e: Exception) {
            AppResult.Failure(com.geotrack.mobile.core.common.AppError.Unknown(e.message ?: "Unknown", e))
        }
    }
}
