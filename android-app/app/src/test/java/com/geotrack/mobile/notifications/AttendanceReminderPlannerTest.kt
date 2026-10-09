package com.geotrack.mobile.notifications

import com.geotrack.mobile.domain.model.DailySchedule
import com.geotrack.mobile.domain.model.TodayScheduleState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Duration
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime

class AttendanceReminderPlannerTest {

    private val zone = ZoneId.of("Asia/Riyadh")

    private fun workingDay(date: LocalDate, start: String, end: String, crossesMidnight: Boolean = false) =
        DailySchedule(
            date = date,
            state = TodayScheduleState.WORKING_DAY,
            shiftName = "Day",
            startTime = start,
            endTime = end,
            crossesMidnight = crossesMidnight,
        )

    private fun at(date: LocalDate, hour: Int, minute: Int = 0) =
        ZonedDateTime.of(date, LocalTime.of(hour, minute), zone).toInstant()

    private fun plansFor(now: java.time.Instant, schedules: List<DailySchedule>) =
        AttendanceReminderPlanner.build(now, zone, schedules)

    @Test
    fun `pre-shift reminder is 15 minutes before start`() {
        val today = LocalDate.now(zone)
        val schedules = listOf(workingDay(today, "23:00:00", "23:30:00"))

        // Plan early in the day so the shift is still in the future.
        val plans = plansFor(at(today, 1), schedules)
        val preShift = plans.first { it.type == AttendanceNotificationType.SHIFT_START }

        val start = ZonedDateTime.of(today, LocalTime.of(23, 0), zone).toInstant()
        assertEquals(start.minus(Duration.ofMinutes(15)), preShift.at)
    }

    @Test
    fun `not-checked-in reminder is 15 minutes after start`() {
        val today = LocalDate.now(zone)
        val schedules = listOf(workingDay(today, "23:00:00", "23:59:00"))

        val plans = plansFor(at(today, 1), schedules)
        val notChecked = plans.first { it.type == AttendanceNotificationType.NOT_CHECKED_IN }

        val start = ZonedDateTime.of(today, LocalTime.of(23, 0), zone).toInstant()
        assertEquals(start.plus(Duration.ofMinutes(15)), notChecked.at)
    }

    @Test
    fun `tomorrow's shift that starts after midnight is queued today`() {
        val today = LocalDate.now(zone)
        val tomorrow = today.plusDays(1)
        // No shift today; tomorrow 09:00-17:00.
        val schedules = listOf(
            DailySchedule(today, TodayScheduleState.OFF_DAY),
            workingDay(tomorrow, "09:00:00", "17:00:00"),
        )

        // Planning at 22:00 today — crossing midnight into tomorrow's shift.
        val plans = plansFor(at(today, 22), schedules)

        val preShift = plans.firstOrNull {
            it.type == AttendanceNotificationType.SHIFT_START && it.workDate == tomorrow
        }
        assertTrue("tomorrow's pre-shift reminder must be queued ahead of midnight", preShift != null)
        val start = ZonedDateTime.of(tomorrow, LocalTime.of(9, 0), zone).toInstant()
        assertEquals(start.minus(Duration.ofMinutes(15)), preShift!!.at)
    }

    @Test
    fun `off days produce no shift reminders`() {
        val today = LocalDate.now(zone)
        val schedules = (0..3L).map { DailySchedule(today.plusDays(it), TodayScheduleState.OFF_DAY) }

        val plans = plansFor(at(today, 1), schedules)

        assertTrue(
            "no shift reminders on off days",
            plans.none {
                it.type in setOf(
                    AttendanceNotificationType.SHIFT_START,
                    AttendanceNotificationType.NOT_CHECKED_IN,
                    AttendanceNotificationType.SHIFT_ENDING,
                    AttendanceNotificationType.FORGOT_CHECKOUT,
                )
            },
        )
    }

    @Test
    fun `holiday and leave days are suppressed`() {
        val today = LocalDate.now(zone)
        val schedules = listOf(
            DailySchedule(today, TodayScheduleState.HOLIDAY),
            DailySchedule(today.plusDays(1), TodayScheduleState.LEAVE),
        )

        val plans = plansFor(at(today, 1), schedules)
        assertTrue(plans.none { it.type == AttendanceNotificationType.SHIFT_START })
    }

    @Test
    fun `a shift with no assigned name is not treated as a working shift`() {
        val today = LocalDate.now(zone)
        val schedules = listOf(
            DailySchedule(
                date = today,
                state = TodayScheduleState.WORKING_DAY,
                shiftName = "No Shift Assigned",
                startTime = "09:00:00",
                endTime = "17:00:00",
            ),
        )

        val plans = plansFor(at(today, 1), schedules)
        assertTrue(plans.none { it.type == AttendanceNotificationType.SHIFT_START })
    }

    @Test
    fun `past events are filtered out`() {
        val today = LocalDate.now(zone)
        val schedules = listOf(workingDay(today, "09:00:00", "17:00:00"))

        // Planning at 20:00 — every one of today's events is in the past.
        val plans = plansFor(at(today, 20), schedules)
        assertTrue(plans.none { it.workDate == today })
    }

    @Test
    fun `overnight shift end rolls past midnight for checkout reminders`() {
        val today = LocalDate.now(zone)
        val schedule = workingDay(today, "22:00:00", "06:00:00", crossesMidnight = true)

        val window = AttendanceReminderPlanner.shiftWindow(schedule, zone)!!
        val expectedEnd = ZonedDateTime.of(today.plusDays(1), LocalTime.of(6, 0), zone).toInstant()
        assertEquals(expectedEnd, window.second)
    }
}
