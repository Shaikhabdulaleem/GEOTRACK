package com.geotrack.mobile.location

import android.content.Context
import android.util.Log
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Actionable, persisted diagnostics for the automatic-attendance pipeline.
 *
 * Every stage — geofence registration, permission state, broadcast receipt,
 * worker execution and server validation — records a success/failure line here
 * instead of being swallowed. Lines survive process death (a small ring buffer
 * in SharedPreferences) and also go to logcat under [TAG], so a failing device
 * can be triaged from the in-app diagnostics screen or `adb logcat`.
 */
@Singleton
class GeofenceDiagnostics @Inject constructor(
    @ApplicationContext context: Context,
) {
    enum class Stage { REGISTRATION, PERMISSION, RECEIVER, WORKER, SERVER }

    data class Event(
        val stage: Stage,
        val ok: Boolean,
        val message: String,
        val epochMillis: Long,
    )

    private val prefs = context.applicationContext
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private val _events = MutableStateFlow(load())
    val events: StateFlow<List<Event>> = _events.asStateFlow()

    @Synchronized
    fun record(stage: Stage, ok: Boolean, message: String) {
        val event = Event(stage, ok, message, System.currentTimeMillis())
        if (ok) Log.i(TAG, "[$stage] $message") else Log.w(TAG, "[$stage] FAIL: $message")
        val next = (_events.value + event).takeLast(MAX_EVENTS)
        _events.value = next
        persist(next)
    }

    fun recent(limit: Int = MAX_EVENTS): List<Event> = _events.value.takeLast(limit).reversed()

    private fun persist(events: List<Event>) {
        val array = JSONArray()
        events.forEach { e ->
            array.put(
                JSONObject()
                    .put("s", e.stage.name)
                    .put("ok", e.ok)
                    .put("m", e.message)
                    .put("t", e.epochMillis),
            )
        }
        runCatching { prefs.edit().putString(KEY, array.toString()).apply() }
    }

    private fun load(): List<Event> = runCatching {
        val raw = prefs.getString(KEY, null) ?: return emptyList()
        val array = JSONArray(raw)
        buildList {
            for (i in 0 until array.length()) {
                val o = array.getJSONObject(i)
                add(
                    Event(
                        stage = runCatching { Stage.valueOf(o.getString("s")) }.getOrDefault(Stage.WORKER),
                        ok = o.optBoolean("ok", false),
                        message = o.optString("m"),
                        epochMillis = o.optLong("t", 0L),
                    ),
                )
            }
        }
    }.getOrDefault(emptyList())

    companion object {
        const val TAG = "GeoTrackAuto"
        private const val PREFS = "geofence-diagnostics"
        private const val KEY = "events"
        private const val MAX_EVENTS = 60

        /** Entry point so non-injected components (a BroadcastReceiver) can log. */
        fun from(context: Context): GeofenceDiagnostics =
            EntryPointAccessors.fromApplication(
                context.applicationContext,
                DiagnosticsEntryPoint::class.java,
            ).geofenceDiagnostics()
    }

    @EntryPoint
    @InstallIn(SingletonComponent::class)
    interface DiagnosticsEntryPoint {
        fun geofenceDiagnostics(): GeofenceDiagnostics
    }
}
