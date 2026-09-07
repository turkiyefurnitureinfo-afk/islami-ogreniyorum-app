# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# ---------------------------------------------------------------------------
# Firebase Auth (@react-native-firebase/auth)
# Email/password sign-up & sign-in crash or silently fail when R8 strips the
# credential / re-auth classes. Kept per official Firebase RN docs.
# ---------------------------------------------------------------------------
-keep class com.google.firebase.auth.** { *; }
-keep class io.invertase.firebase.auth.** { *; }
-keep class com.google.android.gms.auth.** { *; }
-dontwarn com.google.firebase.auth.**
-dontwarn io.invertase.firebase.auth.**

# ---------------------------------------------------------------------------
# Google Sign-In (@react-native-google-signin/google-signin)
# DEVELOPER_ERROR / silent failures happen when the module's internal
# CredentialApiClient classes are renamed by R8.
# ---------------------------------------------------------------------------
-keep class com.google.android.gms.common.** { *; }
-keep class com.google.android.gms.games.** { *; }
-keep class com.google.android.gms.tasks.** { *; }
-keep class com.reactnativegooglesignin.** { *; }
-keep class com.rngooglesignin.** { *; }
-dontwarn com.google.android.gms.**

# ---------------------------------------------------------------------------
# React Native / Fresco image pipeline
# External https:// profile pictures & community media stop rendering when the
# Fresco networking / decoder classes are obfuscated or stripped.
# ---------------------------------------------------------------------------
-keep class com.facebook.imagepipeline.** { *; }
-keep class com.facebook.fresco.** { *; }
-keep class com.facebook.react.views.image.** { *; }
-dontwarn com.facebook.imagepipeline.**
-dontwarn com.facebook.fresco.**
-dontwarn com.facebook.react.views.image.**

# ---------------------------------------------------------------------------
# HTTP networking layer (fetch, OkHttp transport used by RN + Firebase)
# Prevents "cleartext not permitted" style runtime surprises caused by
# stripped transport classes in release builds.
# ---------------------------------------------------------------------------
-keep class okhttp3.** { *; }
-keep class okio.** { *; }
-dontwarn okhttp3.**
-dontwarn okio.**

# ---------------------------------------------------------------------------
# Firebase Messaging / Notifications (expo-notifications uses FCM underneath)
# ---------------------------------------------------------------------------
-keep class com.google.firebase.messaging.** { *; }
-keep class com.google.firebase.iid.** { *; }
-dontwarn com.google.firebase.messaging.**

# Add any project specific keep options here:
