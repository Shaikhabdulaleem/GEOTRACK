package com.geotrack.mobile.presentation.productivity

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.domain.model.ProductivityRecord
import com.geotrack.mobile.domain.model.ProductivitySummary
import com.geotrack.mobile.domain.model.ProductivityTrend
import com.geotrack.mobile.domain.repository.ProductivityRepository
import com.geotrack.mobile.domain.repository.SessionRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ProductivityUiState(
    val isLoading: Boolean = true,
    val today: ProductivitySummary = ProductivitySummary(),
    val weekly: ProductivitySummary = ProductivitySummary(),
    val monthly: ProductivitySummary = ProductivitySummary(),
    val trend: List<ProductivityRecord> = emptyList(),
    val errorMessage: String? = null,
)

@HiltViewModel
class ProductivityViewModel @Inject constructor(
    private val sessions: SessionRepository,
    private val repository: ProductivityRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow(ProductivityUiState())
    val uiState: StateFlow<ProductivityUiState> = _uiState.asStateFlow()

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            val context = sessions.organizationContext.firstOrNull()
            val employee = sessions.employeeProfile.firstOrNull()
            if (context == null || employee == null) {
                _uiState.update { it.copy(isLoading = false, errorMessage = "Session not found.") }
                return@launch
            }
            val today = LocalDate.now(ZoneId.of(context.organization.timezone))
            val monthStart = today.withDayOfMonth(1)
            val weekStart = today.minusDays((today.dayOfWeek.value - 1).toLong())
            val result = repository.listOwn(context.organization.id, employee.id, monthStart.minusMonths(1), today)
            when (result) {
                is AppResult.Success -> {
                    val records = result.value
                    val todaySummary = summary(records, today, today, today.minusDays(1), today.minusDays(1))
                    val weeklySummary = summary(records, weekStart, today, weekStart.minusDays(7), weekStart.minusDays(1))
                    val monthlySummary = summary(records, monthStart, today, monthStart.minusMonths(1), monthStart.minusDays(1))
                    val dailyTrend = records.filter { it.date >= monthStart }
                        .groupBy { it.date }
                        .toSortedMap()
                        .map { (date, dayRecords) ->
                            val day = aggregate(dayRecords)
                            ProductivityRecord(date, day.target, day.completed, day.productiveHours, day.productivityPercent)
                        }
                    _uiState.update { it.copy(isLoading = false, today = todaySummary, weekly = weeklySummary, monthly = monthlySummary, trend = dailyTrend) }
                }
                is AppResult.Failure -> _uiState.update { it.copy(isLoading = false, errorMessage = result.error.message) }
            }
        }
    }

    private fun summary(records: List<ProductivityRecord>, start: LocalDate, end: LocalDate, previousStart: LocalDate, previousEnd: LocalDate): ProductivitySummary {
        val current = records.filter { it.date in start..end }
        val previous = records.filter { it.date in previousStart..previousEnd }
        return aggregate(current).copy(trend = trend(aggregate(current).productivityPercent, aggregate(previous).productivityPercent))
    }

    private fun aggregate(records: List<ProductivityRecord>): ProductivitySummary {
        val target = records.sumOf { it.target }
        val completed = records.sumOf { it.completed }
        return ProductivitySummary(
            target = target,
            completed = completed,
            productiveHours = records.sumOf { it.productiveHours },
            productivityPercent = if (target > 0) completed.toDouble() / target * 100.0 else null,
        )
    }

    private fun trend(current: Double?, previous: Double?): ProductivityTrend = when {
        current == null || previous == null -> ProductivityTrend.NOT_AVAILABLE
        current > previous + 1.0 -> ProductivityTrend.UP
        current < previous - 1.0 -> ProductivityTrend.DOWN
        else -> ProductivityTrend.STABLE
    }
}
