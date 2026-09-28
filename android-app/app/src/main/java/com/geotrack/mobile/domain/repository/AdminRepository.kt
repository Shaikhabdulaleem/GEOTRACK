package com.geotrack.mobile.domain.repository

import com.geotrack.mobile.core.common.AppResult

data class SystemSummary(
    val totalEmployees: Int,
    val checkedInToday: Int,
    val exceptions: Int,
    val pendingApprovals: Int
)

interface AdminRepository {
    suspend fun getSystemSummary(organizationId: String): AppResult<SystemSummary>
}
