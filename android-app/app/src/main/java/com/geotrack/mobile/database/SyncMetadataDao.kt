package com.geotrack.mobile.database

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert

@Dao
interface SyncMetadataDao {
    @Query("SELECT * FROM sync_metadata WHERE `key` = :key LIMIT 1")
    suspend fun find(key: String): SyncMetadataEntity?

    @Upsert
    suspend fun upsert(metadata: SyncMetadataEntity)
}
