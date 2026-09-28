package com.geotrack.mobile.domain.repository

import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.domain.model.DailySchedule
import com.geotrack.mobile.domain.model.TodaySchedule
import java.time.LocalDate

interface ScheduleRepository {
    suspend fun getTodaySchedule(organizationId: String, employeeId: String, today: LocalDate): AppResult<TodaySchedule>
    
    suspend fun getScheduleWindow(organizationId: String, employeeId: String, startDate: LocalDate, endDate: LocalDate): AppResult<List<DailySchedule>>
}
