import * as AuthSession from 'expo-auth-session';
import { Platform } from 'react-native';
import {
  GOOGLE_ANDROID_CLIENT_ID,
  GOOGLE_ANDROID_CLIENT_ID_EAS,
  GOOGLE_ANDROID_CLIENT_ID_RELEASE,
  GOOGLE_WEB_CLIENT_ID,
} from './config.js';

// Google OAuth configuration
// ============================================================
// HOW THE CLIENT IDs WORK (Google Cloud Console -> APIs & Services ->
// Credentials, project "islami-ogreniyorum" 817195380589):
//
// An installed APK must use an **Android**-type OAuth client, NOT a
// "Web application" client. Android clients are validated by
// package name + SHA-1 certificate fingerprint -- not by redirect URLs.
//
// KEYSTORES ON THIS MACHINE (verify with:
//   "C:\ASDK\jdk-17.0.20.1+1\bin\keytool.exe" -list -v
//     -keystore android\app\<file> -alias <alias> -storepass <pass>):
//   1. my-upload-key.keystore (alias my-key-alias) -- signs release/preview
//      APKs built with gradlew.
//      SHA-1   6E:8E:23:CA:DF:BD:11:4F:93:65:ED:ED:52:89:FC:74:5A:FB:CE:17
//      SHA-256 06:48:32:89:81:78:DC:3D:53:AE:7B:0D:D7:AD:B6:4B:F2:BE:74:8C:
//              5C:A1:91:32:F9:FC:3E:93:C8:46:A5:0E
//   2. debug.keystore (alias androiddebugkey) -- debug builds.
//      SHA-1   5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25
//
// REGISTERING THEM: Firebase Console -> Project Settings -> Your apps ->
// Android app -> "Add fingerprint" (SHA-1 + SHA-256), for EACH keystore.
// Firebase then auto-creates an Android OAuth client for it and offers a NEW
// google-services.json whose "oauth_client" list contains that client's ID.
// Download it, replace the repo-root google-services.json, and add any NEW
// client_id to GOOGLE_ANDROID_CLIENT_ID_* in config.js so the chain below
// picks it up. (The EAS/fallback client below covers the debug keystore.)
//
// TROUBLESHOOTING "Error 400: invalid_request":
//   - The client ID must come from the SAME project as google-services.json.
//   - The Android client's package name + SHA-1 must match the signing key of
//     the installed build:
//       keytool -printcert -jarfile your-app.apk
//   - If the consent screen shows "access blocked": the app is still in
//     "Testing" status -- add the Gmail address under "Test users".
// ============================================================

const GOOGLE_IOS_CLIENT_ID = '';

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

// True once a real (project-matching) Android client ID is configured.
function isAndroidClientConfigured() {
  return Boolean(
    GOOGLE_ANDROID_CLIENT_ID &&
      !GOOGLE_ANDROID_CLIENT_ID.startsWith('PASTE-')
  );
}

// Ordered list of Android OAuth clients to try. The release-keystore client
// (filled in config.js after registering fingerprints in Firebase) comes
// first, then the debug-keystore client, then the earlier EAS keystore.
// Trying every registered client makes sign-in work no matter which keystore
// signed the installed APK — the first one whose SHA-1 matches succeeds.
function getAndroidClientIds() {
  return [
    GOOGLE_ANDROID_CLIENT_ID_RELEASE,
    GOOGLE_ANDROID_CLIENT_ID,
    GOOGLE_ANDROID_CLIENT_ID_EAS,
  ].filter((id) => id && id.length > 20 && !id.startsWith('PASTE-'));
}

// Select the right OAuth client ID for the platform.
// - Android APKs use the Android-type clients (validated by
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
 * Convert a failed/cancelled promptAsync result into a helpful message.
 * Surfaces Google's REAL reason (invalid_request, access_denied,
 * redirect_uri_mismatch...) instead of just "cancelled".
 */
function describeGoogleFailure(result, language = 'tr') {
  const failed = /** @type {any} */ (result);
  const googleError =
    (failed?.params && (failed.params.error || failed.params.error_description)) ||
    (failed?.error && failed.error.message) ||
    failed?.errorCode ||
    '';
  const text = String(googleError);
  if (language === 'tr') {
    if (text.includes('access_denied') || text.includes('blocked')) {
      return (
        'Google bu hesabı engelledi. OAuth onay ekranı "Testing" durumundayken, ' +
        'Gmail adresinizin Google Cloud Console (APIs & Services → OAuth consent ' +
        'screen) içinde "Test users" (Test kullanıcıları) listesine eklenmiş ' +
        'olması gerekir.'
      );
    }
    if (text.includes('invalid_request') || text.includes('invalid_client')) {
      return (
        'Hata 400: invalid_request. Bu derlemeye gömülü OAuth istemci kimliği, ' +
        'kurulu APK ile eşleşmiyor. Google Cloud Console\'daki Android OAuth ' +
        'istemcisinin paket adı olarak com.joshua.islamiogreniyorum ve bu derlemeyi ' +
        'imzalayan keystore\'un SHA-1 imzasını kullandığından emin olun, sonra yeniden ' +
        `derleyin. (Ham hatanız: ${text})`
      );
    }
    if (text) return `Google girişi başarısız: ${text}`;
    return 'Google girişi iptal edildi';
  }
  if (text.includes('access_denied') || text.includes('blocked')) {
    return (
      'Google blocked this account. While the OAuth consent screen is in ' +
      '"Testing" status, your Gmail address must be listed under "Test users" ' +
      'in Google Cloud Console (APIs & Services -> OAuth consent screen).'
    );
  }
  if (text.includes('invalid_request') || text.includes('invalid_client')) {
    return (
      'Error 400: invalid_request. The OAuth client ID baked into this build ' +
      'does not match the installed APK. Make sure the Android OAuth client in ' +
      'Google Cloud Console uses package name com.joshua.islamiogreniyorum and ' +
      "the SHA-1 of the keystore that signed this build, then rebuild. (Raw " +
      `error: ${text})`
    );
  }
  if (text) {
    return `Google sign-in failed: ${text}`;
  }
  return 'Google sign-in was cancelled';
}

/** Run one OAuth attempt against a single Android client ID. */
async function promptGoogleWithClient(clientId, language = 'tr') {
  const authRequest = new AuthSession.AuthRequest({
    clientId,
    scopes: SCOPES,
    redirectUri: getRedirectUri(),
    // Implicit-style code flow WITHOUT PKCE. Google's Android OAuth clients
    // do not accept PKCE parameters on the custom-scheme redirect flow and
    // answering with "Error 400: invalid_request" -- omitting usePKCE (and the
    // offline/consent extras) keeps the request exactly what the native
    // flow expects. The code is still exchanged server-to-server below.
    responseType: AuthSession.ResponseType.Code,
    usePKCE: false,
  });

  const result = await authRequest.promptAsync(GOOGLE_DISCOVERY);
  if (result.type !== 'success') {
    throw new Error(describeGoogleFailure(result, language));
  }

  // Exchange the authorization code for tokens.
  // NOTE: the body is built manually -- Hermes (React Native's JS engine)
  // does NOT provide URLSearchParams, so using it would throw here.
  const formBody = [
    ['code', result.params.code],
    ['client_id', clientId],
    ['redirect_uri', getRedirectUri()],
    ['grant_type', 'authorization_code'],
  ]
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');

  const tokenResponse = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody,
  });
  const tokens = await tokenResponse.json();
  if (!tokens || !tokens.access_token) {
    const reason = tokens?.error_description || tokens?.error || 'token exchange failed';
    throw new Error(`Google sign-in failed: ${reason}`);
  }

  // Fetch the user's profile info
  const userInfoResponse = await fetch(GOOGLE_USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const userInfo = await userInfoResponse.json();
  if (!userInfo || (!userInfo.email && !userInfo.sub)) {
    throw new Error('Google sign-in failed: could not read the Google profile');
  }

  return {
    name: userInfo.name || '',
    email: userInfo.email || '',
    picture: userInfo.picture || '',
  };
}

/**
 * Sign in with Google using OAuth 2.0.
 * Returns the user's profile information including profile picture.
 *
 * On Android every registered Android-type client ID is tried in turn, so the
 * flow works regardless of which keystore signed the installed APK.
 *
 * @returns {Promise<{success: boolean, user?: {name: string, email: string, picture: string}, error?: string}>}
 */
export async function signInWithGoogle(language = 'tr') {
  // Fail fast with a clear message if no Android client ID was ever
  // configured (otherwise Google answers with "Error 400: invalid_request").
  if (Platform.OS === 'android' && !isAndroidClientConfigured()) {
    return {
      success: false,
      error:
        language === 'tr'
          ? 'Google girişi bu derleme için yapılandırılmamış. Google Cloud Console\'da türü "Android" (WEB değil) olan OAuth istemcisini açın, İstemci Kimliğini kopyalayıp config.js içindeki GOOGLE_ANDROID_CLIENT_ID alanına yapıştırın ve yeniden derleyin.'
          : 'Google sign-in is not configured for this build. In Google Cloud Console, open the OAuth client whose type is "Android" (NOT "Web"), copy its Client ID, paste it into GOOGLE_ANDROID_CLIENT_ID in config.js, and rebuild.',
    };
  }

  // Web/iOS: single known client.
  if (Platform.OS !== 'android') {
    try {
      return { success: true, user: await promptGoogleWithClient(getClientId(), language) };
    } catch (error) {
      console.error('Google sign-in error:', error);
      return { success: false, error: error.message || 'Google sign-in failed' };
    }
  }

  // Android: try each registered Android client until one matches the
  // fingerprint of the installed APK. All failures are captured so the user
  // gets the most specific reason Google reported.
  const clientIds = getAndroidClientIds();
  let lastError = null;
  for (const clientId of clientIds) {
    try {
      const user = await promptGoogleWithClient(clientId, language);
      return { success: true, user };
    } catch (error) {
      lastError = error;
      console.warn(
        `Google sign-in: client ${clientId.slice(0, 18)}… failed:`,
        error?.message
      );
    }
  }

  console.error('Google sign-in error:', lastError);
  return {
    success: false,
    error: (lastError && lastError.message) || 'Google sign-in failed',
  };
}