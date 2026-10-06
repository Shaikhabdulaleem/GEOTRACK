import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("org.jetbrains.kotlin.kapt")
    id("com.google.dagger.hilt.android")
}

val localConfig = providers.fileContents(rootProject.layout.projectDirectory.file("local.properties"))
    .asText.orElse("").map { content ->
        Properties().apply { load(content.reader()) }
    }

fun clientConfig(name: String) = providers.gradleProperty(name)
    .orElse(providers.environmentVariable(name))
    .orElse(localConfig.map { it.getProperty(name).orEmpty() })

val configuredSupabaseUrl = clientConfig("SUPABASE_URL")
val configuredSupabaseAnonKey = clientConfig("SUPABASE_ANON_KEY")
val configuredFirebaseProjectId = clientConfig("FIREBASE_PROJECT_ID")
val configuredFirebaseApplicationId = clientConfig("FIREBASE_APPLICATION_ID")
val configuredFirebaseApiKey = clientConfig("FIREBASE_API_KEY")
val configuredFirebaseSenderId = clientConfig("FIREBASE_SENDER_ID")

fun String.asBuildConfigString(): String = "\"${replace("\\", "\\\\").replace("\"", "\\\"")}\""

android {
    namespace = "com.geotrack.mobile"
    compileSdk = 36

    signingConfigs {
        val keystorePropertiesFile = rootProject.file("keystore.properties")
        if (keystorePropertiesFile.exists()) {
            val keystoreProperties = Properties()
            keystoreProperties.load(keystorePropertiesFile.inputStream())
            create("release") {
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["keyPassword"] as String
                storeFile = file(keystoreProperties["storeFile"] as String)
                storePassword = keystoreProperties["storePassword"] as String
            }
        }
    }

    defaultConfig {
        applicationId = "com.geotrack.mobile"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables {
            useSupportLibrary = true
        }

        buildConfigField("String", "SUPABASE_URL", configuredSupabaseUrl.get().asBuildConfigString())
        buildConfigField("String", "SUPABASE_ANON_KEY", configuredSupabaseAnonKey.get().asBuildConfigString())
        buildConfigField("String", "FIREBASE_PROJECT_ID", configuredFirebaseProjectId.get().asBuildConfigString())
        buildConfigField("String", "FIREBASE_APPLICATION_ID", configuredFirebaseApplicationId.get().asBuildConfigString())
        buildConfigField("String", "FIREBASE_API_KEY", configuredFirebaseApiKey.get().asBuildConfigString())
        buildConfigField("String", "FIREBASE_SENDER_ID", configuredFirebaseSenderId.get().asBuildConfigString())
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.findByName("release")
            // Obfuscate and shrink the production build. Keep rules live in
            // proguard-rules.pro; validate a signed release on a device after
            // dependency changes (serialization/reflection are R8-sensitive).
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlin {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.2")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.2")
    implementation("androidx.navigation:navigation-compose:2.9.3")

    implementation(platform("androidx.compose:compose-bom:2025.08.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.10.2")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")

    implementation("com.google.dagger:hilt-android:2.52")
    implementation("androidx.hilt:hilt-navigation-compose:1.2.0")
    kapt("com.google.dagger:hilt-compiler:2.52")

    implementation(platform("io.github.jan-tennert.supabase:bom:3.1.4"))
    implementation("io.github.jan-tennert.supabase:auth-kt")
    implementation("io.github.jan-tennert.supabase:postgrest-kt")
    implementation("io.ktor:ktor-client-okhttp:3.1.3")

    implementation("androidx.room:room-runtime:2.7.2")
    implementation("androidx.room:room-ktx:2.7.2")
    kapt("androidx.room:room-compiler:2.7.2")

    // Location services (GPS + geofencing)
    implementation("com.google.android.gms:play-services-location:21.3.0")

    implementation("androidx.work:work-runtime-ktx:2.11.2")
    implementation("androidx.hilt:hilt-work:1.2.0")
    kapt("androidx.hilt:hilt-compiler:1.2.0")
    implementation(platform("com.google.firebase:firebase-bom:34.19.0"))
    implementation("com.google.firebase:firebase-messaging")
}

kapt {
    correctErrorTypes = true
}
