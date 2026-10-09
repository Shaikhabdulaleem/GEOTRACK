package com.geotrack.mobile.location

import com.geotrack.mobile.core.common.AppError
import com.geotrack.mobile.domain.model.DailySchedule
import com.geotrack.mobile.domain.model.TodayScheduleState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Duration
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime

class AutoAttendanceTest {

    private val zone = ZoneId.of("Asia/Riyadh")

    private fun workingDay(
        date: LocalDate,
        start: String,
        end: String,
        crossesMidnight: Boolean = false,
        name: String = "Day",
    ) = DailySchedule(
        date = date,
        state = TodayScheduleState.WORKING_DAY,
        shiftName = name,
        startTime = start,
        endTime = end,
        crossesMidnight = crossesMidnight,
    )

    private fun instant(date: LocalDate, hour: Int, minute: Int = 0) =
        ZonedDateTime.of(date, java.time.LocalTime.of(hour, minute), zone).toInstant()

    @Test
    fun `resolves a normal day shift while it is running`() {
        val day = LocalDate.of(2026, 1, 15)
        val schedules = listOf(workingDay(day, "09:00:00", "17:00:00"))

        val resolved = AutoAttendance.resolveShiftForInstant(instant(day, 10), zone, schedules)

        assertEquals(day, resolved?.workDate)
    }

    @Test
    fun `early arrival within grace resolves the upcoming shift`() {
        val day = LocalDate.of(2026, 1, 15)
        val schedules = listOf(workingDay(day, "09:00:00", "17:00:00"))

        // 08:30, 30 min before start — inside the 60 min default grace.
        val resolved = AutoAttendance.resolveShiftForInstant(instant(day, 8, 30), zone, schedules)

        assertEquals(day, resolved?.workDate)
    }

    @Test
    fun `before the grace window there is no active shift`() {
        val day = LocalDate.of(2026, 1, 15)
        val schedules = listOf(workingDay(day, "09:00:00", "17:00:00"))

        // 07:30, two hours early — outside the 60 min grace.
        val resolved = AutoAttendance.resolveShiftForInstant(instant(day, 7, 30), zone, schedules)

        assertNull(resolved)
    }

    @Test
    fun `overnight shift after midnight resolves to the start date`() {
        val startDay = LocalDate.of(2026, 1, 15)
        val nextDay = startDay.plusDays(1)
        // 22:00 -> 06:00 crossing midnight, dated on the start day.
        val schedules = listOf(workingDay(startDay, "22:00:00", "06:00:00", crossesMidnight = true, name = "Night"))

        // 02:00 on the following calendar day is still the Jan-15 shift.
        val resolved = AutoAttendance.resolveShiftForInstant(instant(nextDay, 2), zone, schedules)

        assertEquals(startDay, resolved?.workDate)
        assertEquals("Night", resolved?.shiftName)
    }

    @Test
    fun `overnight end time implies crossing midnight even without the flag`() {
        val startDay = LocalDate.of(2026, 1, 15)
        val nextDay = startDay.plusDays(1)
        val schedules = listOf(workingDay(startDay, "22:00:00", "06:00:00", crossesMidnight = false))

        val resolved = AutoAttendance.resolveOpenShiftForInstant(instant(nextDay, 1), zone, schedules)

        assertEquals(startDay, resolved?.workDate)
    }

    @Test
    fun `an in-progress overnight shift wins over a not-yet-started day shift`() {
        val day1 = LocalDate.of(2026, 1, 15)
        val day2 = day1.plusDays(1)
        val schedules = listOf(
            workingDay(day1, "22:00:00", "06:00:00", crossesMidnight = true, name = "Night"),
            workingDay(day2, "09:00:00", "17:00:00", name = "Day"),
        )

        // 05:30 on day2: the night shift is still open; the day shift is hours away.
        val resolved = AutoAttendance.resolveShiftForInstant(instant(day2, 5, 30), zone, schedules)

        assertEquals(day1, resolved?.workDate)
        assertEquals("Night", resolved?.shiftName)
    }

    @Test
    fun `non-working days are never resolved`() {
        val day = LocalDate.of(2026, 1, 15)
        val schedules = listOf(
            DailySchedule(day, TodayScheduleState.OFF_DAY),
            DailySchedule(day, TodayScheduleState.HOLIDAY),
        )

        assertNull(AutoAttendance.resolveShiftForInstant(instant(day, 10), zone, schedules))
    }

    @Test
    fun `transient failures retry and permanent rejections do not`() {
        // Transient
        assertEquals(
            AutoAttendance.RetryDecision.RETRY,
            AutoAttendance.classifyFailure(AppError.Network("timeout")),
        )
        assertEquals(
            AutoAttendance.RetryDecision.RETRY,
            AutoAttendance.classifyFailure(AppError.Configuration("Supabase not configured")),
        )
        assertEquals(
            AutoAttendance.RetryDecision.RETRY,
            AutoAttendance.classifyFailure(AppError.Unknown("Something odd happened")),
        )

        // Permanent
        assertEquals(
            AutoAttendance.RetryDecision.DONE,
            AutoAttendance.classifyFailure(AppError.Unknown("You are outside your assigned work location.")),
        )
        assertEquals(
            AutoAttendance.RetryDecision.DONE,
            AutoAttendance.classifyFailure(AppError.Unknown("Already checked in today.")),
        )
        assertEquals(
            AutoAttendance.RetryDecision.DONE,
            AutoAttendance.classifyFailure(AppError.Unknown("This device isn't registered for your account.")),
        )
        assertEquals(
            AutoAttendance.RetryDecision.DONE,
            AutoAttendance.classifyFailure(AppError.Unauthorized("Session expired")),
        )
    }

    @Test
    fun `grace is configurable`() {
        val day = LocalDate.of(2026, 1, 15)
        val schedules = listOf(workingDay(day, "09:00:00", "17:00:00"))

        // With zero grace, 08:59 is not yet active.
        assertNull(
            AutoAttendance.resolveShiftForInstant(instant(day, 8, 59), zone, schedules, graceBefore = Duration.ZERO),
        )
    }
}
