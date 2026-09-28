package com.geotrack.mobile.domain.repository

import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.domain.model.OvertimeEntry
import java.time.LocalDate

interface OvertimeRepository {
    suspend fun list(
        organizationId: String,
        employeeId: String,
        startDate: LocalDate,
        endDate: LocalDate,
    ): AppResult<List<OvertimeEntry>>

    suspend fun requestExplanation(overtimeId: String, explanation: String): AppResult<Unit>
}
