package com.geotrack.mobile.database

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [
        SyncMetadataEntity::class,
        OfflineAttendanceEventEntity::class,
        CachedEmployeeProfileEntity::class,
        CachedScheduleEntity::class,
        CachedGeofenceEntity::class,
        CachedAttendanceEntity::class,
        CachedNotificationEntity::class,
    ],
    version = 3,
    exportSchema = false,
)
abstract class GeoTrackDatabase : RoomDatabase() {
    abstract fun syncMetadataDao(): SyncMetadataDao
    abstract fun offlineAttendanceDao(): OfflineAttendanceDao
    abstract fun workforceCacheDao(): WorkforceCacheDao

    suspend fun clearUserData() {
        offlineAttendanceDao().clearAll()
        workforceCacheDao().clearAll()
    }
}
