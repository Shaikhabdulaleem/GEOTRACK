package com.geotrack.mobile.core.config

import com.geotrack.mobile.BuildConfig

/** Client-safe Supabase configuration. Never put a service-role key in this object. */
data class SupabaseConfig(
    val url: String,
    val publishableKey: String,
) {
    val isConfigured: Boolean
        get() = url.isNotBlank() && publishableKey.isNotBlank()

    companion object {
        fun fromBuildConfig(): SupabaseConfig = SupabaseConfig(
            url = BuildConfig.SUPABASE_URL.trim(),
            publishableKey = BuildConfig.SUPABASE_ANON_KEY.trim(),
        )
    }
}
