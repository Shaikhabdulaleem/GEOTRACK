package com.geotrack.mobile.presentation.notifications

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.geotrack.mobile.data.remote.dto.ServerNotificationDto
import com.geotrack.mobile.data.remote.supabase.SupabaseClientHolder
import com.geotrack.mobile.database.CachedNotificationEntity
import com.geotrack.mobile.database.GeoTrackDatabase
import com.geotrack.mobile.domain.repository.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.jan.supabase.postgrest.postgrest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class NotificationsViewModel @Inject constructor(
    private val auth: AuthRepository,
    private val holder: SupabaseClientHolder,
    private val database: GeoTrackDatabase,
) : ViewModel() {
    private val _items = MutableStateFlow<List<ServerNotificationDto>>(emptyList())
    val items: StateFlow<List<ServerNotificationDto>> = _items.asStateFlow()
    private val _loading = MutableStateFlow(true)
    val loading: StateFlow<Boolean> = _loading.asStateFlow()

    init {
        viewModelScope.launch {
            val userId = auth.session.first()?.userId
            if (userId != null) {
                // Best-effort refresh of server notifications into the local cache.
                runCatching {
                    val client = holder.client ?: error("offline")
                    val remote = client.postgrest["notifications"].select {
                        filter { eq("recipient_user_id", userId) }
                    }.decodeList<ServerNotificationDto>()
                    database.workforceCacheDao().upsertNotifications(remote.map { CachedNotificationEntity(it.id, userId, it.title, it.body, it.notificationType, it.readAt, it.createdAt, System.currentTimeMillis()) })
                }
                // Present the unified cache so on-device reminders and server
                // notifications appear together, newest first, online or offline.
                _items.value = database.workforceCacheDao().notifications(userId)
                    .map { ServerNotificationDto(it.notificationId, it.notificationType, it.title, it.body, it.createdAt, it.readAt) }
                    .sortedByDescending { it.createdAt }
            }
            _loading.value = false
        }
    }
}

@Composable
fun NotificationsScreen(viewModel: NotificationsViewModel = hiltViewModel()) {
    val items by viewModel.items.collectAsStateWithLifecycle()
    val loading by viewModel.loading.collectAsStateWithLifecycle()
    if (loading) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        return
    }
    val unread = items.count { it.readAt == null }
    LazyColumn(
        Modifier.fillMaxSize().padding(horizontal = 18.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Spacer(Modifier.height(16.dp))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(
                    Modifier.size(48.dp).clip(MaterialTheme.shapes.medium).background(MaterialTheme.colorScheme.primary),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Outlined.Notifications, contentDescription = null, tint = MaterialTheme.colorScheme.onPrimary)
                }
                Column {
                    Text("UPDATES", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onPrimaryContainer)
                    Text("Notifications", style = MaterialTheme.typography.headlineMedium)
                }
            }
            Text(
                if (unread > 0) "$unread new · attendance & schedule" else "You're all caught up",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 8.dp, bottom = 4.dp),
            )
        }
        if (items.isEmpty()) {
            item { Text("No notifications.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        items(items, key = { it.id }) { item ->
            NotificationCard(
                title = item.title,
                body = item.body,
                time = item.createdAt,
                type = item.notificationType,
                unread = item.readAt == null,
            )
        }
        item { Spacer(Modifier.height(16.dp)) }
    }
}

@Composable
private fun NotificationCard(title: String, body: String, time: String?, type: String?, unread: Boolean) {
    val (icon, tint) = iconFor(type)
    Card(
        Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = MaterialTheme.shapes.medium,
        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    ) {
        Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(
                Modifier.size(40.dp).clip(MaterialTheme.shapes.small).background(tint.copy(alpha = 0.14f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(20.dp))
            }
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    Text(title, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f, fill = false))
                    if (unread) Box(Modifier.size(8.dp).clip(CircleShape).background(MaterialTheme.colorScheme.secondary))
                }
                Spacer(Modifier.height(3.dp))
                Text(body, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                time?.let {
                    Spacer(Modifier.height(6.dp))
                    Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

@Composable
private fun iconFor(type: String?): Pair<ImageVector, Color> {
    val t = type?.lowercase() ?: ""
    return when {
        "check" in t || "attendance" in t -> Icons.Outlined.CheckCircle to MaterialTheme.colorScheme.secondary
        "schedule" in t || "shift" in t -> Icons.Outlined.CalendarMonth to MaterialTheme.colorScheme.onSecondaryContainer
        "overtime" in t -> Icons.Outlined.Timer to MaterialTheme.colorScheme.tertiary
        "location" in t || "geofence" in t -> Icons.Outlined.LocationOn to MaterialTheme.colorScheme.tertiary
        else -> Icons.Outlined.Notifications to MaterialTheme.colorScheme.primary
    }
}
