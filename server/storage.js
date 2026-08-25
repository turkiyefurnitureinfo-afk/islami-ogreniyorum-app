/**
 * Storage layer for the push server.
 *
 * Two interchangeable backends selected once at startup:
 *   - firestore : used automatically when a service-account key is available
 *   - memory    : fallback so local dev works without Firebase credentials
 *
 * Firestore layout:
 *   devices/{userId}                              -> { expoPushToken, name }
 *   qaPosts/{autoId}                              -> { ownerUserId, question }
 *   qaPosts/{postId}/contributions/{autoId}       -> { userId, text, likes }
 *   communityPosts/{postId}                       -> { ownerUserId }
 *   communityPosts/{postId}/comments/{commentId}  -> { userId }
 */

const fs = require('fs');
const path = require('path');

let mode = 'memory';
let db = null;

/** Connect to Firestore if possible, otherwise stay on the memory backend. */
async function initStorage() {
  if (String(process.env.USE_FIRESTORE).toLowerCase() === 'false') {
    console.log('[storage] USE_FIRESTORE=false -> using in-memory store');
    return mode;
  }

  try {
    const admin = require('firebase-admin');

    // Support two ways of providing the service-account key so the server
    // deploys cleanly to cloud hosts (Render/Heroku/etc.):
    //
    //   1. GOOGLE_APPLICATION_CREDENTIALS_JSON (base64) — recommended for
    //      hosting. Set it to `base64 -w0 serviceAccountKey.json` on the host.
    //      No secret file needs to be committed or mounted.
    //   2. GOOGLE_APPLICATION_CREDENTIALS (file path) — original local-dev mode.
    //
    // If neither is present, Firestore is skipped and the in-memory backend is
    // used instead (so the server still boots for quick tests).
    let serviceAccount = null;

    const b64 = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    if (b64) {
      // Decode base64 -> JSON object without writing any file to disk.
      const json = Buffer.from(b64, 'base64').toString('utf8');
      serviceAccount = JSON.parse(json);
    } else {
      // Resolve against THIS module's directory so it works no matter what the
      // process CWD is (handles both absolute and bare-relative values).
      const keyPath = path.resolve(
        __dirname,
        process.env.GOOGLE_APPLICATION_CREDENTIALS || 'serviceAccountKey.json'
      );

      if (!fs.existsSync(keyPath)) {
        throw new Error(`service account key not found at ${keyPath}`);
      }

      serviceAccount = require(keyPath);
    }

    // Common mix-up: an OAuth CLIENT secret file starts with "installed"/"web"
    // and has no project_id. Give an actionable hint instead of a cryptic error.
    if (!serviceAccount.project_id && (serviceAccount.installed || serviceAccount.web)) {
      throw new Error(
        'the JSON is an OAuth client secret, not a SERVICE ACCOUNT key. ' +
          'Get the right one from Firebase Console → Project settings → Service accounts → "Generate new private key".'
      );
    }

    const credential =
      typeof admin.credential?.cert === 'function'
        ? admin.credential.cert(serviceAccount)
        : admin.cert(serviceAccount);
    admin.initializeApp({ credential });

    // Same v13+ flattening applies to Firestore: admin.firestore() existed on
    // older versions, newer versions expose getFirestore() via sub-module.
    if (typeof admin.firestore === 'function') {
      db = admin.firestore();
    } else {
      db = require('firebase-admin/firestore').getFirestore();
    }

    // Cheap connectivity check before committing to this backend.
    await db.collection('devices').limit(1).get();

    mode = 'firestore';
    console.log('[storage] ✅ Connected to Firestore');
  } catch (error) {
    let hint = '';
    if (/NOT_FOUND/.test(String(error.message))) {
      hint = ' Hint: no Firestore DATABASE exists yet — create one at Firebase Console → Firestore Database → "Create database".';
    } else if (/PERMISSION_DENIED/.test(String(error.message))) {
      hint = ' Hint: enable the Cloud Firestore API for this project in Google Cloud Console.';
    }
    mode = 'memory';
    console.warn(`[storage] ⚠️  Firestore unavailable (${error.message}).${hint}`);
    console.warn('[storage] Falling back to in-memory store (data will NOT persist)');
  }
  return mode;
}

/* ------------------------- Memory implementation ------------------------- */
const memDevices = new Map();   // userId -> { expoPushToken, name }
const memPosts = new Map();     // postId -> { ownerUserId }
const memContribs = new Map();  // "postId:contribId" -> { userId, likes }
const memCommunity = new Map(); // postId -> { ownerUserId, comments: Map(commentId -> {userId}) }
let memNextPostId = 1;
let memNextContribId = 1;

const memImpl = {
  async getDevice(userId) {
    const d = memDevices.get(userId);
    return d ? { ...d } : null;
  },
  async setDevice(userId, data) {
    memDevices.set(String(userId), { ...data });
  },
  async removeDevice(userId) {
    memDevices.delete(String(userId));
  },
  async getAllDevices() {
    return [...memDevices.entries()].map(([userId, d]) => ({ userId, ...d }));
  },

  async createQAPost(ownerUserId, question) {
    const postId = String(memNextPostId++);
    memPosts.set(postId, { ownerUserId });
    return postId;
  },
  async getQAPost(postId) {
    const p = memPosts.get(String(postId));
    return p ? { ...p } : null;
  },
  async addQAContribution(postId, userId, text) {
    const contributionId = String(memNextContribId++);
    memContribs.set(`${postId}:${contributionId}`, { userId, likes: 0 });
    return contributionId;
  },
  async likeQAContribution(postId, contributionId) {
    const c = memContribs.get(`${postId}:${contributionId}`);
    if (!c) return null;
    c.likes += 1;
    return { likes: c.likes, userId: c.userId };
  },

  async registerCommunityPost(postId, ownerUserId) {
    memCommunity.set(String(postId), { ownerUserId, comments: new Map() });
  },
  async getCommunityPost(postId) {
    const p = memCommunity.get(String(postId));
    return p ? { ownerUserId: p.ownerUserId } : null;
  },
  async setCommunityComment(postId, commentId, userId) {
    const p = memCommunity.get(String(postId));
    if (!p) throw new Error('Post not found');
    p.comments.set(String(commentId), { userId });
  },
  async getCommunityComment(postId, commentId) {
    const p = memCommunity.get(String(postId));
    const c = p && p.comments.get(String(commentId));
    return c ? { ...c } : null;
  },

  async counts() {
    return { devices: memDevices.size, posts: memPosts.size, communityPosts: memCommunity.size };
  },
};

/* ------------------------ Firestore implementation ----------------------- */
const fsImpl = {
  async getDevice(userId) {
    const snap = await db.collection('devices').doc(String(userId)).get();
    return snap.exists ? snap.data() : null;
  },
  async setDevice(userId, data) {
    await db.collection('devices').doc(String(userId)).set({ ...data }, { merge: true });
  },
  async removeDevice(userId) {
    await db.collection('devices').doc(String(userId)).delete();
  },
  async getAllDevices() {
    const snap = await db.collection('devices').get();
    return snap.docs.map((doc) => ({ userId: doc.id, ...doc.data() }));
  },

  async createQAPost(ownerUserId, question) {
    const ref = await db.collection('qaPosts').add({ ownerUserId, question });
    return ref.id;
  },
  async getQAPost(postId) {
    const snap = await db.collection('qaPosts').doc(String(postId)).get();
    return snap.exists ? snap.data() : null;
  },
  async addQAContribution(postId, userId, text) {
    const ref = await db
      .collection('qaPosts')
      .doc(String(postId))
      .collection('contributions')
      .add({ userId, text, likes: 0 });
    return ref.id;
  },
  async likeQAContribution(postId, contributionId) {
    const ref = db
      .collection('qaPosts')
      .doc(String(postId))
      .collection('contributions')
      .doc(String(contributionId));
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const likes = (snap.data().likes || 0) + 1;
      tx.update(ref, { likes });
      return { likes, userId: snap.data().userId };
    });
  },

  async registerCommunityPost(postId, ownerUserId) {
    await db
      .collection('communityPosts')
      .doc(String(postId))
      .set({ ownerUserId }, { merge: true });
  },
  async getCommunityPost(postId) {
    const snap = await db.collection('communityPosts').doc(String(postId)).get();
    return snap.exists ? snap.data() : null;
  },
  async setCommunityComment(postId, commentId, userId) {
    await db
      .collection('communityPosts')
      .doc(String(postId))
      .collection('comments')
      .doc(String(commentId))
      .set({ userId }, { merge: true });
  },
  async getCommunityComment(postId, commentId) {
    const snap = await db
      .collection('communityPosts')
      .doc(String(postId))
      .collection('comments')
      .doc(String(commentId))
      .get();
    return snap.exists ? snap.data() : null;
  },

  async counts() {
    const [d, p, cp] = await Promise.all([
      db.collection('devices').count().get(),
      db.collection('qaPosts').count().get(),
      db.collection('communityPosts').count().get(),
    ]);
    return {
      devices: d.data().count,
      posts: p.data().count,
      communityPosts: cp.data().count,
    };
  },
};

/* ------------------------------ Dispatchers ------------------------------ */
const impl = () => (mode === 'firestore' ? fsImpl : memImpl);

module.exports = {
  initStorage,
  isFirestoreEnabled: () => mode === 'firestore',
  getDevice: (...a) => impl().getDevice(...a),
  setDevice: (...a) => impl().setDevice(...a),
  removeDevice: (...a) => impl().removeDevice(...a),
  getAllDevices: (...a) => impl().getAllDevices(...a),
  createQAPost: (...a) => impl().createQAPost(...a),
  getQAPost: (...a) => impl().getQAPost(...a),
  addQAContribution: (...a) => impl().addQAContribution(...a),
  likeQAContribution: (...a) => impl().likeQAContribution(...a),
  registerCommunityPost: (...a) => impl().registerCommunityPost(...a),
  getCommunityPost: (...a) => impl().getCommunityPost(...a),
  setCommunityComment: (...a) => impl().setCommunityComment(...a),
  getCommunityComment: (...a) => impl().getCommunityComment(...a),
  counts: (...a) => impl().counts(...a),
};