package com.geotrack.mobile

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import dagger.hilt.android.HiltAndroidApp
import com.geotrack.mobile.notifications.FirebaseConfig
import javax.inject.Inject

@HiltAndroidApp
class GeotrackApplication : Application(), Configuration.Provider {

    @Inject
    lateinit var workerFactory: HiltWorkerFactory

    override fun onCreate() {
        super.onCreate()
        // Initialize the default Firebase app before an FCM service is started
        // in a cold/background process. No Firebase app is created when the
        // build has no Firebase configuration.
        FirebaseConfig.ensure(this)
    }

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setWorkerFactory(workerFactory)
            .build()
}
