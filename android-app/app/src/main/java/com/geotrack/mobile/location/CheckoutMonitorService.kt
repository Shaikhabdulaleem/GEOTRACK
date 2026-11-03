package com.geotrack.mobile.location

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.domain.repository.AttendanceRepository
import com.geotrack.mobile.domain.repository.SessionRepository
import com.geotrack.mobile.notifications.AttendanceChannels
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.Priority
import dagger.hilt.android.AndroidEntryPoint
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID
import javax.inject.Inject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.launch

/**
 * Short-lived precision monitor active from the organization's checkout grace
 * boundary until the open attendance session closes. Android requires the
 * ongoing notification for reliable minute-level background location.
 */
@AndroidEntryPoint
class CheckoutMonitorService : Service() {

    @Inject lateinit var fusedLocation: FusedLocationProviderClient
    @Inject lateinit var attendance: AttendanceRepository
    @Inject lateinit var sessions: SessionRepository

    private val scope = CoroutineScope(Job() + Dispatchers.IO)
    private val callback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            result.lastLocation?.let { location ->
                scope.launch {
                    val context = sessions.organizationContext.firstOrNull()
                    val employee = sessions.employeeProfile.firstOrNull()
                    if (context == null || employee == null) {
                        stopSelf()
                        return@launch
                    }
                    val recorded = attendance.recordAttendanceLocation(
                        organizationId = context.organization.id,
                        employeeId = employee.id,
                        latitude = location.latitude,
                        longitude = location.longitude,
                        accuracyMeters = location.accuracy,
                        isMock = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) location.isMock else {
                            @Suppress("DEPRECATION")
                            location.isFromMockProvider
                        },
                        observedAt = Instant.ofEpochMilli(location.time),
                        idempotencyKey = UUID.randomUUID().toString(),
                        sampleSource = "precision_monitor",
                    )
                    if (recorded is AppResult.Success &&
                        (recorded.value.checkoutCompleted || recorded.value.outcome == "ignored_no_open_session")
                    ) {
                        stopSelf()
                    }
                }
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        AttendanceChannels.create(this)
        startForeground(NOTIFICATION_ID, notification())
        if (!hasRequiredPermissions()) {
            stopSelf()
            return
        }
        scope.launch { startIfAttendanceIsOpen() }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    @SuppressLint("MissingPermission")
    private fun startUpdates() {
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, SAMPLE_INTERVAL_MS)
            .setMinUpdateIntervalMillis(MIN_SAMPLE_INTERVAL_MS)
            .setMaxUpdateDelayMillis(SAMPLE_INTERVAL_MS)
            .build()
        fusedLocation.requestLocationUpdates(request, callback, mainLooper)
    }

    private suspend fun startIfAttendanceIsOpen() {
        val context = sessions.organizationContext.firstOrNull()
        val employee = sessions.employeeProfile.firstOrNull()
        if (context == null || employee == null) {
            stopSelf()
            return
        }
        val zone = runCatching {
            ZoneId.of(context.assignedSite?.timezone ?: context.organization.timezone)
        }.getOrDefault(ZoneId.systemDefault())
        val today = LocalDate.now(zone)
        val recent = attendance.getAttendanceWindow(
            context.organization.id,
            employee.id,
            today.minusDays(1),
            today,
        )
        val hasOpenSession = (recent as? AppResult.Success)?.value?.any {
            it.checkInAt != null && it.checkOutAt == null
        } == true
        if (hasOpenSession) startUpdates() else stopSelf()
    }

    private fun hasRequiredPermissions(): Boolean {
        val fine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val background = android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.Q ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED
        return fine && background
    }

    private fun notification(): Notification = NotificationCompat.Builder(this, AttendanceChannels.STATUS)
        .setSmallIcon(android.R.drawable.ic_menu_mylocation)
        .setContentTitle("Checkout monitoring active")
        .setContentText("GeoTrack will check you out when you leave the assigned work location.")
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .build()

    override fun onDestroy() {
        fusedLocation.removeLocationUpdates(callback)
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val NOTIFICATION_ID = 6_150
        private const val SAMPLE_INTERVAL_MS = 60_000L
        private const val MIN_SAMPLE_INTERVAL_MS = 30_000L

        fun start(context: Context) {
            runCatching {
                ContextCompat.startForegroundService(context, Intent(context, CheckoutMonitorService::class.java))
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, CheckoutMonitorService::class.java))
        }
    }
}
