package com.geotrack.mobile.presentation.dashboard

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.geotrack.mobile.domain.model.TodayScheduleState
import java.time.LocalTime
import java.time.format.DateTimeFormatter

@Composable
fun DashboardScreen(
    viewModel: DashboardViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    val context = LocalContext.current

    val reqPermissions = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { _ -> }

    // Re-fetch today's schedule/attendance when the screen returns to the
    // foreground, so dashboard-side changes appear without an app restart. The
    // first resume is skipped because init already loaded.
    var firstResume by remember { mutableStateOf(true) }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        if (firstResume) firstResume = false else viewModel.refresh()
    }

    LaunchedEffect(uiState.errorMessage, uiState.successMessage) {
        if (uiState.errorMessage != null) {
            snackbarHostState.showSnackbar(uiState.errorMessage!!)
            viewModel.clearMessages()
        }
        if (uiState.successMessage != null) {
            snackbarHostState.showSnackbar(uiState.successMessage!!)
            viewModel.clearMessages()
        }
    }

    if (uiState.isLoading) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        return
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        // Greeting
        Column {
            Text(
                text = uiState.greeting,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = uiState.employeeName ?: "",
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold
            )
        }

        // 1 & 2. Schedule Banner (Am I working today? What shift?)
        SimpleScheduleBanner(uiState)

        // 3 & 4. Check In/Out (Am I checked in? What time?)
        if (uiState.scheduleState == TodayScheduleState.WORKING_DAY) {
            SimpleAttendanceCard(uiState, viewModel, reqPermissions, context)
        }

        // 5, 6, 7, 8. Stats Grid
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            SimpleStatCard(
                title = "Worked Today",
                value = uiState.todayWorkedDisplay,
                icon = Icons.Outlined.Schedule,
                modifier = Modifier.weight(1f)
            )
            SimpleStatCard(
                title = "Overtime",
                value = uiState.todayOvertimeDisplay,
                icon = Icons.Outlined.Timer,
                modifier = Modifier.weight(1f)
            )
        }

        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            val nextOff = uiState.nextOffDate ?: "--"
            SimpleStatCard(
                title = "Next OFF",
                value = nextOff,
                icon = Icons.Outlined.EventBusy,
                modifier = Modifier.weight(1f)
            )
            
            // Geofence / Location Status
            val locStatus = when {
                !uiState.hasForegroundLocation -> "No Permission"
                !uiState.isGpsEnabled -> "GPS Off"
                uiState.isInsideGeofence -> "Inside Geofence"
                else -> "Tracking"
            }
            
            SimpleStatCard(
                title = "Location",
                value = locStatus,
                icon = if (locStatus == "Inside Geofence" || locStatus == "Tracking") Icons.Outlined.LocationOn else Icons.Outlined.LocationOff,
                alert = locStatus == "No Permission" || locStatus == "GPS Off",
                modifier = Modifier.weight(1f)
            )
        }
        
        SnackbarHost(hostState = snackbarHostState)
    }
}

@Composable
fun SimpleScheduleBanner(uiState: DashboardUiState) {
    val isWorking = uiState.scheduleState == TodayScheduleState.WORKING_DAY
    val containerColor = if (isWorking) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant
    val contentColor = if (isWorking) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant
    
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = containerColor),
        shape = RoundedCornerShape(16.dp)
    ) {
        Column(
            modifier = Modifier.padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(
                text = if (isWorking) "WORKING TODAY" else "OFF TODAY",
                style = MaterialTheme.typography.titleSmall,
                color = contentColor.copy(alpha = 0.8f),
                fontWeight = FontWeight.Bold,
                letterSpacing = 1.sp
            )
            if (isWorking) {
                Text(
                    text = uiState.shiftName ?: "No Shift Assigned",
                    style = MaterialTheme.typography.headlineSmall,
                    color = contentColor,
                    fontWeight = FontWeight.Bold
                )
                val start = uiState.shiftStartTime?.toDisplayTime().orEmpty()
                val end = uiState.shiftEndTime?.toDisplayTime().orEmpty()
                Text(
                    text = if (start.isNotBlank() && end.isNotBlank()) "$start to $end" else "",
                    style = MaterialTheme.typography.titleMedium,
                    color = contentColor
                )
            } else {
                Text(
                    text = uiState.reason ?: "Scheduled OFF",
                    style = MaterialTheme.typography.headlineSmall,
                    color = contentColor,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = "Next Working Day: ${uiState.nextWorkingDate ?: "Unknown"}",
                    style = MaterialTheme.typography.titleMedium,
                    color = contentColor
                )
            }
        }
    }
}

private fun String.toDisplayTime(): String = runCatching {
    LocalTime.parse(take(8)).format(DateTimeFormatter.ofPattern("h:mm a"))
}.getOrDefault(this)

@Composable
fun SimpleAttendanceCard(
    uiState: DashboardUiState, 
    viewModel: DashboardViewModel,
    reqPerms: androidx.activity.result.ActivityResultLauncher<Array<String>>,
    context: Context
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        shape = RoundedCornerShape(16.dp)
    ) {
        Column(
            modifier = Modifier.padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Clock
            Text(
                text = uiState.currentTime,
                style = MaterialTheme.typography.displayMedium,
                fontWeight = FontWeight.Bold
            )
            
            // Status
            if (uiState.isCheckedIn) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Outlined.CheckCircle, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                    Text(
                        text = "Checked In at ${uiState.checkInTimeStr ?: "Unknown"}",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.primary,
                        fontWeight = FontWeight.Bold
                    )
                }
            } else {
                Text(
                    text = "You are not checked in",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            
            if (!uiState.isAttendanceAllowed) {
                Text(
                    text = "No active shift is assigned for today.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium,
                )
            // Action Button
            } else if (!uiState.hasForegroundLocation || !uiState.isGpsEnabled) {
                Button(
                    onClick = {
                        if (!uiState.hasForegroundLocation) {
                            reqPerms.launch(arrayOf(
                                android.Manifest.permission.ACCESS_FINE_LOCATION,
                                android.Manifest.permission.ACCESS_COARSE_LOCATION
                            ))
                        } else {
                            context.startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
                        }
                    },
                    modifier = Modifier.fillMaxWidth().height(56.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
                ) {
                    Text(
                        when {
                            !uiState.hasForegroundLocation -> "ALLOW LOCATION TO CHECK IN"
                            else -> "ENABLE GPS TO CHECK IN"
                        },
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }
            } else {
                Button(
                    onClick = { if (uiState.isCheckedIn) viewModel.onCheckOut() else viewModel.onCheckIn() },
                    modifier = Modifier.fillMaxWidth().height(56.dp),
                    enabled = !uiState.isCheckingIn
                ) {
                    if (uiState.isCheckingIn) {
                        CircularProgressIndicator(modifier = Modifier.size(24.dp), color = MaterialTheme.colorScheme.onPrimary)
                    } else {
                        Text(
                            text = if (uiState.isCheckedIn) "CHECK OUT" else "CHECK IN",
                            fontSize = 18.sp, 
                            fontWeight = FontWeight.Bold
                        )
                    }
                }
            }
            if (uiState.syncStatus == "PENDING_SYNC" || uiState.syncStatus == "SYNC_FAILED") {
                val color = if (uiState.syncStatus == "SYNC_FAILED") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.tertiary
                val text = if (uiState.syncStatus == "SYNC_FAILED") "Failed to sync attendance" else "Attendance Pending Sync (Offline)"
                Text(text = text, color = color, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
fun SimpleStatCard(title: String, value: String, icon: androidx.compose.ui.graphics.vector.ImageVector, alert: Boolean = false, modifier: Modifier = Modifier) {
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(containerColor = if (alert) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surfaceVariant),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Icon(
                imageVector = icon, 
                contentDescription = null,
                tint = if (alert) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.primary
            )
            Text(
                text = value,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                color = if (alert) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSurface
            )
            Text(
                text = title,
                style = MaterialTheme.typography.bodySmall,
                color = if (alert) MaterialTheme.colorScheme.onErrorContainer.copy(alpha=0.8f) else MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}
