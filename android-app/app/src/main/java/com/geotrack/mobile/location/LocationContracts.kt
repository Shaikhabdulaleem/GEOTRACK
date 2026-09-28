package com.geotrack.mobile.location

import kotlinx.coroutines.flow.Flow

data class LocationPermissionState(
    val foregroundGranted: Boolean,
    val backgroundGranted: Boolean,
)

interface LocationCoordinator {
    val permissionState: Flow<LocationPermissionState>
}

data class LocationData(
    val latitude: Double,
    val longitude: Double,
    val accuracyMeters: Float,
    val isMock: Boolean
)

interface LocationTracker {
    suspend fun getCurrentLocation(): LocationData?
}
