// ---------------------------------------------------------------------------
// Firebase Authentication — native @react-native-firebase/auth
// ---------------------------------------------------------------------------
// Uses the official React Native Firebase native module for Android/iOS. All
// configuration comes from the native google-services.json (Android) /
// GoogleService-Info.plist (iOS) files (wired via app.json's
// android.googleServicesFile + the @react-native-firebase/app config plugin).
//
// The API mirrors the Firebase JS SDK but is namespaced and auto-initialised
// from the native config (no initializeApp call needed).

import { getAuth, EmailAuthProvider } from '@react-native-firebase/auth';

/* Initialise + return the native auth instance. Reads config from
   google-services.json automatically. Returns null if the module isn't ready
   (e.g. not configured / running in Expo Go). Never throws. */
export function firebaseAuthInstance() {
  try {
    return getAuth();
  } catch {
    return null;
  }
}

/* The native module is considered configured when the auth API is available.
   Real project config lives in google-services.json. */
export function isFirebaseConfigured() {
  try {
    const auth = getAuth();
    return !!auth && typeof auth.createUserWithEmailAndPassword === 'function';
  } catch {
    return false;
  }
}

/** Throw an auth-not-configured error so callers can show a friendly message. */
function requireAuth() {
  const auth = firebaseAuthInstance();
  if (!auth) {
    const err = /** @type {any} */ (new Error('Firebase auth is not configured in this build.'));
    err.code = 'auth/not-configured';
    throw err;
  }
  return auth;
}

/** Create a new Firebase account (email + password). Returns the auth user. */
export async function firebaseSignUp(email, password) {
  const auth = requireAuth();
  const cred = await auth.createUserWithEmailAndPassword(email, password);
  return cred.user;
}

/** Sign in an existing user (email + password). Returns the auth user. */
export async function firebaseSignIn(email, password) {
  const auth = requireAuth();
  const cred = await auth.signInWithEmailAndPassword(email, password);
  return cred.user;
}

/** Send a password-reset email to the given address. */
export async function firebaseSendPasswordReset(email) {
  const auth = requireAuth();
  await auth.sendPasswordResetEmail(email);
}



/** Sign out the current Firebase user. */
export async function firebaseSignOut() {
  const auth = firebaseAuthInstance();
  if (!auth) return; // nothing to sign out of
  try {
    await auth.signOut();
  } catch (error) {
    console.warn('firebaseSignOut failed:', error?.message || error);
  }
}

/** Observe auth state changes (returns an unsubscribe function). */
export function onFirebaseAuthChanged(callback) {
  const auth = firebaseAuthInstance();
  if (!auth || typeof auth.onAuthStateChanged !== 'function') return () => {};
  return auth.onAuthStateChanged(callback);
}

/** The currently signed-in user (or null). */
export function getCurrentFirebaseUser() {
  const auth = firebaseAuthInstance();
  return auth ? auth.currentUser || null : null;
}

/**
 * Sign in to Firebase with a Google ID token (obtained from the native
 * Google Sign-In module). Returns the signed-in Firebase user.
 *
 * @param {string} idToken - Google identity token from GoogleSignin.signIn()
 * @returns {Promise<object>} the Firebase user
 * @throws when Firebase auth is unavailable or the credential is rejected.
 */
export async function signInWithGoogleIdToken(idToken) {
  const auth = requireAuth();
  const { GoogleAuthProvider } = await import('@react-native-firebase/auth');
  const credential = GoogleAuthProvider.credential(idToken);
  const userCredential = await auth.signInWithCredential(credential);
  return userCredential.user;
}

/** Update the current user's display name and/or photo URL. */
export async function firebaseUpdateProfile(displayName, photoURL) {
  const user = getCurrentFirebaseUser();
  if (!user) throw new Error('auth/no-current-user');
  const updates = { displayName };
  if (photoURL !== undefined) updates.photoURL = photoURL;
  await user.updateProfile(updates);
}

/** Update the current user's password (requires re-auth first). */
export async function firebaseUpdatePassword(newPassword) {
  const user = getCurrentFirebaseUser();
  if (!user) throw new Error('auth/no-current-user');
  await user.updatePassword(newPassword);
}

/** Update the current user's email (requires re-auth first). */
export async function firebaseUpdateEmail(newEmail) {
  const user = getCurrentFirebaseUser();
  if (!user) throw new Error('auth/no-current-user');
  await user.updateEmail(newEmail);
}

// ---------------------------------------------------------------------------
// Passwordless email-link sign-in
// ---------------------------------------------------------------------------
// The email link mode uses the same @react-native-firebase/auth module, but
// sends a "magic link" instead of a password. The flow is:
//   1. Call sendSignInLink(email) — user gets an email with a link.
//   2. The link is opened by the app via deep link (see App.js handler).
//   3. Call signInWithEmailLink(email, link) to complete sign-in.
//
// Firebase requires a `url` in the actionCodeSettings that matches a scheme
// the app can handle. We use the existing custom scheme:
//   com.joshua.islamiogreniyorum://email-link
// (Also add "androidPackageName" / "handleCodeInApp" so Firebase validates the
//  link is meant for this app on both platforms.)

const EMAIL_LINK_REDIRECT_URL = 'com.joshua.islamiogreniyorum://email-link';

/**
 * Send a sign-in email link to the user's address.
 * The user will receive an email with a link; tapping it opens the app.
 * @param {string} email
 * @param {'tr'|'en'} lang
 * @returns {Promise<void>}
 */
export async function sendSignInLink(email, lang = 'tr') {
  const auth = requireAuth();
  const actionCodeSettings = {
    url: EMAIL_LINK_REDIRECT_URL,
    handleCodeInApp: true,
    iOS: { bundleId: 'com.joshua.islamiogreniyorum' },
    android: {
      packageName: 'com.joshua.islamiogreniyorum',
      installApp: false,
      minimumVersion: '21',
    },
  };
  await auth.sendSignInLinkToEmail(email, actionCodeSettings, lang === 'tr' ? 'tr' : 'en');
}

/**
 * Complete sign-in with the email link the user received.
 * @param {string} email
 * @param {string} link — the full URL from the deep link
 * @returns {Promise<object>} the auth user credential
 */
export async function signInWithEmailLink(email, link) {
  const auth = requireAuth();
  const cred = await auth.signInWithEmailLink(email, link);
  return cred.user;
}

/**
 * Returns true if a given URL is a Firebase email-link sign-in link.
 * Returns false (never throws) when Firebase auth is not configured, so the
 * deep-link handler at app startup never crashes on an unconfigured build.
 * @param {string} url
 */
export function isEmailSignInLink(url) {
  const auth = firebaseAuthInstance();
  if (!auth || typeof auth.isSignInWithEmailLink !== 'function') return false;
  try {
    return auth.isSignInWithEmailLink(url);
  } catch {
    return false;
  }
}

/** Re-authenticate the user with email+password before sensitive updates. */
export async function firebaseReauthenticate(email, password) {
  const auth = requireAuth();
  const user = auth.currentUser;
  if (!user) throw new Error('auth/no-current-user');
  // Modern @react-native-firebase/auth exposes EmailAuthProvider as a top-level
  // module export, not a property on the auth instance (auth.EmailAuthProvider
  // is undefined in v21+, which would crash credential()). Using the module
  // import keeps the password re-auth flow working.
  const credential = EmailAuthProvider.credential(email, password);
  await user.reauthenticateWithCredential(credential);
}

/**
 * Re-authenticate a Google-signed-in user before a sensitive operation
 * (e.g. account deletion). Google accounts re-auth by re-acquiring a fresh
 * Google ID token via the native sign-in module and exchanging it for a
 * GoogleAuthProvider credential.
 *
 * @returns {Promise<void>} resolves on success, throws on failure.
 */
export async function firebaseReauthenticateGoogle() {
  const auth = requireAuth();
  const user = auth.currentUser;
  if (!user) throw new Error('auth/no-current-user');
  // Ask the native Google Sign-In module for a fresh ID token. googleAuth.js
  // is lazily imported to avoid a circular dependency at module load time.
  const { getFreshGoogleIdToken } = await import('./googleAuth.js');
  const idToken = await getFreshGoogleIdToken();
  if (!idToken) throw new Error('auth/no-google-token');
  const { GoogleAuthProvider } = await import('@react-native-firebase/auth');
  const credential = GoogleAuthProvider.credential(idToken);
  await user.reauthenticateWithCredential(credential);
}

/**
 * Re-authenticate the current user with whichever provider they signed in with.
 *
 * @param {object} opts
 * @param {boolean} opts.isGoogleUser  true when the session is a Google account
 * @param {string} [opts.email]        account email (password re-auth)
 * @param {string} [opts.password]     account password (password re-auth)
 * @returns {Promise<{ok: boolean, reason?: string}>}
 *   ok=true when re-auth succeeded (or was not needed).
 */
export async function ensureFreshLogin({ isGoogleUser, email, password } = {}) {
  const auth = firebaseAuthInstance();
  const user = auth ? auth.currentUser : null;
  if (!user) return { ok: false, reason: 'auth/no-current-user' };
  try {
    // RNFB returns metadata times as Date objects; the web SDK uses ISO
    // strings. Normalise both to epoch milliseconds. Treat sessions newer
    // than 5 minutes as fresh enough that Firebase will not complain.
    const raw = user.metadata?.lastSignInTime;
    const last =
      raw instanceof Date
        ? raw.getTime()
        : typeof raw === 'string'
          ? Date.parse(raw)
          : Number(raw);
    if (Number.isFinite(last) && last > 0 && Date.now() - last < 5 * 60 * 1000) {
      return { ok: true };
    }
  } catch {
    // metadata unavailable — fall through and re-auth anyway.
  }
  try {
    if (isGoogleUser) {
      await firebaseReauthenticateGoogle();
    } else {
      if (!email || !password) {
        return { ok: false, reason: 'auth/missing-credentials' };
      }
      await firebaseReauthenticate(email, password);
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: String(error?.code || error?.message || 'auth/reauth-failed') };
  }
}

/**
 * Permanently delete the Firebase Auth account of the currently signed-in
 * user. Requires a recent login — call ensureFreshLogin() first, otherwise
 * Firebase throws auth/requires-recent-login.
 *
 * @returns {Promise<void>}
 */
export async function firebaseDeleteAccount() {
  const auth = requireAuth();
  const user = auth.currentUser;
  if (!user) throw new Error('auth/no-current-user');
  await user.delete();
}

/**
 * Convert a Firebase auth / native-module error into a friendly, localized
 * human-readable message. Mirrors the error-code table from the Firebase JS
 * SDK so the same messages appear whether you use the JS or native stack.
 *
 * @param {any} error      The thrown error object.
 * @param {'tr'|'en'} lang Current UI language (defaults to 'tr').
 * @returns {string} A user-friendly error string.
 */
export function friendlyFirebaseError(error, lang = 'tr') {
  const t = lang === 'tr';
  // Native module errors often carry the Firebase code on `error.code` or as
  // a string like "auth/invalid-credential". Some throw plain messages.
  const code =
    (error && (error.code || error._code || error.nativeErrorCode)) || '';
  const message = (error && error.message) || '';

  // Match against known Firebase auth error suffixes.
  const matchCode = (suffix) =>
    code.includes(suffix) ||
    code.replace(/^(auth|native|app):/, '') === suffix ||
    message.includes(suffix);

  const map = {
    'invalid-email': t
      ? 'Geçersiz e-posta adresi.'
      : 'That email address looks invalid.',
    'user-not-found': t
      ? 'Bu e-posta ile kayıtlı bir hesap bulunamadı.'
      : 'No account is registered with that email.',
    'wrong-password': t
      ? 'E-posta veya şifre hatalı.'
      : 'The email or password is incorrect.',
    'user-disabled': t
      ? 'Bu hesap devre dışı bırakıldı.'
      : 'This account has been disabled.',
    'email-already-in-use': t
      ? 'Bu e-posta zaten kullanılıyor.'
      : 'That email is already in use.',
    'weak-password': t
      ? 'Şifre çok kısa (en az 6 karakter).'
      : 'Password should be at least 6 characters.',
    'too-many-requests': t
      ? 'Çok fazla deneme. Lütfen daha sonra tekrar deneyin.'
      : 'Too many attempts. Please try again later.',
    'network-request-failed': t
      ? ('İnternet bağlantınızı kontrol edin. ' +
         'Sunucu uyuyor olabilir, lütfen birkaç saniye bekleyip tekrar deneyin.')
      : ('Please check your internet connection. The backend may be waking ' +
         'up — wait a moment and try again.'),
    'invalid-credential': t
      ? 'Kimlik bilgileri geçersiz.'
      : 'The credentials provided are invalid.',
    'requires-recent-login': t
      ? 'Güvenlik için lütfen çıkıp tekrar giriş yapın.'
      : 'For security, please sign out and back in before retrying.',
    'auth/no-current-user': t
      ? 'Oturum açmış kullanıcı bulunamadı.'
      : 'No signed-in user was found.',
    'auth/not-configured': t
      ? 'Firebase kimlik doğrulama bu derlemede etkin değil. Lütfen uygulamayı güncelleyin.'
      : 'Firebase auth is not enabled in this build. Please update the app.',
  };

  for (const [suffix, text] of Object.entries(map)) {
    if (matchCode(suffix)) return text;
  }

  // Fallback: return the raw message, trimming verbose native prefixes.
  if (message) {
    return message.replace(/^(:|\(|\[)+/, '').replace(/(\)|\])+$/, '').trim();
  }

  return t
    ? 'Bir hata oluştu. Lütfen tekrar deneyin.'
    : 'Something went wrong. Please try again.';
}