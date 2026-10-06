package com.geotrack.mobile.data.remote.supabase

import com.geotrack.mobile.core.config.SupabaseConfig
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.functions.Functions
import io.github.jan.supabase.postgrest.Postgrest
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SupabaseClientHolder @Inject constructor(
    val config: SupabaseConfig,
) {
    /** Null means the app was built without runtime-safe client configuration. */
    val client: SupabaseClient? = if (config.isConfigured) {
        createSupabaseClient(
            supabaseUrl = config.url,
            supabaseKey = config.publishableKey,
        ) {
            install(Auth) {
                // Supabase Auth persists and refreshes the session; the Android
                // app never implements its own user/session database.
                autoLoadFromStorage = true
                autoSaveToStorage = true
                alwaysAutoRefresh = true
            }
            install(Postgrest)
            // Used to call the employee-login Edge Function, which signs in
            // employees by Employee ID / Iqama (no mailbox required).
            install(Functions)
        }
    } else {
        null
    }
}
