/**
 * fix-collection-paths.js
 * One-time migration script: replaces raw-string .collection() / .doc() references
 * with the canonical C.* constants in server/storage.js, server/clear-community.js,
 * and server/check-deploy.js.
 *
 * Run: node scripts/fix-collection-paths.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function replaceAll(str, from, to) {
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return str.replace(new RegExp(esc, 'g'), to);
}

// ============================================================================
// 1. server/storage.js — replace raw string collection paths with C.* constants
// ============================================================================
const STORAGE = path.join(ROOT, 'server', 'storage.js');
let s = fs.readFileSync(STORAGE, 'utf8');

// Map of raw string → C. constant (covers every .collection('...') call)
const collectionReplacements = [
  // Collection names
  ['.collection(\'qaPosts\')',       '.collection(C.QA_POSTS)'],
  ['.collection(\'communityPosts\')', '.collection(C.COMMUNITY_POSTS)'],
  ['.collection(\'contributions\')',  '.collection(C.QA_CONTRIBUTIONS)'],
  ['.collection(\'comments\')',      '.collection(C.COMMUNITY_COMMENTS)'],
  ['.collection(\'users\')',         '.collection(C.USERS)'],
  ['.collection(\'devices\')',       '.collection(C.DEVICES)'],
  ['.collection(\'reports\')',       '.collection(C.REPORTS)'],
  // db.doc(`users/...`) — template literal in getCommunityFeedWithProfileJoin
  ['db.doc(`users/${', 'db.doc(`${C.USERS}/${'],
];

for (const [from, to] of collectionReplacements) {
  s = replaceAll(s, from, to);
}

// Export C from module.exports so standalone scripts can reuse it
s = s.replace(
  'module.exports = {\n  initStorage,',
  'module.exports = {\n  C,\n  initStorage,'
);

// Add a safe onCollectionSnapshot wrapper to fsImpl — guards against null/empty
// collection paths so real-time document-creation snapshot checks never break
// on null parameters and always return an empty array instead of a throw.
const safeSnapshotMethod = `
  /**
   * Real-time document-creation snapshot listener (safe wrapper around onSnapshot).
   *
   * Guards against null / empty collection paths and network errors so callers
   * never receive broken listeners or unhandled rejections. On error or empty
   * snapshots the callback receives an empty array.
   *
   * @param {string} collectionPath - one of the C.* constants (e.g. C.COMMUNITY_POSTS)
   * @param {(docs: Array<{id:string, data:object}>) => void} callback
   * @returns {() => Promise<void>|void} unsubscribe function (no-op-safe)
   */
  onCollectionSnapshot(collectionPath, callback) {
    if (!collectionPath || !db || typeof db.collection !== 'function') {
      return () => {};
    }
    const colRef = db.collection(collectionPath);
    if (!colRef || typeof colRef.onSnapshot !== 'function') {
      return () => {};
    }
    return colRef.onSnapshot(
      (snap) => {
        if (!snap) { callback([]); return; }
        callback(snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) })));
      },
      (error) => {
        console.warn('[storage] onSnapshot error:', error?.message || error);
        callback([]);
      }
    );
  },
`;

// Insert the safeSnapshotMethod right before the closing of fsImpl object
// The fsImpl object closes at the line:  async deleteUser(id) { ... },\n  };
// We find the deleteUser in fsImpl (the one after counts()) and insert before the closing
const fsImplDeleteUserEnd = `  async deleteUser(id) {
    await db.collection(C.USERS).doc(String(id)).delete();
  },
};`;

s = s.replace(fsImplDeleteUserEnd, `  async deleteUser(id) {
    await db.collection(C.USERS).doc(String(id)).delete();
  },
${safeSnapshotMethod}
};`);

fs.writeFileSync(STORAGE, s, 'utf8');
console.log('[fix-collection-paths] ✅ server/storage.js updated');

// ============================================================================
// 2. server/clear-community.js — use C.* constants
// ============================================================================
const CLEAR = path.join(ROOT, 'server', 'clear-community.js');
let cl = fs.readFileSync(CLEAR, 'utf8');

// Add C import after the existing requires
cl = cl.replace(
  "const adminNs = require('firebase-admin');",
  "const adminNs = require('firebase-admin');\nconst { C } = require('./storage');"
);

cl = replaceAll(cl, "db.collection('communityPosts')", 'db.collection(C.COMMUNITY_POSTS)');
cl = replaceAll(cl, "postDoc.ref.collection('comments')", 'postDoc.ref.collection(C.COMMUNITY_COMMENTS)');

fs.writeFileSync(CLEAR, cl, 'utf8');
console.log('[fix-collection-paths] ✅ server/clear-community.js updated');

// ============================================================================
// 3. server/check-deploy.js — use C.DEVICES for the probe
// ============================================================================
const DEPLOY = path.join(ROOT, 'server', 'check-deploy.js');
let cd = fs.readFileSync(DEPLOY, 'utf8');

cd = cd.replace(
  "const admin = require('firebase-admin');",
  "const admin = require('firebase-admin');\nconst { C } = require('./storage');"
);

cd = replaceAll(cd, 'db.collection(\'devices\')', 'db.collection(C.DEVICES)');

fs.writeFileSync(DEPLOY, cd, 'utf8');
console.log('[fix-collection-paths] ✅ server/check-deploy.js updated');

console.log('\nAll collection-path references migrated to canonical C.* constants.');
