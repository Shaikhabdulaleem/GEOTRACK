package com.geotrack.mobile.location

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingClient
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

@Singleton
class GeofenceManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val diagnostics: GeofenceDiagnostics,
) {
    private val geofencingClient: GeofencingClient = LocationServices.getGeofencingClient(context)

    private val geofencePendingIntent: PendingIntent by lazy {
        val intent = Intent(context, GeofenceBroadcastReceiver::class.java)
        PendingIntent.getBroadcast(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
        )
    }

    /** True only when every permission the OS requires to monitor geofences in
     * the background is granted. The platform silently refuses registration
     * otherwise, so this is checked (and surfaced) before every attempt. */
    fun canMonitor(): Boolean = missingPermissions().isEmpty()

    fun missingPermissions(): List<String> {
        val missing = mutableListOf<String>()
        if (!granted(Manifest.permission.ACCESS_FINE_LOCATION)) {
            missing += "fine location"
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
            !granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        ) {
            missing += "background location (\"Allow all the time\")"
        }
        return missing
    }

    private fun granted(permission: String): Boolean =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    @SuppressLint("MissingPermission")
    fun addGeofence(geofenceId: String, lat: Double, lng: Double, radiusMeters: Float, label: String? = null) {
        val missing = missingPermissions()
        if (missing.isNotEmpty()) {
            diagnostics.record(
                GeofenceDiagnostics.Stage.PERMISSION,
                ok = false,
                message = "Cannot register ${label ?: geofenceId}: missing ${missing.joinToString()}.",
            )
            return
        }

        val geofence = Geofence.Builder()
            .setRequestId(geofenceId)
            .setCircularRegion(lat, lng, radiusMeters)
            .setExpirationDuration(Geofence.NEVER_EXPIRE)
            // Lower responsiveness lets the OS batch for battery; the server
            // re-validates the precise polygon so a few seconds' latency is fine.
            .setNotificationResponsiveness(30_000)
            .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER or Geofence.GEOFENCE_TRANSITION_EXIT)
            .build()

        val geofencingRequest = GeofencingRequest.Builder()
            // INITIAL_TRIGGER_ENTER makes the platform fire ENTER immediately if
            // the device is already inside at registration time — the key to
            // auto check-in for an employee who arrived before their shift.
            .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER)
            .addGeofence(geofence)
            .build()

        geofencingClient.addGeofences(geofencingRequest, geofencePendingIntent)
            .addOnSuccessListener {
                diagnostics.record(
                    GeofenceDiagnostics.Stage.REGISTRATION,
                    ok = true,
                    message = "Registered ${label ?: geofenceId} (r=${radiusMeters.toInt()}m).",
                )
            }
            .addOnFailureListener { error ->
                diagnostics.record(
                    GeofenceDiagnostics.Stage.REGISTRATION,
                    ok = false,
                    message = "Failed to register ${label ?: geofenceId}: ${error.message ?: error.javaClass.simpleName}. " +
                        "Check Location is on and set to high accuracy.",
                )
            }
    }

    fun removeGeofences() {
        geofencingClient.removeGeofences(geofencePendingIntent)
        diagnostics.record(GeofenceDiagnostics.Stage.REGISTRATION, ok = true, message = "Removed all geofences.")
    }

    /**
     * Registers a circular trigger that **fully encloses** the assigned polygon.
     *
     * Android geofences are circular only, so we take the smallest circle that
     * contains every polygon vertex (plus a GPS-noise buffer). Over-covering is
     * intentional: the platform ENTER fires at or before the true polygon
     * boundary so no crossing is missed, and the server's PostGIS point-in-
     * polygon check remains the authoritative gate for marking attendance.
     */
    fun addGeofenceFromGeoJson(geofenceId: String, polygon: JsonElement, label: String? = null) {
        val points = flattenCoordinatePairs(polygon)
        if (points.isEmpty()) {
            diagnostics.record(
                GeofenceDiagnostics.Stage.REGISTRATION,
                ok = false,
                message = "Geofence ${label ?: geofenceId} has no usable polygon coordinates.",
            )
            return
        }
        val lat = points.map { it.second }.average()
        val lng = points.map { it.first }.average()
        val enclosing = points.maxOf { point -> distanceMeters(lat, lng, point.second, point.first) }
        // Buffer for GPS jitter; floor so a tiny site still triggers reliably.
        val radius = (enclosing + GPS_BUFFER_METERS).coerceIn(MIN_RADIUS_METERS, MAX_RADIUS_METERS)
        addGeofence(geofenceId, lat, lng, radius, label)
    }

    private fun distanceMeters(aLat: Double, aLng: Double, bLat: Double, bLng: Double): Float {
        val results = FloatArray(1)
        android.location.Location.distanceBetween(aLat, aLng, bLat, bLng, results)
        return results[0]
    }

    private companion object {
        const val GPS_BUFFER_METERS = 30f
        const val MIN_RADIUS_METERS = 100f
        const val MAX_RADIUS_METERS = 50_000f
    }
}

/**
 * Flattens any nesting of a stored geofence polygon into (lng, lat) pairs.
 *
 * The DB stores a GeoJSON MultiPolygon object
 * (`{"type":"MultiPolygon","coordinates":[[[[lng,lat],…]]]}`), so this descends
 * through both object values and arrays until it reaches `[lng, lat]` primitive
 * pairs. Top-level so it can be unit tested without Android.
 */
internal fun flattenCoordinatePairs(element: JsonElement): List<Pair<Double, Double>> = when (element) {
    is JsonArray -> if (element.size >= 2 && element[0] is JsonPrimitive && element[1] is JsonPrimitive &&
        element[0].toString().toDoubleOrNull() != null && element[1].toString().toDoubleOrNull() != null
    ) {
        listOf(element[0].toString().toDouble() to element[1].toString().toDouble())
    } else {
        element.flatMap { flattenCoordinatePairs(it) }
    }
    is JsonObject -> element.values.flatMap { flattenCoordinatePairs(it) }
    else -> emptyList()
}
