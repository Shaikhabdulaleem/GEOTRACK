package com.geotrack.mobile.notifications

import com.geotrack.mobile.core.common.AppResult
import kotlinx.coroutines.flow.Flow
import java.time.Instant
import java.time.LocalDate

enum class AttendanceNotificationType { SHIFT_START, NOT_CHECKED_IN, OUTSIDE_GEOFENCE, ATTENDANCE_RECORDED, SHIFT_ENDING, FORGOT_CHECKOUT, SHIFT_CHANGED, TOMORROW_OFF, TOMORROW_WORKING, WEEKLY_OFF_CHANGED }
data class PushRegistrationState(val tokenRegistered: Boolean, val configured: Boolean = false)
data class AttendanceNotification(val id: String? = null, val type: AttendanceNotificationType, val title: String, val body: String)
data class ScheduledNotification(val type: AttendanceNotificationType, val workDate: LocalDate, val at: Instant)

interface AttendanceNotificationRepository {
    suspend fun plans(): AppResult<List<ScheduledNotification>>
    suspend fun resolve(type: AttendanceNotificationType, workDate: LocalDate): AppResult<AttendanceNotification?>
    suspend fun resolveServerNotification(id: String): AppResult<AttendanceNotification?>
    suspend fun registerPushToken(token: String): AppResult<Unit>
    suspend fun unregisterPushToken(token: String): AppResult<Unit>
}

interface NotificationCoordinator {
    val registrationState: Flow<PushRegistrationState>
    fun onAuthenticated()
    fun onSignedOut()
    fun showAttendanceRecorded()
    fun showOutsideGeofence()
}
