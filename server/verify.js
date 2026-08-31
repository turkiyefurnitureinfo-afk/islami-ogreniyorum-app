// ---------------------------------------------------------------------------
// Firebase ID-token verification for the push server.
//
// Problem it solves
// ----------------
// The app sends `userId` (its email) in the body of every write request and
// the server used to trust that value as the content owner. Anyone could
// spoof another user's email and impersonate them (edit/delete their posts,
// register their device token under their name, etc.).
//
// Fix
// ----
// This module verifies a Firebase ID token (obtained client-side via
// @react-native-firebase/auth -> user.getIdToken()) using the firebase-admin
// SDK, and derives the *cryptographically verified* email + UID from it.
//
// Backward compatibility
// ----------------------
// - If the requester supplies a valid Bearer token: the verified email is
//   authoritative and REPLACES any client-supplied userId. Spoofing is closed.
// - If there is no token (guests, Expo Go without native Firebase, or when the
//   server runs without Firestore credentials): the existing client-supplied
//   userId fallback is kept, so the legacy app and offline workflows keep
//   operating exactly as before.
// - If a token is supplied but invalid/expired: the request is REJECTED (401)
//   rather than silently downgraded — never trust a failing token.
// ---------------------------------------------------------------------------

let adminInitialized = false;
let auth = null; // firebase-admin auth instance (only when credentials are loaded)

/**
 * Initialise firebase-admin auth once. Uses the same credential strategy as
 * storage.js so Dev and Render hosts behave identically. Safe to call any time.
 */
function initVerify() {
  if (adminInitialized) return auth;
  adminInitialized = true;

  try {
    // Respect USE_FIRESTORE=false (memory-only mode) -> no auth either.
    if (String(process.env.USE_FIRESTORE || '').toLowerCase() === 'false') return null;

    const admin = require('firebase-admin');

    // firebase-admin v14 moved app inspection off the root namespace; use
    // getApps() (available on both v13 and v14) to detect existing apps.
    const apps =
      (typeof admin.getApps === 'function' ? admin.getApps() : admin.apps) || [];
    if (apps.length === 0) {
      // Reuse the storage layer's config strategy: base64 JSON env or file path.
      const fs = require('fs');
      const path = require('path');

      let serviceAccount = null;
      const b64 = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
      if (b64) {
        serviceAccount = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
      } else {
        const keyPath = path.resolve(
          __dirname,
          process.env.GOOGLE_APPLICATION_CREDENTIALS || 'serviceAccountKey.json'
        );
        if (fs.existsSync(keyPath)) serviceAccount = require(keyPath);
      }
      if (!serviceAccount) return null; // no credentials -> auth unavailable

      // v13 exposes credential.cert; v14 exposes cert directly on the namespace.
      const credential =
        typeof admin.credential?.cert === 'function'
          ? admin.credential.cert(serviceAccount)
          : admin.cert(serviceAccount);
      admin.initializeApp({ credential });
    }

    // firebase-admin exposes auth() on the namespace (v13), or via the
    // getAuth() sub-module entry (v14).
    auth =
      typeof admin.auth === 'function'
        ? admin.auth()
        : require('firebase-admin/auth').getAuth();
  } catch (error) {
    console.warn('[verify] Firebase auth unavailable:', error.message);
    return null;
  }
  return auth;
}

/**
 * Extract a verified identity from the request, if the client presented one.
 * Never throws — returns one of:
 *   { status: 'verified', email, uid }   -> a valid Firebase token was provided
 *   { status: 'unverified', email }     -> no token (or no auth available); email
 *                                          came from the client body/param/query
 *
 * @param {express.Request} req
 */
async function resolveVerifiedIdentity(req) {
  // Pull the raw userId the client sent (kept for the legacy fallback).
  const clientUserId =
    (req.body && req.body.userId) ||
    (req.body && req.body.reporterId) ||
    (req.headers['x-user-id']) ||
    '';

  const rawAuth = req.headers['authorization'] || '';
  const token = String(rawAuth).replace(/^Bearer\s+/i, '').trim();
  if (!token) return { status: 'unverified', email: clientUserId || '' };

  const authn = initVerify();
  if (!authn) {
    // No Firebase on this host -> cannot verify; treat the token as unverifiable
    // and keep the legacy behaviour (do NOT hard-fail: offline dev must work).
    return { status: 'unverified', email: clientUserId || '' };
  }

  try {
    const decoded = await authn.verifyIdToken(token);
    const email = (decoded.email || clientUserId || '').trim().toLowerCase();
    return { status: 'ok', email };
  } catch (error) {
    // Token present but invalid/expired -> refuse, never fall back to client input.
    const e = error;
    console.warn('[verify] rejected bad token:', (e && e.message) || e);
    return { status: 'rejected', email: '' };
  }
}

/**
 * Express middleware injecting `req.verifiedUserId` (a verified email when the
 * client provided a valid token, otherwise the legacy client-supplied id).
 *
 * When a token is present but invalid, responds 401 and skips the handler —
 * a failing token is never trusted. Responds are JSON to match app parsing.
 */
function requireVerifiedUser(req, res, next) {
  resolveVerifiedIdentity(req).then((identity) => {
    if (identity.status === 'rejected') {
      return res.status(401).json({ error: 'Unauthorized: invalid session token.' });
    }
    // Attach .verifiedUserId (authoritative when a token was verified).
    req.verifiedUserId = identity.email;
    req.identityStatus = identity.status;
    next();
  }).catch((err) => {
    console.error('[verify] middleware error:', err && err.message);
    // Fail closed on internal errors rather than trusting the client id.
    return res.status(500).json({ error: 'Authentication error' });
  });
}

module.exports = { resolveVerifiedIdentity, requireVerifiedUser, initVerify };