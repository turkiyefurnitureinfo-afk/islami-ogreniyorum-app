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

import { getAuth } from '@react-native-firebase/auth';

/* Initialise + return the native auth instance. Reads config from
   google-services.json automatically. Returns null if the module isn't ready
   (e.g. not configured / running in Expo Go). */
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

/** Create a new Firebase account (email + password). Returns the auth user. */
export async function firebaseSignUp(email, password) {
  const auth = getAuth();
  const cred = await auth.createUserWithEmailAndPassword(email, password);
  return cred.user;
}

/** Sign in an existing user (email + password). Returns the auth user. */
export async function firebaseSignIn(email, password) {
  const auth = getAuth();
  const cred = await auth.signInWithEmailAndPassword(email, password);
  return cred.user;
}

/** Send a password-reset email to the given address. */
export async function firebaseSendPasswordReset(email) {
  const auth = getAuth();
  await auth.sendPasswordResetEmail(email);
}

/** Sign out the current Firebase user. */
export async function firebaseSignOut() {
  const auth = getAuth();
  await auth.signOut();
}

/** Observe auth state changes (returns an unsubscribe function). */
export function onFirebaseAuthChanged(callback) {
  const auth = getAuth();
  return auth.onAuthStateChanged(callback);
}

/** The currently signed-in user (or null). */
export function getCurrentFirebaseUser() {
  const auth = getAuth();
  return auth ? auth.currentUser || null : null;
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
  const auth = getAuth();
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
  const auth = getAuth();
  const cred = await auth.signInWithEmailLink(email, link);
  return cred.user;
}

/**
 * Returns true if a given URL is a Firebase email-link sign-in link.
 * @param {string} url
 */
export function isEmailSignInLink(url) {
  const auth = getAuth();
  return auth.isSignInWithEmailLink(url);
}

/** Re-authenticate the user with email+password before sensitive updates. */
export async function firebaseReauthenticate(email, password) {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error('auth/no-current-user');
  const credential = auth.EmailAuthProvider.credential(email, password);
  await user.reauthenticateWithCredential(credential);
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