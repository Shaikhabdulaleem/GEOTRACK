package com.geotrack.mobile.location

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingClient
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive

class GeofenceManager @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private val geofencingClient: GeofencingClient = LocationServices.getGeofencingClient(context)

    private val geofencePendingIntent: PendingIntent by lazy {
        val intent = Intent(context, GeofenceBroadcastReceiver::class.java)
        PendingIntent.getBroadcast(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        )
    }

    @SuppressLint("MissingPermission")
    fun addGeofence(geofenceId: String, lat: Double, lng: Double, radiusMeters: Float) {
        val geofence = Geofence.Builder()
            .setRequestId(geofenceId)
            .setCircularRegion(lat, lng, radiusMeters)
            .setExpirationDuration(Geofence.NEVER_EXPIRE)
            .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER or Geofence.GEOFENCE_TRANSITION_EXIT)
            .build()

        val geofencingRequest = GeofencingRequest.Builder()
            .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER)
            .addGeofence(geofence)
            .build()

        geofencingClient.addGeofences(geofencingRequest, geofencePendingIntent)
            .addOnSuccessListener {
                // Successfully added circular trigger
            }
            .addOnFailureListener {
                // Failed to add
            }
    }

    fun removeGeofences() {
        geofencingClient.removeGeofences(geofencePendingIntent)
    }

    /** Registers a conservative circular approximation for a cached polygon.
     * Server-side polygon validation remains authoritative for attendance. */
    fun addGeofenceFromGeoJson(geofenceId: String, polygon: JsonElement) {
        val points = polygon.flattenCoordinatePairs()
        if (points.isEmpty()) return
        val lat = points.map { it.second }.average()
        val lng = points.map { it.first }.average()
        val radius = points.maxOf { point -> distanceMeters(lat, lng, point.second, point.first) }
            .coerceIn(50f, 1000f)
        addGeofence(geofenceId, lat, lng, radius)
    }

    private fun distanceMeters(aLat: Double, aLng: Double, bLat: Double, bLng: Double): Float {
        val results = FloatArray(1)
        android.location.Location.distanceBetween(aLat, aLng, bLat, bLng, results)
        return results[0]
    }

    private fun JsonElement.flattenCoordinatePairs(): List<Pair<Double, Double>> = when (this) {
        is JsonArray -> if (size >= 2 && get(0) is JsonPrimitive && get(1) is JsonPrimitive &&
            get(0).toString().toDoubleOrNull() != null && get(1).toString().toDoubleOrNull() != null) {
            listOf(get(0).toString().toDouble() to get(1).toString().toDouble())
        } else flatMap { it.flattenCoordinatePairs() }
        else -> emptyList()
    }
}
