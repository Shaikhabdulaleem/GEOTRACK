package com.geotrack.mobile.domain.repository

import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.domain.model.ProductivityRecord
import java.time.LocalDate

interface ProductivityRepository {
    suspend fun listOwn(
        organizationId: String,
        employeeId: String,
        startDate: LocalDate,
        endDate: LocalDate,
    ): AppResult<List<ProductivityRecord>>
}
