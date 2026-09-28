package com.geotrack.mobile.notifications
import com.google.firebase.messaging.FirebaseMessagingService
import androidx.work.*

class GeotrackFirebaseMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) { WorkManager.getInstance(this).enqueueUniqueWork("push-token", ExistingWorkPolicy.REPLACE, OneTimeWorkRequestBuilder<PushTokenWorker>().build()) }
    override fun onMessageReceived(message: com.google.firebase.messaging.RemoteMessage) { message.data["notification_id"]?.let { WorkManager.getInstance(this).enqueue(OneTimeWorkRequestBuilder<FcmNotificationWorker>().setInputData(workDataOf("notification_id" to it)).build()) } }
}
