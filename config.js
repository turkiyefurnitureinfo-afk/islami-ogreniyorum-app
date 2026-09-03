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
// the native config file:
//   Android: google-services.json at the repo root
//            (Firebase console → Project Settings → Your apps → Android app,
//             package name com.joshua.islamiogreniyorum → download
//             google-services.json → place it at the repo root, next to
//             app.json, then rebuild with EAS)
//   iOS:     GoogleService-Info.plist (needed only for iOS builds)
// No JS-SDK constants needed — native auth works without them.

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
// ---------------------------------------------------------------------------
// GOOGLE ANDROID CLIENT ID FOR THE GOOGLE-PLAY-INSTALLED BUILD
// ---------------------------------------------------------------------------
// The build you install from Google Play is signed with GOOGLE PLAY APP SIGNING,
// NOT the upload key listed above. Google rejects every Google Sign-In attempt
// with "Error 400: invalid_request" unless your Firebase project has an android
// OAuth client whose SHA-1 matches THAT Play app-signing certificate.
//
// To wire it up (one-time, in your accounts — no code change here beyond the ID):
//   1) Play Console → your app → Setup → App integrity → "App signing" →
//      copy the two "Certificate fingerprints" (SHA-1 AND SHA-256) of the
//      "App signing key certificate"  (NOT the "Upload key certificate").
//   2) Firebase Console → Project settings → Your apps →
//      select the com.joshua.islamiogreniyorum Android app → Add fingerprint →
//      paste BOTH SHA-1 and SHA-256 from step 1 → Save.
//   3) Firebase then auto-generates a NEW android OAuth client(
//      "client_type": 1) under Project settings → Your apps → the android app;
//      copy its "Android client ID" → paste it into GOOGLE_ANDROID_CLIENT_ID_PLAY
//      below.
//   4) ALSO download the updated google-services.json from Firebase and replace BOTH
//      copies (repo root AND android/app/) — they re-stamp the app and re-build(EAS.
//
// 📎 PLAY APP-SIGNING CERT FINGERPRINT FOR com.joshua.islamiogreniyorum
//   (recorded 2026-09-03 from Play Console → App signing → "App signing key certificate"):
//     SHA-1   : 84:1A:BB:8F:3F:94:F8:14:E9:01:D9:15:F9:77:11:B9:63:19:D6:6D
//     SHA-256 : 6F:84:EF:C2:28:14:FB:B7:E7:00:47:56:5D:5E:62:07:66:AF:FD:CB:02:0D:F0:93:6D:C6:8D:BB:60:89:D6:C4
//   The 40-hex certificate_hash form of the SHA-1 (what Firebase writes into
//   google-services.json) is: 841abb8f3f94f814e901d915f97711b96319d66d
//
//   ⚠️ DONE (value set below): the Play App-Signing android OAuth client id below is
//   the one Firebase issued for the fingerprint above (from your updated google-services.json).
//   Keep GOOGLE_ANDROID_CLIENT_ID_PLAY in sync with the "oauth_client"/"certificate_hash" in
//   BOTH google-services.json copies (repo root AND android/app/) if you ever re-download them.
export const GOOGLE_ANDROID_CLIENT_ID_PLAY = '817195380589-m6ar0h19remec01niapgm4i08r17pvm8.apps.googleusercontent.com'; // Android OAuth client for Google Play App Signing key (Firebase-issued; matches android/app/google-services.json)
export const GOOGLE_WEB_CLIENT_ID = '817195380589-3d5uioh20iaiehr20b7dj9ch76t3jk8r.apps.googleusercontent.com';

// ---------------------------------------------------------------------------
// Security Hardening Configuration
// ---------------------------------------------------------------------------

// Certificate pinning: SHA-256 hashes of your server's SSL certificate public keys.
// Replace with your actual certificate hashes. To get them:
//   openssl s_client -connect islami-ogreniyorum-server.onrender.com:443 | openssl x590 -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64
// Pinning prevents man-in-the-middle attacks even if the device trusts a rogue CA.
export const PINNED_CERTIFICATE_HASHES = [
  // 'sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', // Replace with actual hash
  // 'sha256/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=', // Backup pin
];

// Request signing: adds HMAC-SHA256 signature to API requests for tamper detection.
// The server should validate this signature. This is a shared secret between app and server.
// IMPORTANT: In production, retrieve this from a secure key exchange, never hardcode.
export const REQUEST_SIGNING_KEY = 'islami-ogreniyorum-secure-signing-key-2024';

// Rate limiting: client-side throttle to prevent accidental API flooding.
// Limits are per-endpoint within the specified window.
export const RATE_LIMITS = {
  // Default rate limit for most endpoints
  default: {
    maxRequests: 30,    // Maximum requests
    windowMs: 60000,    // Per 60 seconds
  },
  // Stricter limits for write operations
  write: {
    maxRequests: 10,    // Maximum write requests
    windowMs: 60000,    // Per 60 seconds
  },
  // AI endpoints (expensive operations)
  ai: {
    maxRequests: 5,     // Maximum AI requests
    windowMs: 60000,    // Per 60 seconds
  },
  // Authentication endpoints (brute-force protection)
  auth: {
    maxRequests: 5,     // Maximum auth attempts
    windowMs: 300000,   // Per 5 minutes
  },
};

// Enable/disable security features (useful for development)
export const SECURITY_CONFIG = {
  enableCertificatePinning: false,  // Set to true after configuring PINNED_CERTIFICATE_HASHES
  enableRequestSigning: true,       // Adds X-Request-Signature header to API calls
  enableRateLimit: true,            // Client-side rate limiting
};