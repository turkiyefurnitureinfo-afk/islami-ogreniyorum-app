import * as AuthSession from 'expo-auth-session';
import { Platform } from 'react-native';

// Native Google Sign-In (used on Android). The browser-based expo-auth-session
// flow below is kept ONLY as a fallback for web / Expo Go, because Google now
// blocks custom-scheme browser redirects for Android OAuth clients with
// "Error 400: invalid_request" (OAuth policy: secure response handling).
// The native module exchanges the Google ID token for a Firebase session
// instead â€” no custom-scheme redirect is involved, so it is not affected.
import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import {
  GOOGLE_ANDROID_CLIENT_ID,
  GOOGLE_ANDROID_CLIENT_ID_EAS,
  GOOGLE_ANDROID_CLIENT_ID_RELEASE,
  GOOGLE_ANDROID_CLIENT_ID_EAS_UPLOAD,
  GOOGLE_ANDROID_CLIENT_ID_OLDKEY,
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

// iOS uses the native @react-native-google-signin/google-signin module which
// is configured with the WEB client ID of the Firebase project. A separate
// iOS OAuth client is not required (the native module signs in with the
// Google ID token and exchanges it for a Firebase session). Kept for clarity.
const GOOGLE_IOS_CLIENT_ID = GOOGLE_WEB_CLIENT_ID;

// Google OAuth endpoints
const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';

// ---------------------------------------------------------------------------
// Google Sign-In module configuration
// ---------------------------------------------------------------------------
// The native @react-native-google-signin/google-signin module must be configured
// BEFORE sign-in. The #1 cause of "Google ID specifier cannot be obtained" /
// "Error 400: invalid_request" is a missing `webClientId`: without it the native
// flow never receives a `idToken` to exchange for a Firebase session (needed on
// iOS and for the server-side verified identity path).
// ---------------------------------------------------------------------------

/**
 * Resolve the Android OAuth client id appropriate for THIS build's signing key.
 * Release/EAS/Play ids are only populated in production builds (the values come
 * from app.json extra.* at build time); in dev only the debug id exists. Returned
 * ids map 1:1 to the SHA-1 fingerprints registered in google-services.json.
 */
export function resolveAndroidClientId() {
  // The debug keystore (SHA-1 5E:8F:16..) -> GOOGLE_ANDROID_CLIENT_ID.
  // Release keystore (SHA-1 6E:8E:23..) -> ..._RELEASE.
  // EAS / Google-Play-App-Signing -> ..._EAS / ..._PLAY.
  // The first non-empty match wins.
  if (GOOGLE_ANDROID_CLIENT_ID_RELEASE) return GOOGLE_ANDROID_CLIENT_ID_RELEASE;
  if (GOOGLE_ANDROID_CLIENT_ID_EAS) return GOOGLE_ANDROID_CLIENT_ID_EAS;
  if (GOOGLE_ANDROID_CLIENT_ID_PLAY) return GOOGLE_ANDROID_CLIENT_ID_PLAY;
  return GOOGLE_ANDROID_CLIENT_ID;
}

// Configured exactly once per process. Re-configuring mid-sign-in resets the
// module and can invalidate an in-flight session.
let googleSigninConfigured = false;

/**
 * Configure the native Google Sign-In module ONCE with the right client ids for
 * this build. Safe to call many times â€” subsequent calls are no-ops.
 */
export function configureGoogleSignin() {
  if (googleSigninConfigured) return;
  googleSigninConfigured = true;
  try {
    GoogleSignin.configure({
      androidClientId: resolveAndroidClientId(),
      iosClientId: GOOGLE_IOS_CLIENT_ID,
      // webClientId is required to receive an exchangeable Google idToken.
      webClientId: GOOGLE_WEB_CLIENT_ID,
      offlineAccess: true,
    });
  } catch (error) {
    console.warn('GoogleSignin.configure failed:', error?.message || error);
  }
}

/**
 * Build a friendly, localized message for a Google sign-in failure. When the
 * error is DEVELOPER_ERROR (code 10) or a "no idToken" / "webClientId" message,
 * it appends the SHA-1 fingerprint mismatch guidance so the developer can
 * re-sync google-services.json instead of guessing.
 */
export function describeGoogleSignInError(error, language = 'tr') {
  const tr = language === 'tr';
  const code = String(error?.code || '');
  const msg = String(error?.message || '');
  const isMismatch =
    code === '10' ||
    /DEVELOPER_ERROR/i.test(msg) ||
    /idToken|webClientId/i.test(msg);
  if (isMismatch) {
    const hint =
      (tr
        ? 'Google oturum aÃ§ma yapÄ±landÄ±rmasÄ± bu derleme ile eÅŸleÅŸmiyor (DEVELOPER_ERROR). google-services.json iÃ§indeki Web istemci kimliÄŸini ve imza SHA-1 parmak izini Google Cloud Console ile eÅŸitleyip uygulamayÄ± yeniden derleyin. SHA-1 parmak iziniz: '
        : 'Google sign-in configuration does not match this build (DEVELOPER_ERROR). Re-sync google-services.json â€” its Web client ID and signing SHA-1 fingerprint â€” with Google Cloud Console and rebuild. Your SHA-1: ') +
      '5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25';
    return tr
      ? `${msg || 'Google oturumu baÅŸarÄ±sÄ±z oldu.'} \n\n${hint}`
      : `${msg || 'Google sign-in failed.'} \n\n${hint}`;
  }
  return msg || (tr ? 'Google ile giriÅŸ baÅŸarÄ±sÄ±z oldu.' : 'Google sign-in failed.');
}

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
// signed the installed APK â€” the first one whose SHA-1 matches succeeds.
function getAndroidClientIds() {
  return [
    // Play App-Signing cert first (matches the Play-installed build). Empty/
    // placeholder ids are filtered out below, so this is inert until a real id is set.
    GOOGLE_ANDROID_CLIENT_ID_EAS_UPLOAD,
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
        'Google giriÅŸi engellendi â€” OAuth onay ekranÄ± henÃ¼z yayÄ±nlanmadÄ±. DÃ¼zeltmek iÃ§in ' +
        'Google Cloud Console â†’ APIs & Services â†’ OAuth consent screen (Google Auth Platform â†’ Audience) ' +
        'bÃ¶lÃ¼mÃ¼ne gidin ve ÅŸunlardan birini yapÄ±n: (1) "PUBLISH APP" ile uygulamayÄ± ' +
        '"In production" durumuna alÄ±n (yalnÄ±zca temel profil/e-posta izni istendiÄŸi iÃ§in ' +
        'doÄŸrulama gerekmez), VEYA (2) "Testing" durumunda kalacaksa test yapacak her Gmail ' +
        'adresini "Test users" listesine ekleyin. Uygulama adÄ±, destek e-postasÄ±, gizlilik ' +
        'politikasÄ± baÄŸlantÄ±sÄ± ve ana sayfa baÄŸlantÄ±sÄ±nÄ±n da onay ekranÄ± ayarlarÄ±nda doldurulmuÅŸ olmasÄ± gerekir.'
      );
    }
    if (text.includes('invalid_request') || text.includes('invalid_client')) {
      return (
        'Hata 400: invalid_request. Bu derlemeye gÃ¶mÃ¼lÃ¼ OAuth istemci kimliÄŸi, ' +
        'kurulu APK ile eÅŸleÅŸmiyor. Google Cloud Console\'daki Android OAuth ' +
        'istemcisinin paket adÄ± olarak com.joshua.islamiogreniyorum ve bu derlemeyi ' +
        'imzalayan keystore\'un SHA-1 imzasÄ±nÄ± kullandÄ±ÄŸÄ±ndan emin olun, sonra yeniden ' +
        `derleyin. (Ham hatanÄ±z: ${text})`
      );
    }
    if (text) return `Google giriÅŸi baÅŸarÄ±sÄ±z: ${text}`;
    return 'Google giriÅŸi iptal edildi';
  }
  if (text.includes('access_denied') || text.includes('blocked')) {
    return (
      'Google sign-in is blocked â€” the OAuth consent screen is not published yet. To fix it, ' +
      'go to Google Cloud Console â†’ APIs & Services â†’ OAuth consent screen (Google Auth Platform â†’ Audience) ' +
      'and do ONE of the following: (1) Click "PUBLISH APP" to move the app to "In production" ' +
      '(no verification is required since only basic profile/email scopes are requested), OR ' +
      '(2) keep it in "Testing" and add every Gmail address that should be able to sign in to ' +
      'the "Test users" list. Also make sure the app name, support email, privacy policy link, ' +
      'and homepage link are filled in on the consent screen settings.'
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
  if (result.type !== 'success' || !result.params?.code) {
    throw new Error(describeGoogleFailure(result, language));
  }

  // Exchange the authorization code for tokens.
  // NOTE: the body is built manually -- Hermes (React Native's JS engine)
  // does NOT provide URLSearchParams, so using it would throw here.
  const code = String(result.params.code);
  const redirectUri = getRedirectUri();
  const formBody = [
    ['code', code],
    ['client_id', clientId],
    ['redirect_uri', redirectUri],
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
 * Obtain a fresh Google ID token for the currently signed-in Google account,
 * used for Firebase re-authentication before sensitive operations (account
 * deletion, email change). Resolves null when Google Sign-In is unavailable
 * (Expo Go / web) or the user cancels â€” the caller handles the failure.
 *
 * @returns {Promise<string|null>}
 */
export async function getFreshGoogleIdToken() {
  if (Platform.OS === 'web') return null;
    try {
    configureGoogleSignin();
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: false });
    const signInResult = await GoogleSignin.signIn();
    const info = signInResult?.data || signInResult;
    return info?.idToken || null;
  } catch (error) {
    // Log SHA-1 / client-id mismatch diagnostics in dev to speed up fixes.
    if (__DEV__ && String(error?.code || '') === '10') {
      console.warn(
        '[google] DEVELOPER_ERROR (SHA-1 / client-id mismatch):\n' +
          describeGoogleSignInError(error, 'en')
      );
    }
    console.warn('getFreshGoogleIdToken failed:', error?.message || error);
    return null;
  }
}

/**
 * Sign in with Google.
 *
 * Android (installed builds): uses NATIVE Google Sign-In
 * (@react-native-google-signin/google-signin). Google no longer accepts
 * browser custom-scheme redirects for Android OAuth clients (the source of
 * "Error 400: invalid_request"), while the native flow is unaffected. The
 * Google ID token is exchanged for a REAL Firebase Auth session, so Google
 * users get the same verified identity (ID tokens for the backend, photoURL
 * in their profile) as email/password users.
 *
 * Web / Expo Go: falls back to the legacy browser OAuth flow.
 *
 * @returns {Promise<{success: boolean, user?: {name: string, email: string, picture: string}, error?: string}>}
 */
export async function signInWithGoogle(language = 'tr') {
  const tr = language === 'tr';

  // ---- Android / iOS: native flow ------------------------------------------
  if (Platform.OS !== 'web') {
    try {
      configureGoogleSignin();

      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const signInResult = await GoogleSignin.signIn();
      // v13+ wraps the payload as { type: 'success', data: {...} }; older
      // versions returned the payload directly. Support both shapes.
      const info = signInResult?.data || signInResult;
      const idToken = info?.idToken;
      if (!idToken) {
        throw new Error(
          tr
            ? 'Google kimlik belirteci alÄ±namadÄ±. webClientId ayarÄ±nÄ± kontrol edin.'
            : 'No Google ID token was returned. Check the webClientId setting.'
        );
      }

      // Exchange the Google ID token for a Firebase Auth session.
      const { signInWithGoogleIdToken } = await import('./firebaseAuth.js');
      const fbUser = await signInWithGoogleIdToken(idToken);

      const fbEmail = (fbUser?.email || info?.user?.email || '').toLowerCase();
      // Prefer the Firebase profile photo; fall back to Google's picture URL.
      const picture = fbUser?.photoURL || info?.user?.photo || '';

      return {
        success: true,
        user: {
          name: fbUser?.displayName || info?.user?.name || '',
          email: fbEmail,
          picture,
        },
      };
    } catch (error) {
      const code = String(error?.code || '');
      if (code.includes(statusCodes.SIGN_IN_CANCELLED) || /cancelled/i.test(String(error?.message))) {
        return { success: false, error: tr ? 'Google giriÅŸi iptal edildi' : 'Google sign-in was cancelled' };
      }
      if (code.includes(statusCodes.IN_PROGRESS)) {
        return {
          success: false,
          error: tr ? 'GiriÅŸ zaten devam ediyor. LÃ¼tfen bekleyin.' : 'A sign-in is already in progress.',
        };
      }
      if (code.includes(statusCodes.PLAY_SERVICES_NOT_AVAILABLE)) {
        return {
          success: false,
          error: tr
            ? 'Google Play Hizmetleri kullanÄ±lamÄ±yor. LÃ¼tfen gÃ¼ncelleyip tekrar deneyin.'
            : 'Google Play Services is not available. Please update it and try again.',
        };
      }
      console.error('Native Google sign-in error:', error);
      // DEVELOPER_ERROR (code 10) is Android's catch-all for "the OAuth client
      // does not match this app". The JS side already passes the project's WEB
      // client ID (webClientId) â€” when Google still rejects the sign-in the
      // google-services.json baked into the build is out of sync with the
      // console (missing web client / wrong SHA-1), so spell that out.
      if (/^\s*10\s*$/.test(String(error?.code)) || /DEVELOPER_ERROR/i.test(String(error?.message))) {
        return {
          success: false,
          error: tr
            ? 'Google oturum aÃ§ma yapÄ±landÄ±rmasÄ± bu derleme ile eÅŸleÅŸmiyor (DEVELOPER_ERROR). google-services.json iÃ§indeki Web istemci kimliÄŸini ve imza SHA-1 parmak izini Google Cloud Console ile eÅŸitleyip uygulamayÄ± yeniden derleyin.'
            : 'Google sign-in configuration does not match this build (DEVELOPER_ERROR). Re-sync google-services.json â€” its Web client ID and signing SHA-1 â€” with Google Cloud Console and rebuild the app.',
        };
      }
      return {
        success: false,
        error:
          error?.message ||
          (tr ? 'Google ile giriÅŸ baÅŸarÄ±sÄ±z oldu.' : 'Google sign-in failed.'),
      };
    }
  }

  // ---- Web: legacy browser OAuth flow --------------------------------------
  try {
    return { success: true, user: await promptGoogleWithClient(getClientId(), language) };
  } catch (error) {
    console.error('Google sign-in error:', error);
    return { success: false, error: error.message || 'Google sign-in failed' };
  }
}
