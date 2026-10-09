package com.geotrack.mobile.location

import com.geotrack.mobile.core.common.AppError
import com.geotrack.mobile.domain.model.DailySchedule
import com.geotrack.mobile.domain.model.TodayScheduleState
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * Pure, side-effect-free logic for automatic attendance.
 *
 * Kept in one place (and free of Android/Supabase types) so the overnight,
 * early-arrival, retry and de-duplication rules can be exercised by JVM unit
 * tests. The workers wire this to WorkManager, GPS and the server.
 */
object AutoAttendance {

    /** A concrete, timezone-resolved shift window and its canonical work date. */
    data class ResolvedShift(
        /** The attendance/work date — always the shift's START date, even for
         * overnight shifts that spill past midnight. */
        val workDate: LocalDate,
        val start: Instant,
        val end: Instant,
        val shiftName: String?,
        val startTimeRaw: String?,
        val endTimeRaw: String?,
    )

    /**
     * Resolves which assigned working shift [now] falls into, considering
     * overnight shifts that started on the previous calendar day.
     *
     * A schedule row dated D with start S and end E defines the window
     * `[D@S, D@S + (E-S, rolled to the next day when E <= S or crossesMidnight)]`.
     * [graceBefore] lets an early arrival check in before the nominal start.
     *
     * When several windows contain [now] (overlapping schedules), the one that
     * started earliest wins so an in-progress overnight shift is preferred over
     * a not-yet-started day shift.
     */
    fun resolveShiftForInstant(
        now: Instant,
        zone: ZoneId,
        schedules: List<DailySchedule>,
        graceBefore: Duration = Duration.ofMinutes(60),
    ): ResolvedShift? {
        val candidates = schedules
            .filter { it.state == TodayScheduleState.WORKING_DAY }
            .mapNotNull { toResolved(it, zone) }
        // Prefer a window that currently contains `now` (minus the early grace),
        // choosing the earliest start to favour an active overnight shift.
        val active = candidates
            .filter { !now.isBefore(it.start.minus(graceBefore)) && now.isBefore(it.end) }
            .minByOrNull { it.start }
        return active
    }

    /**
     * Resolves the shift that applies to an EXIT/checkout decision — identical
     * to [resolveShiftForInstant] but without the early-arrival grace, since a
     * checkout only makes sense once a shift is genuinely under way.
     */
    fun resolveOpenShiftForInstant(
        now: Instant,
        zone: ZoneId,
        schedules: List<DailySchedule>,
    ): ResolvedShift? = resolveShiftForInstant(now, zone, schedules, graceBefore = Duration.ZERO)

    private fun toResolved(schedule: DailySchedule, zone: ZoneId): ResolvedShift? {
        val startRaw = schedule.startTime ?: return null
        val endRaw = schedule.endTime ?: return null
        val startTime = parseTime(startRaw) ?: return null
        val endTime = parseTime(endRaw) ?: return null
        val startDateTime = ZonedDateTime.of(schedule.date, startTime, zone)
        var endDateTime = ZonedDateTime.of(schedule.date, endTime, zone)
        if (schedule.crossesMidnight || !endDateTime.isAfter(startDateTime)) {
            endDateTime = endDateTime.plusDays(1)
        }
        return ResolvedShift(
            workDate = schedule.date,
            start = startDateTime.toInstant(),
            end = endDateTime.toInstant(),
            shiftName = schedule.shiftName,
            startTimeRaw = startRaw,
            endTimeRaw = endRaw,
        )
    }

    private fun parseTime(value: String): LocalTime? =
        runCatching { LocalTime.parse(value.take(8)) }.getOrNull()

    // ── Retry classification ────────────────────────────────────────────────

    enum class RetryDecision { RETRY, DONE }

    /**
     * Decides whether a failed server attendance attempt should be retried.
     *
     * Transient transport problems (offline, timeouts, client not yet warmed up
     * in a cold background process, a momentarily poor GPS fix) are safe to
     * retry. Permanent validation rejections (outside the geofence, already
     * marked, unregistered device, no assignment, mock location) must NOT be
     * retried — a retry would never succeed and only burns battery.
     */
    fun classifyFailure(error: AppError): RetryDecision = when (error) {
        is AppError.Network -> RetryDecision.RETRY
        is AppError.Configuration -> RetryDecision.RETRY
        is AppError.Unauthorized -> RetryDecision.DONE
        is AppError.Unknown -> if (isPermanentRejection(error.message)) {
            RetryDecision.DONE
        } else {
            RetryDecision.RETRY
        }
    }

    private val permanentPhrases = listOf(
        "outside",
        "already checked",
        "not registered",
        "isn't registered",
        "device",
        "rejected",
        "no active work location",
        "mock",
        "off day",
        "not a working",
    )

    private fun isPermanentRejection(message: String): Boolean {
        val m = message.lowercase()
        return permanentPhrases.any { m.contains(it) }
    }
}
