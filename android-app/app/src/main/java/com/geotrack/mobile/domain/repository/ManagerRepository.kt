package com.geotrack.mobile.domain.repository

import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.domain.model.ManagerDashboard
import java.time.LocalDate

interface ManagerRepository {
    suspend fun getDashboard(organizationId: String, date: LocalDate): AppResult<ManagerDashboard>
}
