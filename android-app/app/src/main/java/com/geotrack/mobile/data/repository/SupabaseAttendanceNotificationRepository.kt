package com.geotrack.mobile.data.repository

import android.content.Context
import com.geotrack.mobile.BuildConfig
import com.geotrack.mobile.core.common.AppError
import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.data.remote.dto.PushTokenParams
import com.geotrack.mobile.data.remote.dto.ServerNotificationDto
import com.geotrack.mobile.data.remote.dto.AttendanceRecordDto
import com.geotrack.mobile.data.remote.supabase.SupabaseClientHolder
import com.geotrack.mobile.database.CachedNotificationEntity
import com.geotrack.mobile.database.GeoTrackDatabase
import com.geotrack.mobile.domain.repository.ScheduleRepository
import com.geotrack.mobile.domain.repository.SessionRepository
import com.geotrack.mobile.domain.model.TodayScheduleState
import com.geotrack.mobile.notifications.*
import dagger.hilt.android.qualifiers.ApplicationContext
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Columns
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.*
import java.time.format.DateTimeFormatter
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SupabaseAttendanceNotificationRepository @Inject constructor(
    private val holder: SupabaseClientHolder,
    private val sessions: SessionRepository,
    private val schedules: ScheduleRepository,
    private val database: GeoTrackDatabase,
    @ApplicationContext context: Context,
) : AttendanceNotificationRepository {
    private val prefs = context.getSharedPreferences("notification-install", Context.MODE_PRIVATE)
    private val deviceId: String get() = prefs.getString("id", null) ?: UUID.randomUUID().toString().also { prefs.edit().putString("id", it).apply() }
    private suspend fun identity() = sessions.organizationContext.first()?.let { context -> sessions.employeeProfile.first()?.let { context to it } }
    private fun failure(e: Throwable) = AppResult.Failure(AppError.Network(e.message ?: "Notification sync failed", e))

    override suspend fun plans(): AppResult<List<ScheduledNotification>> {
      return try {
        val identity = identity() ?: return AppResult.Success(emptyList())
        val (context, employee) = identity
        val now = Instant.now(); val zone = ZoneId.of(context.organization.timezone)
        val today = LocalDate.now(zone); val window = schedules.getScheduleWindow(context.organization.id, employee.id, today, today.plusDays(1))
        val list = (window as? AppResult.Success)?.value ?: return AppResult.Success(emptyList())
        val out = mutableListOf<ScheduledNotification>()
        val todaySchedule = list.firstOrNull { it.date == today }
        if (todaySchedule.isAssignedWorkingShift()) {
            todaySchedule?.let { schedule ->
                val start = parseTime(schedule.startTime!!, today, zone)
                val end = parseTime(schedule.endTime!!, today, zone).let { if (!it.isAfter(start)) it.plusDays(1) else it }
                out += ScheduledNotification(AttendanceNotificationType.SHIFT_START, today, start.minusMinutes(30).toInstant())
                out += ScheduledNotification(AttendanceNotificationType.NOT_CHECKED_IN, today, start.plusMinutes(15).toInstant())
                out += ScheduledNotification(AttendanceNotificationType.SHIFT_ENDING, today, end.minusMinutes(30).toInstant())
                out += ScheduledNotification(AttendanceNotificationType.FORGOT_CHECKOUT, today, end.plusMinutes(15).toInstant())
                out += ScheduledNotification(AttendanceNotificationType.MISSED_ATTENDANCE, today, end.plusMinutes(15).toInstant())
            }
        }
        val tomorrow = list.firstOrNull { it.date == today.plusDays(1) }
        val evening = today.atTime(18, 0).atZone(zone).toInstant()
        if (tomorrow.isAssignedWorkingShift()) out += ScheduledNotification(AttendanceNotificationType.TOMORROW_WORKING, today.plusDays(1), evening)
        else if (tomorrow?.state == TodayScheduleState.OFF_DAY || tomorrow?.state == TodayScheduleState.HOLIDAY || tomorrow?.state == TodayScheduleState.LEAVE) out += ScheduledNotification(AttendanceNotificationType.TOMORROW_OFF, today.plusDays(1), evening)
        AppResult.Success(out.filter { it.at.isAfter(now.plusSeconds(5)) })
      } catch (e: Exception) { failure(e) }
    }

    private fun parseTime(value: String, date: LocalDate, zone: ZoneId): ZonedDateTime = ZonedDateTime.of(date, LocalTime.parse(value.take(8)), zone)
    private fun com.geotrack.mobile.domain.model.DailySchedule?.isAssignedWorkingShift(): Boolean =
        this?.state == TodayScheduleState.WORKING_DAY &&
            !this.shiftName.isNullOrBlank() && this.shiftName != "No Shift Assigned" &&
            !this.startTime.isNullOrBlank() && !this.endTime.isNullOrBlank()
    private suspend fun hasAttendance(employeeId: String, date: LocalDate): AttendanceRecordDto? {
        val c = holder.client ?: return null
        return c.postgrest["attendance_records"].select { filter { eq("employee_id", employeeId); eq("attendance_date", date.toString()) } }.decodeList<AttendanceRecordDto>().firstOrNull()
    }
    override suspend fun resolve(type: AttendanceNotificationType, workDate: LocalDate): AppResult<AttendanceNotification?> {
      return try {
        val identity = identity() ?: return AppResult.Success(null); val (context, employee) = identity
        val schedule = schedules.getScheduleWindow(context.organization.id, employee.id, workDate, workDate).let { (it as? AppResult.Success)?.value?.firstOrNull() }
        if (type in setOf(AttendanceNotificationType.SHIFT_START, AttendanceNotificationType.NOT_CHECKED_IN, AttendanceNotificationType.MISSED_ATTENDANCE, AttendanceNotificationType.SHIFT_ENDING, AttendanceNotificationType.FORGOT_CHECKOUT) && !schedule.isAssignedWorkingShift()) return AppResult.Success(null)
        if (type == AttendanceNotificationType.TOMORROW_WORKING && !schedule.isAssignedWorkingShift()) return AppResult.Success(null)
        if (type == AttendanceNotificationType.TOMORROW_OFF && schedule?.state !in setOf(TodayScheduleState.OFF_DAY, TodayScheduleState.HOLIDAY, TodayScheduleState.LEAVE)) return AppResult.Success(null)
        val attendance = if (type in setOf(AttendanceNotificationType.NOT_CHECKED_IN, AttendanceNotificationType.MISSED_ATTENDANCE, AttendanceNotificationType.SHIFT_ENDING, AttendanceNotificationType.FORGOT_CHECKOUT)) hasAttendance(employee.id, workDate) else null
        val content = AttendanceReminderContent.resolve(
            type = type,
            shiftStart = schedule?.startTime?.let(::format),
            shiftEnd = schedule?.endTime?.let(::format),
            shiftName = schedule?.shiftName,
            checkedIn = attendance?.checkInAt != null,
            checkedOut = attendance?.checkOutAt != null,
        )
        val notification = content?.let { AttendanceNotification(id = "local-${type.name}-$workDate", type = type, title = it.title, body = it.body) }
        notification?.let { persistLocal(it) }
        AppResult.Success(notification)
      } catch (e: Exception) { failure(e) }
    }

    // On-device reminders are posted as system notifications; mirror them into
    // the local cache so they also appear in the in-app notifications list.
    private suspend fun persistLocal(notification: AttendanceNotification) {
        val userId = holder.client?.auth?.currentSessionOrNull()?.user?.id ?: return
        val id = notification.id ?: return
        runCatching {
            database.workforceCacheDao().upsertNotifications(
                listOf(
                    CachedNotificationEntity(
                        notificationId = id,
                        recipientUserId = userId,
                        title = notification.title,
                        body = notification.body,
                        notificationType = notification.type.name.lowercase(),
                        readAt = null,
                        createdAt = Instant.now().toString(),
                        cachedAt = System.currentTimeMillis(),
                    ),
                ),
            )
        }
    }
    private fun format(time: String) = try { LocalTime.parse(time.take(8)).format(DateTimeFormatter.ofPattern("h:mm a")) } catch (_: Exception) { time }
    private fun formatCompactTime(time: String?): String = time?.let {
        runCatching {
            val local = LocalTime.parse(it.take(8))
            local.format(DateTimeFormatter.ofPattern(if (local.minute == 0) "h a" else "h:mm a"))
        }.getOrDefault(it)
    } ?: ""

    override suspend fun resolveServerNotification(id: String): AppResult<AttendanceNotification?> = try {
        val c = holder.client ?: return AppResult.Failure(AppError.Configuration("Supabase not configured"))
        val n = c.postgrest["notifications"].select { filter { eq("id", id) } }.decodeList<ServerNotificationDto>().firstOrNull() ?: return AppResult.Success(null)
        val type = when (n.notificationType.lowercase()) {
            "shift_change", "shift_changed" -> AttendanceNotificationType.SHIFT_CHANGED
            "weekly_off_change", "weekly_off_changed" -> AttendanceNotificationType.WEEKLY_OFF_CHANGED
            else -> runCatching { AttendanceNotificationType.valueOf(n.notificationType.uppercase()) }
                .getOrDefault(AttendanceNotificationType.SHIFT_CHANGED)
        }
        AppResult.Success(AttendanceNotification(n.id, type, n.title, n.body))
    } catch (e: Exception) { failure(e) }
    override suspend fun registerPushToken(token: String): AppResult<Unit> = try {
        val client = holder.client ?: return AppResult.Failure(AppError.Configuration("Supabase not configured"))
        client.postgrest.rpc("register_mobile_push_token", buildJsonObject {
            put("p_token", token)
            put("p_device_identifier", deviceId)
            put("p_app_version", BuildConfig.VERSION_NAME)
        })
        AppResult.Success(Unit)
    } catch (e: Exception) { failure(e) }

    override suspend fun unregisterPushToken(token: String): AppResult<Unit> = try {
        val client = holder.client ?: return AppResult.Failure(AppError.Configuration("Supabase not configured"))
        client.postgrest.rpc("unregister_mobile_push_token", buildJsonObject { put("p_token", token) })
        AppResult.Success(Unit)
    } catch (e: Exception) { failure(e) }
}
