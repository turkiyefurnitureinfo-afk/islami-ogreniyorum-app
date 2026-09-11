import Constants from 'expo-constants';

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

const extra = Constants?.expoConfig?.extra || {};

// The main backend API (push notifications, AI answers, events).
// Live on Render (free tier) at islami-ogreniyorum-server.onrender.com
// Can be overridden via app.json -> expo.extra.apiUrl
export const API_URL = extra.apiUrl || 'https://islami-ogreniyorum-server.onrender.com';

// Privacy policy URL - required by Apple App Store & Google Play.
// Served live by the backend itself (see server/index.js -> GET /privacy),
// so this always works even though learningislamapp.com has no DNS yet.
// If you later point that domain at a real host, switch back to
// https://www.learningislamapp.com/privacy-policy.html and rebuild the app.
export const PRIVACY_POLICY_URL = extra.privacyPolicyUrl || 'https://www.learningislamapp.com/privacy-policy.html';

// Support / contact email shown in Settings.
export const SUPPORT_EMAIL = extra.supportEmail || 'info@learningislamapp.com';

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
// Values below mirror the "oauth_client" entries in google-services.json
// (client_type 1 = Android). NOTE: GOOGLE_ANDROID_CLIENT_ID is the SAME client
// ID as GOOGLE_ANDROID_CLIENT_ID_EAS (…8e8k9uu…) — Firebase registered it for
// the eas-keystore.jks fingerprint
// (SHA-1 8D:FC:3D:55:BE:27:5D:81:A1:77:06:4C:93:21:F9:1D:04:B4:49:21), which is
// the key that signs our production release bundle (gradle.properties ->
// MYAPP_UPLOAD_STORE_FILE=eas-keystore.jks).
//   - GOOGLE_ANDROID_CLIENT_ID      : (= GOOGLE_ANDROID_CLIENT_ID_EAS).
//   - GOOGLE_ANDROID_CLIENT_ID_EAS  : Android client for eas-keystore.jks
//                                     (SHA-1 8D:FC:3D:55:BE:27:5D:81:A1:77:06:4C:93:21:F9:1D:04:B4:49:21).
//   - GOOGLE_ANDROID_CLIENT_ID_RELEASE : Android client for the local release
//                                     keystore android/app/my-upload-key.keystore
//                                     (SHA-1 6E:8E:23:CA:DF:BD:11:4F:93:65:ED:ED:52:89:FC:74:5A:FB:CE:17,
//                                      SHA-256 06:48:32:89:81:78:DC:3D:53:AE:7B:0D:D7:AD:B6:4B:F2:BE:74:8C:5C:A1:91:32:F9:FC:3E:93:C8:46:A5:0E).
//                                     Created 2026-08-28 when the fingerprint was
//                                     registered in Firebase (SHA-1 + SHA-256 added
//                                     under Project Settings → Your apps).
//   - GOOGLE_WEB_CLIENT_ID          : Web-application client (client_type 3),
//                                     REQUIRED for native Google Sign-In on BOTH
//                                     Android and iOS. This is the #1 cause of
//                                     "Google ID specifier cannot be obtained" /
//                                     a missing idToken — without it the native
//                                     flow cannot exchange a Google ID token for
//                                     a Firebase session. In Firebase Console it
//                                     is the "Web client ID" shown under
//                                     Authentication → Sign-in method → Google
//                                     → Web SDK configuration (the auto-created
//                                     client whose ID ends in .apps.googleusercontent.com).
//                                     googleAuth.js passes it as `webClientId`
//                                     to GoogleSignin.configure().
// googleAuth.js -> resolveAndroidClientId() returns the client whose registered
// SHA-1 matches the keystore that signs THIS build: EAS (…8e8k9uu…, 8D:FC) first,
// because gradle.properties MYAPP_UPLOAD_STORE_FILE=eas-keystore.jks signs the
// release bundle. Google only accepts the client whose SHA-1 equals the signing
// certificate of the installed build; any other client yields DEVELOPER_ERROR.
export const GOOGLE_ANDROID_CLIENT_ID = '817195380589-8e8k9uure9f7kdban7ms5i18grp9cg92.apps.googleusercontent.com';
export const GOOGLE_ANDROID_CLIENT_ID_EAS = '817195380589-8e8k9uure9f7kdban7ms5i18grp9cg92.apps.googleusercontent.com'; // EAS build keystore SHA-1 8D:FC:3D:55
export const GOOGLE_ANDROID_CLIENT_ID_EAS_UPLOAD = '817195380589-snv0bkhtf4mmt5f0ks048hu4pi5rdbrv.apps.googleusercontent.com'; // EAS upload keystore cert hash b30e9592
export const GOOGLE_ANDROID_CLIENT_ID_RELEASE = '817195380589-93guvjn4ha7u16cijv6bs77iuvnssg16.apps.googleusercontent.com'; // android/app/release.keystore alias release-key SHA-1 7D:85:B8:95:…
export const GOOGLE_ANDROID_CLIENT_ID_OLDKEY = '817195380589-un8im784hhd3evbvnh8avoejh0pn0ma4.apps.googleusercontent.com'; // old my-upload-key.keystore SHA-1 6E:8E:23:CA:… (kept so old APKs still work)
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
//   ⚠️ NOT REGISTERED IN THE CURRENT google-services.json (verified 2026-09-10):
//   the client id below was set while the Play App-Signing fingerprint
//   (SHA-1 84:1A:BB:8F…) was expected in Firebase, but a fresh
//   google-services.json was downloaded afterwards and it does NOT contain this
//   client id. Before shipping a Play-signed build:
//     1) add the Play App-Signing CERT fingerprint (SHA-1 841abb8f… + SHA-256) in
//        Firebase → Project settings → Your apps,
//     2) RE-DOWNLOAD google-services.json (repo root AND android/app/),
//     3) copy the new "Android client ID" Firebase issues for that fingerprint into
//        GOOGLE_ANDROID_CLIENT_ID_PLAY below, and
//     4) keep resolveAndroidClientId() in googleAuth.js in sync.
//   For LOCAL eas-keystore-signed bundles (the current release path) the correct
//   client is GOOGLE_ANDROID_CLIENT_ID_EAS and PLAY is NOT used.
export const GOOGLE_ANDROID_CLIENT_ID_PLAY = '817195380589-m6ar0h19remec01niapgm4i08r17pvm8.apps.googleusercontent.com'; // PLACEHOLDER — NOT in the current google-services.json (see comment above)
export const GOOGLE_WEB_CLIENT_ID = '817195380589-bofg4l9c97uostv2jt51htcuj97v0mnj.apps.googleusercontent.com'; // Recreated 2026-09-11 — old client (…3d5uioh…) was invalidated by a Google Cloud consent-screen change (GMS rejected it with "Invalid audience value")

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
// Read from expo-constants (app.json) so it can be changed at build time.
// SECURITY: Must be set in app.json -> expo.extra.requestSigningKey for production builds
export const REQUEST_SIGNING_KEY = Constants?.expoConfig?.extra?.requestSigningKey || null;

// Warn if request signing key is not configured
if (!REQUEST_SIGNING_KEY && __DEV__) {
  console.warn('[SECURITY WARNING] REQUEST_SIGNING_KEY is not configured. Set it in app.json -> expo.extra.requestSigningKey');
}

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
// SECURITY: In production, enable certificate pinning with real certificate hashes
export const SECURITY_CONFIG = {
  enableCertificatePinning: PINNED_CERTIFICATE_HASHES.length > 0, // Auto-enable when hashes are configured
  enableRequestSigning: REQUEST_SIGNING_KEY !== null, // Auto-enable when key is configured
  enableRateLimit: true,            // Client-side rate limiting
};