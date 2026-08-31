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
    // firebase-admin ships CJS with a namespace-shaped export; under v12 both
    // accessors exist directly. The typeof guards below remain as a safety net
    // for exotic builds (the casts keep JS type-checking quiet).
    const adminNs = /** @type {any} */ (require('firebase-admin'));

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
      typeof adminNs.credential?.cert === 'function'
        ? adminNs.credential.cert(serviceAccount)
        : adminNs.cert(serviceAccount);
    adminNs.initializeApp({ credential });

    // Same v13+ flattening applies to Firestore: admin.firestore() existed on
    // older versions, newer versions expose getFirestore() via sub-module.
    if (typeof adminNs.firestore === 'function') {
      db = adminNs.firestore();
    } else {
      db = require('firebase-admin/firestore').getFirestore();
    }

    // Cheap connectivity check before committing to this backend.
    // Bounded by a timeout so a slow/unreachable network can never hang
    // startup before app.listen (the server would appear dead).
    const probe = db.collection('devices').limit(1).get();
    const probeTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Firestore probe timed out after 8s')), 8000)
    );
    await Promise.race([probe, probeTimeout]);

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
const memReports = [];          // moderation queue
const memUsers = new Map();     // email -> account profile backup
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

  async createQAPost(ownerUserId, question, authorName, authorAvatar) {
    const postId = String(memNextPostId++);
    memPosts.set(postId, {
      ownerUserId,
      question,
      authorName: authorName || null,
      authorAvatar: authorAvatar || null,
      likes: 0,
      likedBy: [],
      createdAt: new Date().toISOString(),
    });
    return postId;
  },
  async getQAPost(postId) {
    const p = memPosts.get(String(postId));
    return p ? { ...p } : null;
  },
  async addQAContribution(postId, userId, text, authorName, authorAvatar) {
    const contributionId = String(memNextContribId++);
    memContribs.set(`${postId}:${contributionId}`, {
      userId,
      text,
      authorName: authorName || null,
      authorAvatar: authorAvatar || null,
      likes: 0,
      likedBy: [],
      createdAt: new Date().toISOString(),
    });
    return contributionId;
  },
  async likeQAContribution(postId, contributionId, userId) {
    const c = memContribs.get(`${postId}:${contributionId}`);
    if (!c) return null;
    const likedBy = c.likedBy || (c.likedBy = []);
    const wasLiked = likedBy.includes(userId);
    if (wasLiked) {
      c.likedBy = likedBy.filter((u) => String(u) !== String(userId));
    } else {
      likedBy.push(userId);
      c.likedBy = likedBy;
    }
    c.likes = likedBy.length;
    return { likes: c.likes, likedByMe: !wasLiked, userId: c.userId };
  },
  async likeQAQuestion(postId, userId) {
    const p = memPosts.get(String(postId));
    if (!p) return null;
    const likedBy = p.likedBy || (p.likedBy = []);
    const wasLiked = likedBy.includes(userId);
    if (wasLiked) {
      p.likedBy = likedBy.filter((u) => String(u) !== String(userId));
    } else {
      likedBy.push(userId);
      p.likedBy = likedBy;
    }
    p.likes = likedBy.length;
    return { likes: p.likes, likedByMe: !wasLiked, ownerUserId: p.ownerUserId };
  },
  async getQAParticipantUserIds(postId) {
    const p = memPosts.get(String(postId));
    if (!p) return [];
    const ids = new Set();
    if (p.ownerUserId) ids.add(p.ownerUserId);
    // Distinct set of every answer author on this thread (single scan).
    for (const [key, c] of memContribs) {
      if (key.startsWith(String(postId) + ':') && c.userId) {
        ids.add(c.userId);
      }
    }
    return [...ids];
  },
  async listQAPosts(limit = 50) {
    const ids = [...memPosts.keys()].slice(-limit).reverse();
    return ids.map((id) => {
      const p = memPosts.get(id);
      const contributions = [...memContribs.entries()]
        .filter(([k]) => k.startsWith(`${id}:`))
        .map(([k, c]) => ({ id: k.split(':')[1], ...c }))
        // Never expose the AI pseudo-user's answers in the public shared feed
        // — each question's AI answer is private to the asking user only.
        .filter((c) => c.userId !== 'ai@islamiogreniyorum.app')
        .sort((a, b) => ((a.createdAt || '') < (b.createdAt || '') ? -1 : 1));
      return { id, ...p, contributions };
    });
  },

  async registerCommunityPost(postId, ownerUserId, meta = {}) {
    memCommunity.set(String(postId), {
      ownerUserId,
      text: meta.text || '',
      authorName: meta.authorName || null,
      authorAvatar: meta.authorAvatar || null,
      mediaType: meta.mediaType || null,
      mediaUri: meta.mediaUri || null,
      createdAt: meta.createdAt || new Date().toISOString(),
      likedBy: [],
      comments: new Map(),
    });
  },
  async getCommunityPost(postId) {
    const p = memCommunity.get(String(postId));
    return p ? { ownerUserId: p.ownerUserId } : null;
  },
  async setCommunityComment(postId, commentId, userId, meta = {}) {
    const p = memCommunity.get(String(postId));
    if (!p) throw new Error('Post not found');
    p.comments.set(String(commentId), {
      userId,
      text: meta.text || '',
      authorName: meta.authorName || null,
      authorAvatar: meta.authorAvatar || null,
      likedBy: [],
      createdAt: new Date().toISOString(),
    });
  },
  async getCommunityComment(postId, commentId) {
    const p = memCommunity.get(String(postId));
    const c = p && p.comments.get(String(commentId));
    return c ? { ...c } : null;
  },
  async listCommunityPosts(limit = 50) {
    return [...memCommunity.entries()]
      .slice(-limit)
      .reverse()
      .map(([id, p]) => ({
        id,
        ownerUserId: p.ownerUserId,
        text: p.text,
        authorName: p.authorName,
        authorAvatar: p.authorAvatar || null,
        mediaType: p.mediaType,
        mediaUri: p.mediaUri,
        createdAt: p.createdAt,
        likedBy: p.likedBy || [],
        comments: [...p.comments.entries()].map(([cid, c]) => ({ id: cid, ...c })),
      }));
  },

  async likeCommunityPost(postId, userId) {
    const p = memCommunity.get(String(postId));
    if (!p) return null;
    const likedBy = p.likedBy || (p.likedBy = []);
    const wasLiked = likedBy.includes(userId);
    if (wasLiked) {
      p.likedBy = likedBy.filter((u) => String(u) !== String(userId));
    } else {
      likedBy.push(userId);
      p.likedBy = likedBy;
    }
    p.likes = likedBy.length;
    return { likes: p.likes, likedByMe: !wasLiked, ownerUserId: p.ownerUserId };
  },
  async likeCommunityComment(postId, commentId, userId) {
    const p = memCommunity.get(String(postId));
    if (!p) return null;
    const c = p.comments.get(String(commentId));
    if (!c) return null;
    const likedBy = c.likedBy || (c.likedBy = []);
    const wasLiked = likedBy.includes(userId);
    if (wasLiked) {
      c.likedBy = likedBy.filter((u) => String(u) !== String(userId));
    } else {
      likedBy.push(userId);
      c.likedBy = likedBy;
    }
    c.likes = likedBy.length;
    return { likes: c.likes, likedByMe: !wasLiked, userId: c.userId };
  },
  async getCommunityParticipantUserIds(postId) {
    const p = memCommunity.get(String(postId));
    if (!p) return [];
    const ids = new Set();
    if (p.ownerUserId) ids.add(p.ownerUserId);
    // Distinct set of every commenter on this post (single scan).
    for (const c of p.comments.values()) {
      if (c.userId) ids.add(c.userId);
    }
    return [...ids];
  },

  async deleteQAPost(postId, ownerUserId) {
    const key = String(postId);
    const p = memPosts.get(key);
    if (!p) return false;
    // Only the owner may delete the thread.
    if (ownerUserId && p.ownerUserId && p.ownerUserId !== ownerUserId) return false;
    // Remove the thread and every contribution under it.
    memPosts.delete(key);
    for (const k of [...memContribs.keys()]) {
      if (k.startsWith(`${key}:`)) memContribs.delete(k);
    }
    return true;
  },
  async deleteQAContribution(postId, contributionId, userId) {
    const key = `${String(postId)}:${String(contributionId)}`;
    const c = memContribs.get(key);
    if (!c) return false;
    // Only the contribution's author (or the AI pseudo-user) may delete it.
    if (userId && c.userId && c.userId !== userId && c.userId !== 'ai@islamiogreniyorum.app') return false;
    memContribs.delete(key);
    return true;
  },
  async deleteCommunityPost(postId, ownerUserId) {
    const key = String(postId);
    const p = memCommunity.get(key);
    if (!p) return false;
    // Only the owner may delete the post.
    if (ownerUserId && p.ownerUserId && p.ownerUserId !== ownerUserId) return false;
    memCommunity.delete(key);
    return true;
  },
  async deleteCommunityComment(postId, commentId, userId) {
    const p = memCommunity.get(String(postId));
    if (!p) return false;
    const c = p.comments.get(String(commentId));
    if (!c) return false;
    // Only the comment's author may delete it.
    if (userId && c.userId && c.userId !== userId) return false;
    p.comments.delete(String(commentId));
    return true;
  },

  async counts() {
    return { devices: memDevices.size, posts: memPosts.size, communityPosts: memCommunity.size };
  },

  async addReport(report) {
    memReports.push({ ...report, createdAt: new Date().toISOString() });
    return true;
  },

  async getUser(id) {
    const u = memUsers.get(String(id));
    return u ? { ...u } : null;
  },
  async setUser(user) {
    memUsers.set(String(user.id), { ...user });
    return { ...user };
  },
  async deleteUser(id) {
    memUsers.delete(String(id));
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

  async createQAPost(ownerUserId, question, authorName, authorAvatar) {
    const ref = await db.collection('qaPosts').add({
      ownerUserId,
      question,
      authorName: authorName || null,
      authorAvatar: authorAvatar || null,
      likes: 0,
      likedBy: [],
      createdAt: new Date().toISOString(),
    });
    return ref.id;
  },
  async getQAPost(postId) {
    const snap = await db.collection('qaPosts').doc(String(postId)).get();
    return snap.exists ? snap.data() : null;
  },
  async addQAContribution(postId, userId, text, authorName, authorAvatar) {
    const ref = await db
      .collection('qaPosts')
      .doc(String(postId))
      .collection('contributions')
      .add({
        userId,
        text,
        authorName: authorName || null,
        authorAvatar: authorAvatar || null,
        likes: 0,
        likedBy: [],
        createdAt: new Date().toISOString(),
      });
    return ref.id;
  },
  async likeQAContribution(postId, contributionId, userId) {
    const ref = db
      .collection('qaPosts')
      .doc(String(postId))
      .collection('contributions')
      .doc(String(contributionId));
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const data = snap.data();
      const likedBy = data.likedBy || [];
      const wasLiked = likedBy.includes(userId);
      const updated = wasLiked
        ? likedBy.filter((u) => String(u) !== String(userId))
        : [...likedBy, userId];
      tx.update(ref, { likedBy: updated, likes: updated.length });
      return { likes: updated.length, likedByMe: !wasLiked, userId: data.userId };
    });
  },
  async likeQAQuestion(postId, userId) {
    const ref = db.collection('qaPosts').doc(String(postId));
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const data = snap.data();
      const likedBy = data.likedBy || [];
      const wasLiked = likedBy.includes(userId);
      const updated = wasLiked
        ? likedBy.filter((u) => String(u) !== String(userId))
        : [...likedBy, userId];
      tx.update(ref, { likedBy: updated, likes: updated.length });
      return { likes: updated.length, likedByMe: !wasLiked, ownerUserId: data.ownerUserId };
    });
  },
  async getQAParticipantUserIds(postId) {
    const ref = db.collection('qaPosts').doc(String(postId));
    const snap = await ref.get();
    if (!snap.exists) return [];
    const ids = new Set();
    const data = snap.data();
    if (data.ownerUserId) ids.add(data.ownerUserId);
    // Single sub-collection scan for every prior answerer.
    const contribsSnap = await ref.collection('contributions').get();
    for (const doc of contribsSnap.docs) {
      const c = doc.data();
      if (c.userId) ids.add(c.userId);
    }
    return [...ids];
  },

  async registerCommunityPost(postId, ownerUserId, meta = {}) {
    await db
      .collection('communityPosts')
      .doc(String(postId))
      .set(
        {
          ownerUserId,
          text: meta.text || '',
          authorName: meta.authorName || null,
          authorAvatar: meta.authorAvatar || null,
          mediaType: meta.mediaType || null,
          mediaUri: meta.mediaUri || null,
          createdAt: meta.createdAt || new Date().toISOString(),
        },
        { merge: true }
      );
  },
  async getCommunityPost(postId) {
    const snap = await db.collection('communityPosts').doc(String(postId)).get();
    return snap.exists ? snap.data() : null;
  },
  async setCommunityComment(postId, commentId, userId, meta = {}) {
    await db
      .collection('communityPosts')
      .doc(String(postId))
      .collection('comments')
      .doc(String(commentId))
      .set(
        {
          userId,
          text: meta.text || '',
          authorName: meta.authorName || null,
          authorAvatar: meta.authorAvatar || null,
          createdAt: new Date().toISOString(),
        },
        { merge: true }
      );
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
  async likeCommunityPost(postId, userId) {
    const ref = db.collection('communityPosts').doc(String(postId));
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const data = snap.data();
      const likedBy = data.likedBy || [];
      const wasLiked = likedBy.includes(userId);
      const updated = wasLiked
        ? likedBy.filter((u) => String(u) !== String(userId))
        : [...likedBy, userId];
      tx.update(ref, { likedBy: updated, likes: updated.length });
      return { likes: updated.length, likedByMe: !wasLiked, ownerUserId: data.ownerUserId };
    });
  },
  async likeCommunityComment(postId, commentId, userId) {
    const ref = db
      .collection('communityPosts')
      .doc(String(postId))
      .collection('comments')
      .doc(String(commentId));
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const data = snap.data();
      const likedBy = data.likedBy || [];
      const wasLiked = likedBy.includes(userId);
      const updated = wasLiked
        ? likedBy.filter((u) => String(u) !== String(userId))
        : [...likedBy, userId];
      tx.update(ref, { likedBy: updated, likes: updated.length });
      return { likes: updated.length, likedByMe: !wasLiked, userId: data.userId };
    });
  },
  async getCommunityParticipantUserIds(postId) {
    const ref = db.collection('communityPosts').doc(String(postId));
    const snap = await ref.get();
    if (!snap.exists) return [];
    const ids = new Set();
    const data = snap.data();
    if (data.ownerUserId) ids.add(data.ownerUserId);
    // Single sub-collection scan for every prior commenter.
    const commentsSnap = await ref.collection('comments').get();
    for (const doc of commentsSnap.docs) {
      const c = doc.data();
      if (c.userId) ids.add(c.userId);
    }
    return [...ids];
  },
  async listQAPosts(limit = 50) {
    const snap = await db
      .collection('qaPosts')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    const out = [];
    for (const doc of snap.docs) {
      const cSnap = await doc.ref.collection('contributions').get();
      const contributions = cSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        // Never expose the AI pseudo-user's answers in the public shared feed
        // — each question's AI answer is private to the asking user only.
        .filter((c) => c.userId !== 'ai@islamiogreniyorum.app')
        .sort((a, b) => ((a.createdAt || '') < (b.createdAt || '') ? -1 : 1));
      out.push({ id: doc.id, ...doc.data(), contributions });
    }
    return out;
  },
  async listCommunityPosts(limit = 50) {
    const snap = await db
      .collection('communityPosts')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    const out = [];
    for (const doc of snap.docs) {
      const cSnap = await doc.ref.collection('comments').get();
      const comments = cSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      out.push({ id: doc.id, ...doc.data(), comments });
    }
    return out;
  },

  async deleteQAPost(postId, ownerUserId) {
    const ref = db.collection('qaPosts').doc(String(postId));
    const snap = await ref.get();
    if (!snap.exists) return false;
    // Only the owner may delete the thread.
    if (ownerUserId && snap.data().ownerUserId && snap.data().ownerUserId !== ownerUserId) return false;
    // Remove every contribution sub-document first, then the thread itself.
    const contribs = await ref.collection('contributions').get();
    await Promise.all(contribs.docs.map((doc) => doc.ref.delete()));
    await ref.delete();
    return true;
  },
  async deleteQAContribution(postId, contributionId, userId) {
    const ref = db
      .collection('qaPosts')
      .doc(String(postId))
      .collection('contributions')
      .doc(String(contributionId));
    const snap = await ref.get();
    if (!snap.exists) return false;
    // Only the contribution's author (or the AI pseudo-user) may delete it.
    if (userId && snap.data().userId && snap.data().userId !== userId && snap.data().userId !== 'ai@islamiogreniyorum.app') {
      return false;
    }
    await ref.delete();
    return true;
  },
  async deleteCommunityPost(postId, ownerUserId) {
    const ref = db.collection('communityPosts').doc(String(postId));
    const snap = await ref.get();
    if (!snap.exists) return false;
    // Only the owner may delete the post.
    if (ownerUserId && snap.data().ownerUserId && snap.data().ownerUserId !== ownerUserId) return false;
    // Remove every comment sub-document first, then the post itself.
    const comments = await ref.collection('comments').get();
    await Promise.all(comments.docs.map((doc) => doc.ref.delete()));
    await ref.delete();
    return true;
  },
  async deleteCommunityComment(postId, commentId, userId) {
    const ref = db
      .collection('communityPosts')
      .doc(String(postId))
      .collection('comments')
      .doc(String(commentId));
    const snap = await ref.get();
    if (!snap.exists) return false;
    // Only the comment's author may delete it.
    if (userId && snap.data().userId && snap.data().userId !== userId) return false;
    await ref.delete();
    return true;
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

  async addReport(report) {
    await db.collection('reports').add({
      ...report,
      createdAt: new Date().toISOString(),
      status: 'open',
    });
    return true;
  },

  async getUser(id) {
    const snap = await db.collection('users').doc(String(id)).get();
    return snap.exists ? snap.data() : null;
  },
  async setUser(user) {
    await db
      .collection('users')
      .doc(String(user.id))
      .set({ ...user }, { merge: true });
    return { ...user };
  },
  async deleteUser(id) {
    await db.collection('users').doc(String(id)).delete();
  },
};

/* ------------------------------ Dispatchers ------------------------------ */
// Cast keeps JS type-checking happy: the Firestore/memory backends declare
// slightly different signatures, so forwarded spread calls upset strict
// union-signature analysis. Erased at runtime — dispatch stays unchanged.
const impl = () => /** @type {any} */ (mode === 'firestore' ? fsImpl : memImpl);

// Forward every call to the active backend, preserving all arguments.
module.exports = {
  initStorage,
  isFirestoreEnabled: () => mode === 'firestore',
  getDevice: (...args) => impl().getDevice(...args),
  setDevice: (...args) => impl().setDevice(...args),
  removeDevice: (...args) => impl().removeDevice(...args),
  getAllDevices: (...args) => impl().getAllDevices(...args),
  createQAPost: (...args) => impl().createQAPost(...args),
  getQAPost: (...args) => impl().getQAPost(...args),
  addQAContribution: (...args) => impl().addQAContribution(...args),
    likeQAContribution: (...args) => impl().likeQAContribution(...args),
  likeQAQuestion: (...args) => impl().likeQAQuestion(...args),
  getQAParticipantUserIds: (...args) => impl().getQAParticipantUserIds(...args),
  deleteQAPost: (...args) => impl().deleteQAPost(...args),
  deleteQAContribution: (...args) => impl().deleteQAContribution(...args),
  registerCommunityPost: (...args) => impl().registerCommunityPost(...args),
  getCommunityPost: (...args) => impl().getCommunityPost(...args),
    setCommunityComment: (...args) => impl().setCommunityComment(...args),
  getCommunityComment: (...args) => impl().getCommunityComment(...args),
  likeCommunityPost: (...args) => impl().likeCommunityPost(...args),
  likeCommunityComment: (...args) => impl().likeCommunityComment(...args),
  getCommunityParticipantUserIds: (...args) => impl().getCommunityParticipantUserIds(...args),
  deleteCommunityPost: (...args) => impl().deleteCommunityPost(...args),
  deleteCommunityComment: (...args) => impl().deleteCommunityComment(...args),
  listQAPosts: (...args) => impl().listQAPosts(...args),
  listCommunityPosts: (...args) => impl().listCommunityPosts(...args),
  addReport: (...args) => impl().addReport(...args),
  counts: (...args) => impl().counts(...args),
  getUser: (...args) => impl().getUser(...args),
  setUser: (...args) => impl().setUser(...args),
  deleteUser: (...args) => impl().deleteUser(...args),
};