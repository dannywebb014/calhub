plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "io.github.dannywebb014.calhub.widget"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.github.dannywebb014.calhub.widget"
        minSdk = 26
        targetSdk = 35
        // Each CI build is newer than the last, so it installs over the top.
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "1.0.${System.getenv("GITHUB_RUN_NUMBER") ?: "0"}"
    }

    // The app is installed by hand rather than from the Play Store, and every
    // update must be signed with the same key, so the key lives in the repo.
    // It only proves an update came from this build; it guards nothing else.
    signingConfigs {
        create("sideload") {
            storeFile = file("sideload.keystore")
            storePassword = "calhub-widget"
            keyAlias = "calhub"
            keyPassword = "calhub-widget"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("sideload")
        }
        debug {
            signingConfig = signingConfigs.getByName("sideload")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
    }
}

dependencies {
    implementation("androidx.glance:glance-appwidget:1.1.1")
    implementation("androidx.work:work-runtime-ktx:2.10.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
