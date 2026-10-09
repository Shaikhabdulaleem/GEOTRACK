package com.geotrack.mobile.notifications

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AttendanceReminderContentTest {
    @Test
    fun `late employee is prompted to open app and mark attendance`() {
        val content = AttendanceReminderContent.resolve(
            type = AttendanceNotificationType.NOT_CHECKED_IN,
            checkedIn = false,
        )

        assertEquals("Attendance not marked", content?.title)
        assertEquals("Your attendance has not been marked. Please open GeoTrack and check in.", content?.body)
    }

    @Test
    fun `check in reminder is suppressed after employee checks in`() {
        assertNull(
            AttendanceReminderContent.resolve(
                type = AttendanceNotificationType.NOT_CHECKED_IN,
                checkedIn = true,
            ),
        )
    }

    @Test
    fun `missed attendance is emitted only when no check in exists`() {
        val missed = AttendanceReminderContent.resolve(
            type = AttendanceNotificationType.MISSED_ATTENDANCE,
            checkedIn = false,
        )
        val attended = AttendanceReminderContent.resolve(
            type = AttendanceNotificationType.MISSED_ATTENDANCE,
            checkedIn = true,
        )

        assertEquals("Missed attendance", missed?.title)
        assertNull(attended)
    }

    @Test
    fun `checkout reminder requires check in without check out`() {
        assertNull(AttendanceReminderContent.resolve(AttendanceNotificationType.FORGOT_CHECKOUT))
        assertEquals(
            "Checkout reminder",
            AttendanceReminderContent.resolve(
                type = AttendanceNotificationType.FORGOT_CHECKOUT,
                checkedIn = true,
                checkedOut = false,
            )?.title,
        )
        assertNull(
            AttendanceReminderContent.resolve(
                type = AttendanceNotificationType.FORGOT_CHECKOUT,
                checkedIn = true,
                checkedOut = true,
            ),
        )
    }

    @Test
    fun `pre-shift reminder states shift time and location per spec`() {
        val content = AttendanceReminderContent.resolve(
            type = AttendanceNotificationType.SHIFT_START,
            shiftStart = "9:00 AM",
        )
        assertEquals("Shift starting soon", content?.title)
        assertEquals(
            "Your shift starts at 9:00 AM. Please ensure you are at your assigned location.",
            content?.body,
        )
    }

    @Test
    fun `tomorrow shift notification includes changed schedule`() {
        val content = AttendanceReminderContent.resolve(
            type = AttendanceNotificationType.TOMORROW_WORKING,
            shiftName = "Evening",
            shiftStart = "2:00 PM",
            shiftEnd = "10:00 PM",
        )

        assertEquals("You are working tomorrow: Evening 2:00 PM – 10:00 PM.", content?.body)
    }
}
