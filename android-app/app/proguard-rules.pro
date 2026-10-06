# GeoTrack release R8/ProGuard rules.
#
# IMPORTANT: Minification is enabled for release builds. After changing
# dependencies or serializable models, build a SIGNED release and smoke-test
# login, attendance check-in/out, offline sync, and push on a real device.
# R8 strips reflection-only code; the rules below keep the fragile parts.

# ── Kotlin metadata & coroutines ──────────────────────────────────────────
-keepattributes *Annotation*, InnerClasses, Signature, Exceptions, EnclosingMethod
-dontwarn kotlinx.coroutines.**
-keepclassmembers class kotlinx.coroutines.** { volatile <fields>; }

# ── kotlinx.serialization ─────────────────────────────────────────────────
# Keep the generated serializers and every @Serializable model (DTOs, domain
# models, RPC request/response types) so JSON (de)serialization survives R8.
-keepattributes RuntimeVisibleAnnotations, AnnotationDefault
-keepclasseswithmembers,allowshrinking,allowoptimization class ** {
    @kotlinx.serialization.Serializable <methods>;
}
-if @kotlinx.serialization.Serializable class **
-keepclassmembers class <1> {
    static <1>$Companion Companion;
    static kotlinx.serialization.KSerializer serializer(...);
}
-keepclasseswithmembers class **$$serializer { *; }
-keep,includedescriptorclasses class com.geotrack.mobile.**$$serializer { *; }
-keepclassmembers class com.geotrack.mobile.** {
    *** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}
-keep @kotlinx.serialization.Serializable class com.geotrack.mobile.** { *; }

# ── Supabase-kt + Ktor client ─────────────────────────────────────────────
-keep class io.github.jan.supabase.** { *; }
-dontwarn io.github.jan.supabase.**
-keep class io.ktor.** { *; }
-dontwarn io.ktor.**
-keepclassmembers class io.ktor.** { volatile <fields>; }
-dontwarn org.slf4j.**

# ── Hilt / Dagger (keep generated DI graph entry points) ──────────────────
-keep class dagger.hilt.** { *; }
-keep class * extends dagger.hilt.android.internal.managers.ViewComponentManager$FragmentContextWrapper
-keepclasseswithmembers class * { @dagger.hilt.* <methods>; }

# ── Room (generated DAOs/impls) ───────────────────────────────────────────
-keep class * extends androidx.room.RoomDatabase { <init>(); }
-keep @androidx.room.Entity class * { *; }
-dontwarn androidx.room.paging.**

# ── Firebase Cloud Messaging ──────────────────────────────────────────────
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**
-keep class com.geotrack.mobile.notifications.** { *; }

# ── App models kept for server JSON contracts ─────────────────────────────
-keep class com.geotrack.mobile.data.remote.dto.** { *; }
-keep class com.geotrack.mobile.domain.model.** { *; }
