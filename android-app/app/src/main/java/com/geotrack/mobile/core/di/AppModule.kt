package com.geotrack.mobile.core.di

import android.content.Context
import androidx.room.Room
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import com.geotrack.mobile.core.config.SupabaseConfig
import com.geotrack.mobile.data.repository.SupabaseAuthRepository
import com.geotrack.mobile.data.repository.SupabaseSessionRepository
import com.geotrack.mobile.database.GeoTrackDatabase
import com.geotrack.mobile.domain.repository.AuthRepository
import com.geotrack.mobile.domain.repository.SessionRepository
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton
import com.geotrack.mobile.notifications.*
import com.geotrack.mobile.phoneusage.AndroidPhoneUsageReader
import com.geotrack.mobile.phoneusage.PhoneUsageReader

@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    @Provides
    @Singleton
    fun provideSupabaseConfig(): SupabaseConfig = SupabaseConfig.fromBuildConfig()

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): GeoTrackDatabase =
        Room.databaseBuilder(
            context,
            GeoTrackDatabase::class.java,
            "geotrack.db",
        ).addMigrations(object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("CREATE TABLE IF NOT EXISTS offline_attendance_events (localEventId TEXT NOT NULL PRIMARY KEY, organizationId TEXT NOT NULL, employeeId TEXT NOT NULL, actionType TEXT NOT NULL, deviceTimestampEpochMillis INTEGER NOT NULL, originalEventTime TEXT NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL, accuracyMeters REAL NOT NULL, isMockLocation INTEGER NOT NULL, geofenceValidation TEXT NOT NULL, syncStatus TEXT NOT NULL, retryCount INTEGER NOT NULL, lastError TEXT, serverEventId TEXT, updatedAtEpochMillis INTEGER NOT NULL)")
                db.execSQL("CREATE TABLE IF NOT EXISTS cached_employee_profiles (organizationId TEXT NOT NULL, employeeId TEXT NOT NULL, fullName TEXT NOT NULL, employeeCode TEXT NOT NULL, branchId TEXT NOT NULL, departmentId TEXT NOT NULL, employmentStatus TEXT NOT NULL, cachedAt INTEGER NOT NULL, PRIMARY KEY(organizationId, employeeId))")
                db.execSQL("CREATE TABLE IF NOT EXISTS cached_schedules (employeeId TEXT NOT NULL, workDate TEXT NOT NULL, state TEXT NOT NULL, assignmentId TEXT, shiftName TEXT, startTime TEXT, endTime TEXT, crossesMidnight INTEGER NOT NULL, cachedAt INTEGER NOT NULL, PRIMARY KEY(employeeId, workDate))")
                db.execSQL("CREATE TABLE IF NOT EXISTS cached_geofences (employeeId TEXT NOT NULL, geofenceId TEXT NOT NULL, name TEXT NOT NULL, polygonJson TEXT NOT NULL, effectiveFrom TEXT, effectiveTo TEXT, cachedAt INTEGER NOT NULL, PRIMARY KEY(employeeId, geofenceId))")
                db.execSQL("CREATE TABLE IF NOT EXISTS cached_attendance (employeeId TEXT NOT NULL, attendanceDate TEXT NOT NULL, sessionNumber INTEGER NOT NULL, status TEXT NOT NULL, checkInAt TEXT, checkOutAt TEXT, workedMinutes INTEGER NOT NULL, overtimeMinutes INTEGER NOT NULL, syncStatus TEXT NOT NULL, cachedAt INTEGER NOT NULL, PRIMARY KEY(employeeId, attendanceDate, sessionNumber))")
                db.execSQL("CREATE TABLE IF NOT EXISTS cached_notifications (notificationId TEXT NOT NULL PRIMARY KEY, recipientUserId TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, notificationType TEXT NOT NULL, readAt TEXT, createdAt TEXT, cachedAt INTEGER NOT NULL)")
            }
        }).addMigrations(object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE offline_attendance_events ADD COLUMN geofenceId TEXT")
            }
        }).fallbackToDestructiveMigrationOnDowngrade().build()
        
    @Provides
    @Singleton
    fun provideFusedLocationProviderClient(
        @ApplicationContext context: Context
    ): com.google.android.gms.location.FusedLocationProviderClient =
        com.google.android.gms.location.LocationServices.getFusedLocationProviderClient(context)
}

@Module
@InstallIn(SingletonComponent::class)
abstract class RepositoryModule {
    @Binds
    @Singleton
    abstract fun bindAuthRepository(repository: SupabaseAuthRepository): AuthRepository

    @Binds
    @Singleton
    abstract fun bindSessionRepository(repository: SupabaseSessionRepository): SessionRepository

    @Binds
    @Singleton
    abstract fun bindScheduleRepository(repository: com.geotrack.mobile.data.repository.SupabaseScheduleRepository): com.geotrack.mobile.domain.repository.ScheduleRepository

    @Binds
    @Singleton
    abstract fun bindAttendanceRepository(repository: com.geotrack.mobile.data.repository.SupabaseAttendanceRepository): com.geotrack.mobile.domain.repository.AttendanceRepository

    @Binds
    @Singleton
    abstract fun bindOvertimeRepository(repository: com.geotrack.mobile.data.repository.SupabaseOvertimeRepository): com.geotrack.mobile.domain.repository.OvertimeRepository

    @Binds
    @Singleton
    abstract fun bindProductivityRepository(repository: com.geotrack.mobile.data.repository.SupabaseProductivityRepository): com.geotrack.mobile.domain.repository.ProductivityRepository

    @Binds
    @Singleton
    abstract fun bindPhoneUsageReader(reader: AndroidPhoneUsageReader): PhoneUsageReader

    @Binds
    @Singleton
    abstract fun bindPhoneUsageRepository(repository: com.geotrack.mobile.data.repository.SupabasePhoneUsageRepository): com.geotrack.mobile.domain.repository.PhoneUsageRepository

    @Binds
    @Singleton
    abstract fun bindManagerRepository(repository: com.geotrack.mobile.data.repository.SupabaseManagerRepository): com.geotrack.mobile.domain.repository.ManagerRepository
    
    @Binds
    @Singleton
    abstract fun bindLocationTracker(tracker: com.geotrack.mobile.location.DefaultLocationTracker): com.geotrack.mobile.location.LocationTracker

    @Binds @Singleton
    abstract fun bindNotificationRepository(repository: com.geotrack.mobile.data.repository.SupabaseAttendanceNotificationRepository): AttendanceNotificationRepository

    @Binds @Singleton
    abstract fun bindNotificationCoordinator(coordinator: AndroidAttendanceNotificationCoordinator): NotificationCoordinator

    @Binds
    @Singleton
    abstract fun bindAdminRepository(repository: com.geotrack.mobile.data.repository.SupabaseAdminRepository): com.geotrack.mobile.domain.repository.AdminRepository
}
