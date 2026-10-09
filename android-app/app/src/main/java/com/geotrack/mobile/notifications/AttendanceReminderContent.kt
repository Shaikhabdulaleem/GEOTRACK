package com.geotrack.mobile.notifications

/** Pure reminder copy/eligibility rules, kept separate so they can be unit tested. */
internal object AttendanceReminderContent {
    data class Content(val title: String, val body: String)

    fun resolve(
        type: AttendanceNotificationType,
        shiftStart: String? = null,
        shiftEnd: String? = null,
        shiftName: String? = null,
        checkedIn: Boolean = false,
        checkedOut: Boolean = false,
    ): Content? = when (type) {
        AttendanceNotificationType.SHIFT_START -> Content(
            title = "Shift starting soon",
            body = "Your shift starts at ${shiftStart.orEmpty()}. Please ensure you are at your assigned location.",
        )
        AttendanceNotificationType.NOT_CHECKED_IN -> if (!checkedIn) Content(
            title = "Attendance not marked",
            body = "Your attendance has not been marked. Please open GeoTrack and check in.",
        ) else null
        AttendanceNotificationType.MISSED_ATTENDANCE -> if (!checkedIn) Content(
            title = "Missed attendance",
            body = "No attendance was recorded for your shift. Open GeoTrack to review it and submit a correction if needed.",
        ) else null
        AttendanceNotificationType.SHIFT_ENDING -> if (checkedIn && !checkedOut) Content(
            title = "Shift ending soon",
            body = "Your shift ends in 30 minutes. Remember to check out in GeoTrack.",
        ) else null
        AttendanceNotificationType.FORGOT_CHECKOUT -> if (checkedIn && !checkedOut) Content(
            title = "Checkout reminder",
            body = "You have not checked out. Open GeoTrack and mark your checkout now.",
        ) else null
        AttendanceNotificationType.TOMORROW_OFF -> Content(
            title = "Tomorrow's schedule",
            body = "Tomorrow is your scheduled off day.",
        )
        AttendanceNotificationType.TOMORROW_WORKING -> Content(
            title = "Tomorrow's schedule",
            body = "You are working tomorrow: ${shiftName ?: "Scheduled shift"} ${shiftStart.orEmpty()} – ${shiftEnd.orEmpty()}.",
        )
        else -> null
    }
}
