package com.geotrack.mobile.presentation.notifications

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
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
                try {
                    val client = holder.client ?: error("offline")
                    val remote = client.postgrest["notifications"].select {
                        filter { eq("recipient_user_id", userId) }
                    }.decodeList<ServerNotificationDto>()
                    _items.value = remote
                    database.workforceCacheDao().upsertNotifications(remote.map { CachedNotificationEntity(it.id, userId, it.title, it.body, it.notificationType, it.readAt, it.createdAt, System.currentTimeMillis()) })
                } catch (_: Exception) {
                    _items.value = database.workforceCacheDao().notifications(userId).map { ServerNotificationDto(it.notificationId, it.notificationType, it.title, it.body, it.createdAt, it.readAt) }
                }
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
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center) { CircularProgressIndicator() }
        return
    }
    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Text("Notifications", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold) }
        if (items.isEmpty()) item { Text("No notifications.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
        items(items, key = { it.id }) { item ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Text(item.title, fontWeight = FontWeight.Bold)
                    Text(item.body, style = MaterialTheme.typography.bodyMedium)
                    item.createdAt?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }
        }
    }
}
