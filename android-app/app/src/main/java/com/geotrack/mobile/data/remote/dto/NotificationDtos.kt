package com.geotrack.mobile.data.remote.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable data class ServerNotificationDto(
    val id: String,
    @SerialName("notification_type") val notificationType: String,
    val title: String,
    val body: String,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("read_at") val readAt: String? = null,
)
@Serializable data class PushTokenParams(@SerialName("p_token") val token: String, @SerialName("p_device_identifier") val deviceIdentifier: String, @SerialName("p_app_version") val appVersion: String)
