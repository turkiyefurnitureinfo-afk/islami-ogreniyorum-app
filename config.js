// Central configuration for the app.
// ============================================================
// PRODUCTION CONFIGURATION
// ---------- IMPORTANT ----------
// Deploy the backend server first, then point these URLs at your
// live deployment. For the default domain learningislamapp.com:
//   - API backend  -> https://api.learningislamapp.com
//   - Privacy page -> https://learningislamapp.com/privacy
//   - Support email-> info@learningislamapp.com
// ============================================================

// The main backend API (push notifications, AI answers, events).
// Live on Render (free tier) at islami-ogreniyorum-server.onrender.com
export const API_URL = 'https://islami-ogreniyorum-server.onrender.com';

// Privacy policy URL - required by Apple App Store & Google Play.
// Served live by the backend itself (see server/index.js -> GET /privacy),
// so this always works even though learningislamapp.com has no DNS yet.
// If you later point that domain at a real host, switch back to
// https://learningislamapp.com/privacy and rebuild the app.
export const PRIVACY_POLICY_URL = 'https://islami-ogreniyorum-server.onrender.com/privacy';

// Support / contact email shown in Settings.
export const SUPPORT_EMAIL = 'info@learningislamapp.com';

// ---------------------------------------------------------------------------
// Firebase Authentication (email + password)
// ---------------------------------------------------------------------------
// Sign-up / login is handled by the NATIVE Firebase module
// (@react-native-firebase/auth). It reads its configuration at BUILD TIME from
// the native config file — NOT from these constants:
//   Android: google-services.json at the repo root
//            (Firebase console → Project Settings → Your apps → Android app,
//             package name com.joshua.islamiogreniyorum → download
//             google-services.json → place it at the repo root, next to
//             app.json, then rebuild with EAS)
//   iOS:     GoogleService-Info.plist (needed only for iOS builds)
// The constants below are legacy JS-SDK placeholders and are intentionally
// left empty. Email/password auth works without them as long as the native
// config file is present. They are kept only so any external tooling that
// imports them does not break.
export const FIREBASE_API_KEY = '';
export const FIREBASE_AUTH_DOMAIN = '';
export const FIREBASE_PROJECT_ID = '';
export const FIREBASE_STORAGE_BUCKET = '';
export const FIREBASE_MESSAGING_SENDER_ID = '';
export const FIREBASE_APP_ID = '';

// ---------------------------------------------------------------------------
// Google OAuth Configuration
// ---------------------------------------------------------------------------
// OAuth client IDs MUST come from the SAME Google/Firebase project as
// google-services.json — project "islami-ogreniyorum" (number 817195380589).
// The previous IDs (984514648281-…) belonged to a DIFFERENT project, so Google
// rejected every sign-in from the installed APK with "Error 400: invalid_request".
//
// Values below mirror the "oauth_client" entries in google-services.json:
//   - GOOGLE_ANDROID_CLIENT_ID      : Android client registered for the
//                                     default debug keystore
//                                     (SHA-1 5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25).
//   - GOOGLE_ANDROID_CLIENT_ID_EAS  : Android client from an earlier EAS
//                                     build keystore
//                                     (SHA-1 8D:FC:3D:55:BE:27:5D:81:A1:77:06:4C:93:21:F9:1D:04:B4:49:21).
//   - GOOGLE_ANDROID_CLIENT_ID_RELEASE : Android client for the local release
//                                     keystore android/app/my-upload-key.keystore
//                                     (SHA-1 6E:8E:23:CA:DF:BD:11:4F:93:65:ED:ED:52:89:FC:74:5A:FB:CE:17,
//                                      SHA-256 06:48:32:89:81:78:DC:3D:53:AE:7B:0D:D7:AD:B6:4B:F2:BE:74:8C:5C:A1:91:32:F9:FC:3E:93:C8:46:A5:0E).
//                                     Created 2026-08-28 when the fingerprint was
//                                     registered in Firebase (SHA-1 + SHA-256 added
//                                     under Project Settings → Your apps).
//   - GOOGLE_WEB_CLIENT_ID          : Web-application client (client_type 3),
//                                     used only for web builds / backend.
// googleAuth.js tries RELEASE → debug → EAS in order; the client whose SHA-1
// matches the keystore that signed the installed APK is the one Google accepts.
export const GOOGLE_ANDROID_CLIENT_ID = '817195380589-3i1aml4qbto4cve3tmi8kjnmrqm0bro3.apps.googleusercontent.com';
export const GOOGLE_ANDROID_CLIENT_ID_EAS = '817195380589-posfh2h08650q1pmripm3h6g8js7mug2.apps.googleusercontent.com';
export const GOOGLE_ANDROID_CLIENT_ID_RELEASE = '817195380589-2a0fo0smv7ssunhp82a3dopprdgvpobv.apps.googleusercontent.com'; // Android client for my-upload-key.keystore (SHA-1 6E:8E:23:CA:…) — created when the fingerprint was registered
export const GOOGLE_WEB_CLIENT_ID = '817195380589-3d5uioh20iaiehr20b7dj9ch76t3jk8r.apps.googleusercontent.com';