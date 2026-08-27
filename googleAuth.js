import * as AuthSession from 'expo-auth-session';
import { Platform } from 'react-native';

// Google OAuth configuration
// ============================================================
// HOW TO CREATE THE CORRECT OAUTH CLIENT (Google Cloud Console)
// https://console.cloud.google.com/apis/credentials
//
// IMPORTANT: An installed APK must use an **Android** OAuth client,
// NOT the "Web application" client. Google rejects custom app
// schemes like com.joshua.islamiogreniyorum://... on Web clients
// with "Error 400: invalid_request". An Android client is instead
// validated by package name + SHA-1 certificate fingerprint.
//
// STEP-BY-STEP:
// 1. APIs & Services -> OAuth consent screen:
//       - User type: External
//       - Under "Test users", ADD YOUR OWN GMAIL ADDRESS
//         (required while the app status is "Testing").
// 2. Credentials -> Create Credentials -> OAuth client ID
//       - Application type: **Android**
//       - Package name:  com.joshua.islamiogreniyorum
//         (must EXACTLY match "android.package" in app.json)
//       - SHA-1 certificate fingerprint: the SHA-1 of the key
//         that signed the APK you installed. Get it with either:
//           npx eas credentials -p android
//             (choose profile -> "view keystore" -> copy SHA-1)
//           or, directly from the downloaded APK file:
//             keytool -printcert -jarfile your-app.apk
//         If you ever build locally with gradlew (debug keystore),
//         ALSO add its SHA-1:
//           keytool -list -v -keystore android\app\debug.keystore ^
//                   -alias androiddebugkey -storepass android
//         (You can add more fingerprints later by editing the client.)
// 3. Copy the client ID from the row whose type badge says "Android"
//    -- NOT your original Web client! Both IDs start with the same
//    project number (984514648281-) but have DIFFERENT suffixes.
// 4. REBUILD the APK -- the client ID is compiled into the JS bundle:
//       npm run build:preview   (or npm run build:android)
// 5. Keep the existing Web client for the backend / website.
// ============================================================
// Your OAuth client -- VERIFIED as type "Android" in Google Cloud Console:
//   Application type : Android
//   Package name     : com.joshua.islamiogreniyorum  (must match app.json)
//   SHA-1            : 8D:FC:3D:55:BE:27:5D:81:A1:77:06:4C:93:21:F9:1D:04:B4:49:21
// Reusing the same ID as the Web constant below is FINE for the APK:
// Android-type clients are validated by package name + SHA-1, not URLs.
const GOOGLE_ANDROID_CLIENT_ID = '984514648281-8buojdur5e8ne7jl0f16d6nntj67e2i7.apps.googleusercontent.com';
// Optional: create an iOS client the same way (bundle id
// com.joshua.islamiogreniyorum) and paste it here before an iOS build.
const GOOGLE_IOS_CLIENT_ID = '';
// Web-application client (used for web / backend flows only).
const GOOGLE_WEB_CLIENT_ID = '984514648281-8buojdur5e8ne7jl0f16d6nntj67e2i7.apps.googleusercontent.com';

// Google OAuth endpoints
const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';

// Discovery document describing Google's OAuth endpoints
const GOOGLE_DISCOVERY = {
  authorizationEndpoint: GOOGLE_AUTH_ENDPOINT,
  tokenEndpoint: GOOGLE_TOKEN_ENDPOINT,
};

// Scopes: get user's profile info including email, name, and profile picture
const SCOPES = [
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
];

// True once a real client ID is in GOOGLE_ANDROID_CLIENT_ID (placeholder
// removed). The Android ID may legitimately equal the Web ID -- an
// "Android"-type client is validated by package name + SHA-1, not URLs.
function isAndroidClientConfigured() {
  return Boolean(
    GOOGLE_ANDROID_CLIENT_ID &&
      !GOOGLE_ANDROID_CLIENT_ID.startsWith('PASTE-')
  );
}

// Select the right OAuth client ID for the platform.
// - Android APKs use the Android-type client (validated by
//   package name + SHA-1 in Google Cloud Console).
// - iOS uses the iOS client ID when available.
// - Web keeps the Web-application client ID.
function getClientId() {
  if (Platform.OS === 'android' && isAndroidClientConfigured()) {
    return GOOGLE_ANDROID_CLIENT_ID;
  }
  if (Platform.OS === 'ios' && GOOGLE_IOS_CLIENT_ID) {
    return GOOGLE_IOS_CLIENT_ID;
  }
  return GOOGLE_WEB_CLIENT_ID;
}

// Native custom-scheme redirect URI.
// For Android-type OAuth clients Google does NOT require you to
// register this URI anywhere -- it is validated automatically via the
// package name + SHA-1 fingerprint of the Android OAuth client.
// NOTE the DOUBLE slash after the scheme ("scheme://path"); a single
// slash breaks the deep link back into the app and causes Error 400.
function getRedirectUri() {
  return AuthSession.makeRedirectUri({
    native: 'com.joshua.islamiogreniyorum://oauth2redirect',
  });
}

/**
 * Sign in with Google using OAuth 2.0.
 * Returns the user's profile information including profile picture.
 *
 * @returns {Promise<{success: boolean, user?: {name: string, email: string, picture: string}, error?: string}>}
 */
export async function signInWithGoogle() {
  try {
    const clientId = getClientId();

    // Fail fast with a clear message if the Android client ID was never
    // configured (otherwise Google answers with "Error 400: invalid_request").
    if (Platform.OS === 'android' && !isAndroidClientConfigured()) {
      return {
        success: false,
        error:
          'Google sign-in is not configured for this build. In Google Cloud Console, open the OAuth client whose type is "Android" (NOT "Web"), copy its Client ID, paste it into GOOGLE_ANDROID_CLIENT_ID in googleAuth.js, and rebuild.',
      };
    }

    // Build the auth request
    const authRequest = new AuthSession.AuthRequest({
      clientId,
      scopes: SCOPES,
      redirectUri: getRedirectUri(),
      responseType: AuthSession.ResponseType.Code,
      usePKCE: true,
      extraParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    });

    // Start the OAuth flow
    const result = await authRequest.promptAsync(GOOGLE_DISCOVERY);

    if (result.type !== 'success') {
      // Surface Google's REAL reason (redirect_uri_mismatch, invalid_client,
      // access_denied...) instead of just "cancelled".
      console.log('Google sign-in did not succeed:', JSON.stringify(result));
      // Non-success results carry OAuth error details on params/error; the
      // union type doesn't expose them, so widen locally (no runtime effect).
      const failedResult = /** @type {any} */ (result);
      const googleError =
        (failedResult.params && (failedResult.params.error || failedResult.params.error_description)) ||
        (failedResult.error && failedResult.error.message) ||
        '';
      if (typeof googleError === 'string' && googleError.includes('access_denied')) {
        return {
          success: false,
          error:
            'Google blocked this account. Add your Gmail under "Test users" on the OAuth consent screen in Google Cloud Console.',
        };
      }
      return { success: false, error: 'Google sign-in was cancelled' };
    }

    // Exchange the authorization code for tokens.
    // NOTE: the body is built manually -- Hermes (React Native's JS engine)
    // does NOT provide URLSearchParams, so using it would throw here.
    const formBody = [
      ['code', result.params.code],
      ['client_id', clientId],
      ['redirect_uri', getRedirectUri()],
      ['grant_type', 'authorization_code'],
      ['code_verifier', authRequest.codeVerifier],
    ]
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join('&');

    const tokenResponse = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody,
    });

    const tokens = await tokenResponse.json();

    // Fetch the user's profile info
    const userInfoResponse = await fetch(GOOGLE_USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    const userInfo = await userInfoResponse.json();

    return {
      success: true,
      user: {
        name: userInfo.name || '',
        email: userInfo.email || '',
        picture: userInfo.picture || '',
      },
    };
  } catch (error) {
    console.error('Google sign-in error:', error);
    return { success: false, error: error.message || 'Google sign-in failed' };
  }
}