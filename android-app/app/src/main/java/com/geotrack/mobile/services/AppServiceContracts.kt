package com.geotrack.mobile.services

/** Platform service boundaries; implementations are added with feature work. */
interface SyncCoordinator {
    suspend fun requestSync()
}
