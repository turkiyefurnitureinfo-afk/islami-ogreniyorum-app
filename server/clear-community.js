/**
 * clear-community.js
 *
 * Wipes ALL community posts and their comments from Firestore.
 * Usage:  node clear-community.js
 *
 * Requires the same Firebase credentials as the server (serviceAccountKey.json
 * or GOOGLE_APPLICATION_CREDENTIALS / GOOGLE_APPLICATION_CREDENTIALS_JSON env vars).
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');

async function main() {
  // --- Load Firebase admin the same way storage.js does ---
  const adminNs = require('firebase-admin');

  let serviceAccount = null;
  const b64 = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (b64) {
    const json = Buffer.from(b64, 'base64').toString('utf8');
    serviceAccount = JSON.parse(json);
  } else {
    const keyPath = path.resolve(
      __dirname,
      process.env.GOOGLE_APPLICATION_CREDENTIALS || 'serviceAccountKey.json'
    );
    if (!fs.existsSync(keyPath)) {
      console.error(`Service account key not found at ${keyPath}`);
      process.exit(1);
    }
    serviceAccount = require(keyPath);
  }

  const credential =
    typeof adminNs.credential?.cert === 'function'
      ? adminNs.credential.cert(serviceAccount)
      : adminNs.cert(serviceAccount);
  adminNs.initializeApp({ credential });

  // firebase-admin v13+ may expose firestore via sub-module
  const db =
    typeof adminNs.firestore === 'function'
      ? adminNs.firestore()
      : require('firebase-admin/firestore').getFirestore();

  console.log('[clear-community] Fetching all community posts...');
  const postsSnap = await db.collection('communityPosts').get();
  console.log(`[clear-community] Found ${postsSnap.size} community post(s).`);

  if (postsSnap.empty) {
    console.log('[clear-community] Nothing to delete. Done.');
    return;
  }

  let deletedComments = 0;
  let deletedPosts = 0;

  for (const postDoc of postsSnap.docs) {
    // Delete all comments under this post first
    const commentsSnap = await postDoc.ref.collection('comments').get();
    if (!commentsSnap.empty) {
      const commentDeletes = commentsSnap.docs.map((c) => c.ref.delete());
      await Promise.all(commentDeletes);
      deletedComments += commentsSnap.size;
      console.log(
        `[clear-community] Deleted ${commentsSnap.size} comment(s) from post ${postDoc.id}`
      );
    }

    // Delete the post itself
    await postDoc.ref.delete();
    deletedPosts += 1;
  }

  console.log(
    `[clear-community] ✅ Done. Removed ${deletedPosts} post(s) and ${deletedComments} comment(s).`
  );
}

main().catch((err) => {
  console.error('[clear-community] Fatal error:', err);
  process.exit(1);
});
