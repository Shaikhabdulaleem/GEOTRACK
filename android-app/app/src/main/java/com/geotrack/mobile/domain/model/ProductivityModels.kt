package com.geotrack.mobile.domain.model

import java.time.LocalDate

data class ProductivityRecord(
    val date: LocalDate,
    val target: Int,
    val completed: Int,
    val productiveHours: Double,
    val productivityPercent: Double?,
)

enum class ProductivityTrend { UP, DOWN, STABLE, NOT_AVAILABLE }

data class ProductivitySummary(
    val target: Int = 0,
    val completed: Int = 0,
    val productiveHours: Double = 0.0,
    val productivityPercent: Double? = null,
    val trend: ProductivityTrend = ProductivityTrend.NOT_AVAILABLE,
)
