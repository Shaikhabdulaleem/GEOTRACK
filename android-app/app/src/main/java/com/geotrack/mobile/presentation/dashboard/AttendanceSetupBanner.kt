package com.geotrack.mobile.presentation.dashboard

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import com.geotrack.mobile.location.DeviceStatus
import com.geotrack.mobile.location.DeviceStatusTracker

/**
 * Clear, actionable setup guidance shown when a permission or system setting is
 * blocking automatic attendance or reminders. Each row deep-links to the exact
 * screen the employee needs. Hidden entirely once everything is configured.
 */
@Composable
fun AttendanceSetupBanner(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val tracker = remember { DeviceStatusTracker(context) }
    var status by remember { mutableStateOf(tracker.getCurrentStatus()) }

    // Re-check whenever the screen resumes (the user may have just changed a
    // setting in system Settings and come back).
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { status = tracker.getCurrentStatus() }

    val notificationLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { status = tracker.getCurrentStatus() }

    if (status.isFullyConfigured) return

    val items = buildSetupItems(status)
    if (items.isEmpty()) return

    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
        shape = RoundedCornerShape(16.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Outlined.WarningAmber, contentDescription = null, tint = MaterialTheme.colorScheme.onErrorContainer)
                Text(
                    text = "Finish setup for automatic attendance",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onErrorContainer,
                )
            }
            Text(
                text = "Until these are enabled, GeoTrack cannot reliably mark your attendance or remind you about your shift.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onErrorContainer,
            )
            items.forEach { item ->
                Column(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = item.title,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onErrorContainer,
                    )
                    Text(
                        text = item.detail,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onErrorContainer,
                    )
                    TextButton(onClick = {
                        if (item.isNotificationPermission && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                            notificationLauncher.launch(android.Manifest.permission.POST_NOTIFICATIONS)
                        } else {
                            runCatching { context.startActivity(item.intent(context)) }
                        }
                    }) {
                        Text(item.action)
                    }
                }
            }
        }
    }
}

private data class SetupItem(
    val title: String,
    val detail: String,
    val action: String,
    val isNotificationPermission: Boolean = false,
    val intent: (Context) -> Intent,
)

private fun appSettingsIntent(context: Context): Intent =
    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))

private fun buildSetupItems(status: DeviceStatus): List<SetupItem> = buildList {
    if (!status.hasForegroundLocation || !status.hasBackgroundLocation) {
        add(
            SetupItem(
                title = "Allow location all the time",
                detail = "Automatic check-in needs location set to \"Allow all the time\".",
                action = "Open location settings",
                intent = ::appSettingsIntent,
            ),
        )
    }
    if (!status.isGpsEnabled) {
        add(
            SetupItem(
                title = "Turn on GPS / Location",
                detail = "Device location services are switched off.",
                action = "Turn on location",
                intent = { Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS) },
            ),
        )
    }
    if (!status.hasNotifications) {
        add(
            SetupItem(
                title = "Allow notifications",
                detail = "Shift reminders can't be shown without notification permission.",
                action = "Allow notifications",
                isNotificationPermission = true,
                intent = ::appSettingsIntent,
            ),
        )
    }
    if (!status.remindersChannelEnabled) {
        add(
            SetupItem(
                title = "Enable the reminders channel",
                detail = "The \"Attendance reminders\" notification category is turned off.",
                action = "Open notification settings",
                intent = { context ->
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                            .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                    } else {
                        appSettingsIntent(context)
                    }
                },
            ),
        )
    }
    if (!status.canScheduleExactAlarms) {
        add(
            SetupItem(
                title = "Allow exact alarms",
                detail = "Required so pre-shift and not-marked reminders arrive on time.",
                action = "Allow exact alarms",
                intent = { context ->
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${context.packageName}"))
                    } else {
                        appSettingsIntent(context)
                    }
                },
            ),
        )
    }
    if (!status.isIgnoringBatteryOptimizations) {
        add(
            SetupItem(
                title = "Remove battery restrictions",
                detail = "Battery optimization can stop background check-in and reminders.",
                action = "Open battery settings",
                intent = { Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS) },
            ),
        )
    }
}
