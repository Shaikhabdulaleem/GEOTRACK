package com.geotrack.mobile.phoneusage

import com.geotrack.mobile.domain.model.PhoneUsageDataStatus
import java.time.Instant

data class PhoneUsageMeasurement(
    val status: PhoneUsageDataStatus,
    val phoneUsageMinutes: Int?,
)

interface PhoneUsageReader {
    fun hasUsageAccess(): Boolean
    fun usageAccessSettingsIntent(): android.content.Intent
    fun measure(shiftStart: Instant, shiftEnd: Instant): PhoneUsageMeasurement
}
