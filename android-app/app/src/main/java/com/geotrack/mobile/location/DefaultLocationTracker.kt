package com.geotrack.mobile.location

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationManager
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

class DefaultLocationTracker @Inject constructor(
    private val fusedLocationProviderClient: FusedLocationProviderClient,
    @ApplicationContext private val context: Context
) : LocationTracker {

    @SuppressLint("MissingPermission")
    override suspend fun getCurrentLocation(): LocationData? {
        val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val hasGps = locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)
        val hasNetwork = locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)

        if (!hasGps && !hasNetwork) return null

        return suspendCancellableCoroutine { cont ->
            val cancellationTokenSource = CancellationTokenSource()
            // Do not reuse an old cached network fix for attendance. Give the
            // fused provider a short window to obtain a fresh high-accuracy
            // sample; the per-geofence threshold remains the final policy.
            val request = CurrentLocationRequest.Builder()
                .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
                .setMaxUpdateAgeMillis(0)
                .setDurationMillis(FRESH_FIX_TIMEOUT_MS)
                .build()
            fusedLocationProviderClient.getCurrentLocation(
                request,
                cancellationTokenSource.token
            ).addOnSuccessListener { location: Location? ->
                if (location != null) {
                    cont.resume(
                        LocationData(
                            latitude = location.latitude,
                            longitude = location.longitude,
                            accuracyMeters = location.accuracy,
                            isMock = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                                location.isMock
                            } else {
                                @Suppress("DEPRECATION")
                                location.isFromMockProvider
                            }
                        )
                    )
                } else {
                    cont.resume(null)
                }
            }.addOnFailureListener {
                cont.resume(null)
            }
            
            cont.invokeOnCancellation {
                cancellationTokenSource.cancel()
            }
        }
    }

    private companion object {
        const val FRESH_FIX_TIMEOUT_MS = 10_000L
    }
}
