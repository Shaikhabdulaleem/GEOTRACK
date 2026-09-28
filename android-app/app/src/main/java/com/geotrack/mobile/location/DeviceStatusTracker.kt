package com.geotrack.mobile.location

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Build
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
    val isGpsEnabled: Boolean
)

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
                           
        return DeviceStatus(
            hasForegroundLocation = hasForeground,
            hasBackgroundLocation = hasBackground,
            hasNotifications = hasNotifications,
            isGpsEnabled = isGpsEnabled
        )
    }
    
    private fun hasPermission(permission: String): Boolean {
        return ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
    }
}
