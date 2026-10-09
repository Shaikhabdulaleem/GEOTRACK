package com.geotrack.mobile.location

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.work.BackoffPolicy
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofenceStatusCodes
import com.google.android.gms.location.GeofencingEvent
import java.time.Duration

class GeofenceBroadcastReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val diagnostics = runCatching { GeofenceDiagnostics.from(context) }.getOrNull()
        val geofencingEvent = GeofencingEvent.fromIntent(intent)
        if (geofencingEvent == null) {
            diagnostics?.record(GeofenceDiagnostics.Stage.RECEIVER, ok = false, message = "Received an empty geofencing intent.")
            return
        }
        if (geofencingEvent.hasError()) {
            val code = geofencingEvent.errorCode
            diagnostics?.record(
                GeofenceDiagnostics.Stage.RECEIVER,
                ok = false,
                message = "Geofencing error: ${GeofenceStatusCodes.getStatusCodeString(code)}.",
            )
            return
        }

        val geofenceTransition = geofencingEvent.geofenceTransition
        if (geofenceTransition == Geofence.GEOFENCE_TRANSITION_ENTER ||
            geofenceTransition == Geofence.GEOFENCE_TRANSITION_EXIT
        ) {
            val label = if (geofenceTransition == Geofence.GEOFENCE_TRANSITION_ENTER) "ENTER" else "EXIT"
            val ids = geofencingEvent.triggeringGeofences?.joinToString { it.requestId }.orEmpty()
            diagnostics?.record(
                GeofenceDiagnostics.Stage.RECEIVER,
                ok = true,
                message = "$label transition received${if (ids.isNotBlank()) " for $ids" else ""}; enqueuing worker.",
            )

            // Background network limits forbid work on the receiver thread, so a
            // Worker performs GPS + server validation. It is expedited and
            // retried with exponential backoff for transient failures.
            val inputData = Data.Builder()
                .putInt("transitionType", geofenceTransition)
                .build()

            val workRequest = OneTimeWorkRequestBuilder<GeofenceWorker>()
                .setInputData(inputData)
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, Duration.ofSeconds(30))
                .build()

            // A unique name per transition type collapses duplicate deliveries
            // while still letting an ENTER and a later EXIT both run.
            WorkManager.getInstance(context).enqueueUniqueWork(
                "geofence-transition-$geofenceTransition",
                ExistingWorkPolicy.REPLACE,
                workRequest,
            )
        } else {
            diagnostics?.record(
                GeofenceDiagnostics.Stage.RECEIVER,
                ok = true,
                message = "Ignored non-enter/exit transition ($geofenceTransition).",
            )
        }
    }
}
