package com.geotrack.mobile.notifications

import com.geotrack.mobile.domain.model.DailySchedule
import com.geotrack.mobile.domain.model.TodayScheduleState
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * Pure reminder-scheduling policy, free of Android/WorkManager/Supabase types so
 * the cross-midnight, horizon and suppression rules can be unit tested.
 *
 * The planner queues reminders for a rolling [horizonDays] window (today plus
 * the next N days) rather than only today's events. This is what lets a shift
 * that starts after midnight get its pre-shift and not-marked reminders queued
 * ahead of time, instead of relying on a refresh happening to run during a
 * narrow pre-shift window.
 */
object AttendanceReminderPlanner {

    const val PRE_SHIFT_MINUTES = 15L
    const val NOT_CHECKED_IN_MINUTES = 15L
    const val SHIFT_ENDING_MINUTES = 30L
    const val FORGOT_CHECKOUT_MINUTES = 15L

    fun build(
        now: Instant,
        zone: ZoneId,
        schedules: List<DailySchedule>,
        horizonDays: Long = 3,
    ): List<ScheduledNotification> {
        val today = LocalDate.now(zone)
        val horizonEnd = today.plusDays(horizonDays)
        val byDate = schedules.associateBy { it.date }
        val out = mutableListOf<ScheduledNotification>()

        var day = today
        while (!day.isAfter(horizonEnd)) {
            val schedule = byDate[day]
            if (schedule.isAssignedWorkingShift()) {
                val window = shiftWindow(schedule!!, zone)
                if (window != null) {
                    val (start, end) = window
                    out += ScheduledNotification(
                        AttendanceNotificationType.SHIFT_START,
                        day,
                        start.minusSeconds(PRE_SHIFT_MINUTES * 60),
                    )
                    out += ScheduledNotification(
                        AttendanceNotificationType.NOT_CHECKED_IN,
                        day,
                        start.plusSeconds(NOT_CHECKED_IN_MINUTES * 60),
                    )
                    out += ScheduledNotification(
                        AttendanceNotificationType.SHIFT_ENDING,
                        day,
                        end.minusSeconds(SHIFT_ENDING_MINUTES * 60),
                    )
                    out += ScheduledNotification(
                        AttendanceNotificationType.FORGOT_CHECKOUT,
                        day,
                        end.plusSeconds(FORGOT_CHECKOUT_MINUTES * 60),
                    )
                }
            }
            day = day.plusDays(1)
        }

        // A single next-day summary, posted the evening before, as a nicety.
        val tomorrow = today.plusDays(1)
        byDate[tomorrow]?.let { schedule ->
            val evening = today.atTime(18, 0).atZone(zone).toInstant()
            when {
                schedule.isAssignedWorkingShift() ->
                    out += ScheduledNotification(AttendanceNotificationType.TOMORROW_WORKING, tomorrow, evening)
                schedule.state in OFF_STATES ->
                    out += ScheduledNotification(AttendanceNotificationType.TOMORROW_OFF, tomorrow, evening)
                else -> Unit
            }
        }

        val cutoff = now.plusSeconds(5)
        return out.filter { it.at.isAfter(cutoff) }.sortedBy { it.at }
    }

    /** Start/end instants for a shift, rolling the end past midnight when the
     * shift crosses it. */
    fun shiftWindow(schedule: DailySchedule, zone: ZoneId): Pair<Instant, Instant>? {
        val startTime = parseTime(schedule.startTime) ?: return null
        val endTime = parseTime(schedule.endTime) ?: return null
        val start = ZonedDateTime.of(schedule.date, startTime, zone)
        var end = ZonedDateTime.of(schedule.date, endTime, zone)
        if (schedule.crossesMidnight || !end.isAfter(start)) {
            end = end.plusDays(1)
        }
        return start.toInstant() to end.toInstant()
    }

    private val OFF_STATES = setOf(
        TodayScheduleState.OFF_DAY,
        TodayScheduleState.HOLIDAY,
        TodayScheduleState.LEAVE,
    )

    private fun parseTime(value: String?): LocalTime? =
        value?.let { runCatching { LocalTime.parse(it.take(8)) }.getOrNull() }
}

/** Shared eligibility check: a real assigned working shift with both times. */
fun DailySchedule?.isAssignedWorkingShift(): Boolean =
    this?.state == TodayScheduleState.WORKING_DAY &&
        !shiftName.isNullOrBlank() && shiftName != "No Shift Assigned" &&
        !startTime.isNullOrBlank() && !endTime.isNullOrBlank()
