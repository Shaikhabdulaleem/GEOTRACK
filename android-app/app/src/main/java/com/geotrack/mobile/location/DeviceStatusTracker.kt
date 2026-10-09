package com.geotrack.mobile.location

import android.app.AlarmManager
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Build
import android.os.PowerManager
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import javax.inject.Inject
import javax.inject.Singleton

enum class PermissionState {
    GRANTED,
    DENIED,
    PERMANENTLY_DENIED, // This requires a separate Compose effect to track shouldShowRequestPermissionRationale, but we'll approximate here
    NOT_REQUESTED
}

data class DeviceStatus(
    val hasForegroundLocation: Boolean,
    val hasBackgroundLocation: Boolean,
    val hasNotifications: Boolean,
    val isGpsEnabled: Boolean,
    /** Exact alarms allowed — required for precise reminder delivery on 12+. */
    val canScheduleExactAlarms: Boolean = true,
    /** App is exempt from Doze battery optimization (reliable background work). */
    val isIgnoringBatteryOptimizations: Boolean = true,
    /** The attendance reminders channel is enabled (not silenced by the user). */
    val remindersChannelEnabled: Boolean = true,
) {
    /** True when automatic attendance + reminders can work unimpeded. */
    val isFullyConfigured: Boolean
        get() = hasForegroundLocation && hasBackgroundLocation && hasNotifications &&
            isGpsEnabled && canScheduleExactAlarms && isIgnoringBatteryOptimizations &&
            remindersChannelEnabled
}

@Singleton
class DeviceStatusTracker @Inject constructor(
    @ApplicationContext private val context: Context
) {

    val statusFlow: Flow<DeviceStatus> = callbackFlow {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent?) {
                if (intent?.action == LocationManager.PROVIDERS_CHANGED_ACTION) {
                    trySend(getCurrentStatus())
                }
            }
        }
        
        context.registerReceiver(
            receiver, 
            IntentFilter(LocationManager.PROVIDERS_CHANGED_ACTION)
        )
        
        // Initial state
        trySend(getCurrentStatus())
        
        awaitClose {
            context.unregisterReceiver(receiver)
        }
    }

    fun getCurrentStatus(): DeviceStatus {
        val hasForeground = hasPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) || 
                            hasPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION)
        
        val hasBackground = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            hasPermission(android.Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        } else {
            hasForeground
        }
        
        val hasNotifications = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            hasPermission(android.Manifest.permission.POST_NOTIFICATIONS)
        } else {
            true
        }
        
        val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val isGpsEnabled = locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
                           locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)

        val canExact = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            context.getSystemService(AlarmManager::class.java)?.canScheduleExactAlarms() ?: true
        } else {
            true
        }

        val ignoringBattery = runCatching {
            val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            pm.isIgnoringBatteryOptimizations(context.packageName)
        }.getOrDefault(true)

        val remindersEnabled = runCatching {
            val nm = context.getSystemService(NotificationManager::class.java)
            if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
                false
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val channel = nm.getNotificationChannel("attendance_reminders")
                channel == null || channel.importance != NotificationManager.IMPORTANCE_NONE
            } else {
                true
            }
        }.getOrDefault(true)

        return DeviceStatus(
            hasForegroundLocation = hasForeground,
            hasBackgroundLocation = hasBackground,
            hasNotifications = hasNotifications,
            isGpsEnabled = isGpsEnabled,
            canScheduleExactAlarms = canExact,
            isIgnoringBatteryOptimizations = ignoringBattery,
            remindersChannelEnabled = remindersEnabled,
        )
    }
    
    private fun hasPermission(permission: String): Boolean {
        return ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
    }
}
