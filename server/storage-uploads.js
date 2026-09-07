/**
 * Firebase Storage uploader for user media (community photos/videos and
 * profile pictures).
 *
 * WHY: /api/upload used to write files to the local disk. On hosts with an
 * ephemeral filesystem (e.g. Render free tier) that disk is wiped on every
 * deploy/restart, so the /uploads/<name> URLs stored in Firestore would start
 * returning 404 and every previously-shared photo/video (and uploaded profile
 * picture) would render as broken images for the whole community.
 *
 * With Firebase Storage the bytes live in the project's bucket, survive
 * redeploys, and are served over a permanent https:// URL.
 *
 * DESIGN GOALS
 *  - Zero-risk adoption: index.js only calls into this module when Firebase
 *    Storage is actually reachable; any failure falls back to the legacy
 *    disk writer, so behaviour degrades to exactly the old path.
 *  - Same credential resolution as ./storage.js so no extra secrets are
 *    needed on the host (GOOGLE_APPLICATION_CREDENTIALS_JSON base64 env var,
 *    or a service-account key file).
 *  - Lazy init: nothing happens at require-time or boot; the bucket is only
 *    touched on the first upload, keeping server startup unchanged.
 */

const fs = require('fs');
const path = require('path');

// Cache the admin/storage handle + bucket once resolved (per process).
let storageHandle = null;
let bucketPromise = null;
let initFailed = false;
// Project id from the service account (used to guess bucket names).
let project_id = '';

/**
 * Resolve the service-account object exactly like ./storage.js does, so the
 * same env var / key file that powers Firestore also powers Storage.
 * @returns {object|null} service account JSON, or null when unavailable.
 */
function resolveServiceAccount() {
  try {
    const b64 = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    if (b64) {
      return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    }
    const keyPath = path.resolve(
      __dirname,
      process.env.GOOGLE_APPLICATION_CREDENTIALS || 'serviceAccountKey.json'
    );
    if (fs.existsSync(keyPath)) {
      return require(keyPath);
    }
  } catch (error) {
    console.warn('[uploads] credential lookup failed:', error && error.message);
  }
  return null;
}

/**
 * Get the firebase-admin/storage handle, initialising the default app only if
 * ./storage.js or ./verify.js have not already done so. Returns null when
 * Firebase cannot be initialised on this host.
 *
 * firebase-admin v14 note: the top-level namespace only exports
 * initializeApp/getApps/getApp/cert... — storage comes from the
 * 'firebase-admin/storage' submodule via getStorage(app), and the credential
 * from the top-level cert() (there is no admin.credential namespace).
 */
function getStorageHandle() {
  if (storageHandle) return storageHandle;
  if (initFailed) return null;
  try {
    const adminNs = /** @type {any} */ (require('firebase-admin'));
    const { getStorage } = require('firebase-admin/storage');

    // Reuse an existing default app when another module already made one.
    let app = null;
    try {
      const apps = adminNs.getApps ? adminNs.getApps() : [];
      app = apps.length ? apps[0] : adminNs.getApp();
    } catch (_e) {
      app = null; // no default app yet
    }

    if (!app) {
      const serviceAccount = resolveServiceAccount();
      if (!serviceAccount) {
        console.warn('[uploads] no service-account key -> Firebase Storage disabled');
        initFailed = true;
        return null;
      }
      // Remember the project id for bucket-name guesses later.
      if (serviceAccount.project_id) project_id = serviceAccount.project_id;
      const credential =
        typeof adminNs.cert === 'function'
          ? adminNs.cert(serviceAccount)
          : adminNs.credential.cert(serviceAccount);
      app = adminNs.initializeApp({ credential });
    } else if (app.options) {
      // Derive the project id from an already-initialised app when possible.
      const cred = app.options.credential;
      if (!project_id && app.options.projectId) project_id = app.options.projectId;
      if (!project_id && cred && typeof cred.projectId === 'string') {
        project_id = cred.projectId;
      }
    }

    storageHandle = getStorage(app);
    return storageHandle;
  } catch (error) {
    console.warn('[uploads] Firebase Storage unavailable:', error && error.message);
    initFailed = true;
    return null;
  }
}

/**
 * Resolve the project's storage bucket. Order:
 *   1. MEDIA_BUCKET env var (explicit override),
 *   2. the app's configured storageBucket option,
 *   3. well-known bucket names derived from the project id
 *      (<id>.firebasestorage.app for new buckets, <id>.appspot.com for legacy),
 *   4. listing the project's buckets via getBuckets() and taking the first.
 * The first candidate that actually exists wins; null when none do.
 * @returns {Promise<any|null>}
 */
async function resolveBucket() {
  const storage = getStorageHandle();
  if (!storage) return null;

  const app = /** @type {any} */ (storage.app || {});
  const options = app.options || {};

  const candidates = [];
  if (process.env.MEDIA_BUCKET) candidates.push(process.env.MEDIA_BUCKET);
  if (options.storageBucket) candidates.push(options.storageBucket);
  if (project_id) {
    candidates.push(`${project_id}.firebasestorage.app`);
    candidates.push(`${project_id}.appspot.com`);
  }

  try {
    const bucket = await pickBucket(candidates, storage);
    if (bucket) return bucket;
  } catch (_e) {
    // Fall through to the listing approach.
  }

  // Final fallback: ask GCS for the project's buckets (works even when the
  // project id couldn't be derived from options). v14 admin SDK: the GCS
  // client is exposed as .storageClient on the Storage handle.
  try {
    const client = /** @type {any} */ (storage.storageClient || storage);
    const [buckets] = await client.getBuckets();
    return buckets && buckets.length ? buckets[0] : null;
  } catch (_e) {
    return null;
  }
}

/** Try each candidate bucket name in order; fall back to the SDK default. */
async function pickBucket(candidates, storage) {
  const seen = new Set();
  for (const name of candidates) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    try {
      const candidate = storage.bucket(name);
      const [exists] = await candidate.exists();
      if (exists) return candidate;
    } catch (_e) {
      // Try the next candidate.
    }
  }
  return null;
}

/** Get (or resolve once) the storage bucket. Null when Storage is unusable. */
function getBucket() {
  if (!bucketPromise) {
    bucketPromise = resolveBucket().then((bucket) => {
      if (bucket) {
        console.log(`[uploads] Firebase Storage ready (bucket: ${bucket.name})`);
      } else {
        console.warn('[uploads] no usable storage bucket found -> disk fallback');
      }
      return bucket;
    });
  }
  return bucketPromise;
}

/**
 * Upload a buffer to Firebase Storage. Objects are kept PRIVATE; reads go
 * through short-lived V4 signed URLs (see getSignedUrl) served by the API's
 * /uploads/:name route. This avoids needing public-read IAM on the bucket and
 * works with uniform bucket-level access.
 * @param {Buffer} buf            raw file bytes
 * @param {string} name           object name (e.g. "1717171717-abc123.jpg")
 * @param {string} contentType    MIME type, e.g. "image/jpeg"
 * @returns {Promise<{bucket: string}|null>} null when Firebase Storage is not
 *   usable (caller should fall back to disk).
 */
async function uploadBuffer(buf, name, contentType) {
  const bucket = await getBucket();
  if (!bucket) return null;

  const file = bucket.file(name);
  await file.save(buf, {
    contentType,
    resumable: false, // small files: single-shot upload, avoids session overhead
    metadata: {
      cacheControl: 'public, max-age=604800', // 7d, matches the old static maxAge
    },
  });

  return { bucket: bucket.name };
}

// Cache of signed URLs (key: bucket/name/type) to avoid re-signing per view.
const signedCache = new Map();

/**
 * A long-lived V4 signed read URL for a private object. Signed locally with
 * the service-account private key — no extra IAM roles required. The response
 * Content-Type is whatever the object was uploaded with (set in uploadBuffer),
 * so no responseContentType override is needed here.
 * @param {string} name           object name
 * @returns {Promise<string|null>} signed https URL, or null when Storage is
 *   unavailable / the credential cannot sign (e.g. ADC without a key).
 */
async function getSignedUrl(name) {
  const bucket = await getBucket();
  if (!bucket) return null;

  const key = `${bucket.name}/${name}`;
  const cached = signedCache.get(key);
  if (cached && cached.expires > Date.now() + 60000) return cached.url;

  const expires = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days (V4 maximum)
  const [url] = await bucket.file(name).getSignedUrl({
    action: 'read',
    expires,
  });
  if (signedCache.size > 500) signedCache.clear();
  signedCache.set(key, { url, expires });
  return url;
}

/**
 * Delete an object (used by tests / future cleanup flows). Silently succeeds
 * when the object is already gone.
 * @param {string} name
 * @returns {Promise<boolean>} true when deleted (or already absent) via Storage.
 */
async function deleteObject(name) {
  const bucket = await getBucket();
  if (!bucket) return false;
  try {
    await bucket.file(name).delete({ ignoreNotFound: true });
    return true;
  } catch (error) {
    console.warn('[uploads] delete failed:', error && error.message);
    return false;
  }
}

module.exports = { uploadBuffer, getSignedUrl, deleteObject };



