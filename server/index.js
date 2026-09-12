require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const { Expo } = require('expo-server-sdk');
const { getAIAnswer } = require('./ai-answer');
const { collectNews, collectScholarVideos } = require('./news-collector');
const { getPrayerTimes } = require('./prayer-times');
// Firebase ID-token verification so ownership of synced content can't be spoofed.
const { requireVerifiedUser } = require('./verify');

const app = express();

// CORS configuration - restrict to specific origins in production
const corsOptions = {
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};
app.use(cors(corsOptions));

// Cap request bodies — the largest legit payload is a community post/comment.
// Prevents oversized-body abuse on the free-tier deployment.
app.use(express.json({ limit: '32kb' }));

// ---------- Security headers ----------
app.use((_req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  next();
});

// ---------- Crash-safety ----------
// Express 4 cannot catch exceptions/rejections thrown inside async route
// handlers: one bug would kill the whole server mid-request (this actually
// happened with /api/register during the Firestore migration). Rather than
// wrapping every route by hand, we patch the routers so ANY async handler's
// rejection is forwarded to Express' error pipeline as a clean 500 response.
function crashProof(handler) {
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
for (const method of ['get', 'post', 'put', 'delete', 'patch']) {
  const original = app[method].bind(app);
  app[method] = (path, ...handlers) =>
    original(
      path,
      ...handlers.map((h) =>
        typeof h === 'function' && h.length === 3 ? crashProof(h) : h
      )
    );
}

// Last-resort process guards: log loudly but never exit mid-flight.
/** Render any thrown value safely for logging (unknown-typed by design). */
function describeFatal(value) {
  if (value && typeof value === 'object' && 'stack' in value) {
    return /** @type {Error} */ (value).stack;
  }
  return String(value);
}
process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaughtException:', describeFatal(err));
});
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandledRejection:', describeFatal(reason));
});

// ---------- Rate limiting ----------
// Simple per-IP sliding window (in-memory). The AI endpoints proxy to
// quota-limited upstreams (Google Custom Search + Groq), so without this a single
// client could burn the whole day's quota in minutes. 120 req/min is far
// above what the app itself generates (feed polling ~2 req/min per device).
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120;
const rateBuckets = new Map(); // ip -> { count, resetAt }
const rateLimiterInterval = setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateBuckets) {
    if (bucket.resetAt <= now) rateBuckets.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS);

// Clean up interval on server shutdown
process.on('SIGTERM', () => clearInterval(rateLimiterInterval));
process.on('SIGINT', () => clearInterval(rateLimiterInterval));

function rateLimit(req, res, next) {
  // Render terminates TLS and proxies: x-forwarded-for holds the real client IP.
  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown';
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Too many requests, slow down.' });
  }
  next();
}
app.use(rateLimit);

// Android notification channel id for community/Q&A activity.
// The client defines the matching channel name in notifications.js; both
// sides MUST agree or push messages will land on the default channel.
const COMMUNITY_CHANNEL_ID = 'community-activity';

// Initialize Expo push notification client
// Set EXPO_ACCESS_TOKEN in your .env file (get it from https://expo.dev/settings/access-tokens)
const expo = new Expo({
  accessToken: process.env.EXPO_ACCESS_TOKEN,
});

// Persistent data layer: Firestore when a service-account key is present,
// automatic in-memory fallback otherwise. See ./storage.js for the schema.
const storage = require('./storage');

// Helper: send push notification to a specific user
async function sendPushToUser(userId, title, body, data = {}, channelId = null) {
  const device = await storage.getDevice(userId);
  if (!device || !device.expoPushToken) {
    console.log(`No device registered for user ${userId}`);
    return;
  }

  const messages = [];
  messages.push({
    to: device.expoPushToken,
    sound: 'default',
    title,
    body,
    data,
    ...(channelId ? { channelId } : {}),
  });

  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    try {
      const ticketIds = await expo.sendPushNotificationsAsync(chunk);
      console.log(`Sent push to ${userId}:`, ticketIds);
    } catch (error) {
      console.error(`Error sending push to ${userId}:`, error);
    }
  }
}

// Helper: broadcast to all devices
async function broadcastPush(title, body, data = {}, channelId = null) {
  const messages = [];
  const allDevices = await storage.getAllDevices();
  for (const device of allDevices) {
    if (device.expoPushToken) {
      messages.push({
        to: device.expoPushToken,
        sound: 'default',
        title,
        body,
        data,
        ...(channelId ? { channelId } : {}),
      });
    }
  }

  if (messages.length === 0) return;

  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    try {
      const ticketIds = await expo.sendPushNotificationsAsync(chunk);
      console.log('Broadcast sent:', ticketIds);
        } catch (error) {
      console.error('Broadcast error:', error);
    }
  }
}

// ---- Centralized notification dispatch ----
// Implements the four routing rules in one place so every trigger computes
// its recipient set identically and ALWAYS excludes the triggering user:
//
//   new_question -> every registered device (Q&A: a brand-new question)
//   new_answer    -> question owner + every prior answerer (Q&A thread)
//   new_post      -> every registered device (Community: a brand-new post)
//   new_comment   -> post owner + every prior commenter (Community thread)
//
// Participant-scoped triggers (new_answer / new_comment) do a single
// sub-collection scan per feed item to collect distinct author userIds;
// broadcast triggers (new_question / new_post) read the device registry once.

/**
 * Compute the distinct recipient userIds for a content trigger, applying the
 * routing rules and EXCLUDING the triggering user.
 *
 * @param {'new_question'|'new_answer'|'new_post'|'new_comment'} trigger
 * @param {string} triggerUserId - always excluded from recipients
 * @param {string} entityId - postId (needed for participant-scoped triggers)
 * @returns {Promise<string[]>} recipient userIds
 */
async function computeRecipients(trigger, triggerUserId, entityId) {
  const isBroadcast = trigger === 'new_question' || trigger === 'new_post';
  if (isBroadcast) {
    // Rule 1 & 3: every registered user EXCLUDING the triggering user.
    const devices = await storage.getAllDevices();
    return [...new Set(devices.map((d) => String(d.userId)).filter(Boolean))]
      .filter((uid) => String(uid) !== String(triggerUserId));
  }
  // Rules 2 & 4: thread participants only (owner + prior authors).
  let participantIds;
  if (trigger === 'new_answer') {
    participantIds = await storage.getQAParticipantUserIds(entityId);
  } else if (trigger === 'new_comment') {
    participantIds = await storage.getCommunityParticipantUserIds(entityId);
  } else {
    return [];
  }

  // Always exclude the user who triggered the action.
  return participantIds.filter((id) => String(id) !== String(triggerUserId));
}

/**
 * Dispatch a push notification to every computed recipient.
 *
 * Device tokens are fetched once per recipient (batched with Promise.all)
 * so a large recipient set incurs ~1 storage round-trip per user rather
 * than N sequential lookups. Expo auto-chunks the message batches.
 *
 * @param {object} params
 * @param {'new_question'|'new_answer'|'new_post'|'new_comment'} params.trigger
 * @param {string} params.triggerUserId - excluded from recipients
 * @param {string} params.entityId - postId for participant-scoped triggers
 * @param {string} params.title
 * @param {string} params.body
 * @param {object} [params.data] - extra data payload
 */
async function dispatchNotification({ trigger, triggerUserId, entityId, title, body, data = {} }) {
  const recipientIds = await computeRecipients(trigger, triggerUserId, entityId);
  if (recipientIds.length === 0) return;

  // Batch-fetch device tokens once per recipient (avoids N+1 getDevice calls).
  const devicesByUser = {};
  await Promise.all(
    recipientIds.map(async (uid) => {
      devicesByUser[uid] = await storage.getDevice(uid);
    })
  );

  const messages = [];
  for (const uid of recipientIds) {
    const device = devicesByUser[uid];
    if (!device || !device.expoPushToken) continue;
    // Route community/Q&A activity through the dedicated channel so users can
    // mute them independently of prayer times.
    const channelId =
      trigger === 'new_post' || trigger === 'new_comment' || trigger === 'new_answer'
        ? COMMUNITY_CHANNEL_ID
        : null;
    messages.push({
      to: device.expoPushToken,
      sound: 'default',
      title,
      body,
      data: { ...data, recipientUserId: uid },
      ...(channelId ? { channelId } : {}),
    });
  }

  if (messages.length === 0) return;

  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    try {
      await expo.sendPushNotificationsAsync(chunk);
    } catch (error) {
      console.error('[dispatch] push send failed:', error.message);
    }
  }
  console.log(`[dispatch] ${trigger} -> ${messages.length} push(es) sent (triggered by ${triggerUserId})`);
}

// ---------- Routes ----------

// ---------- Media upload ----------
// The native app uploads community photos/videos and profile pictures here so
// every device gets a permanent public URL. (On-device Firebase Web-SDK
// Storage uploads don't work in React Native, which is why others couldn't see
// media.) Bodies are accepted as base64 JSON — keeps the client simple and
// avoids adding multer. Public files are served from /uploads/*.
const UPLOADS_DIR =
  process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
const crypto = require('crypto');
const fs = require('fs');
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB, mirrors app limit
const MAX_UPLOAD_BASE64 = Math.ceil(MAX_UPLOAD_BYTES * 1.34) + 1024;

// Ensure the uploads dir exists (both locally and on Render's ephemeral disk).
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// A separate body parser for the upload route: it needs a much larger limit
// than the default 32kb used everywhere else.
const uploadJson = express.json({ limit: '60mb' });

// Firebase Storage backend for uploads (survives host redeploys; the local
// disk does not — e.g. Render wipes it on every deploy). storage-uploads.js
// reuses the same service-account credentials as the Firestore layer and
// returns null when Storage is unusable, in which case we fall back to the
// original disk write below. Nothing else in the API contract changes:
// the client still POSTs {data, ext} and receives {success, url}.
const storageUploads = require('./storage-uploads');

/** MIME type for an uploaded file extension (small, safe allowlist). */
function mimeForExt(ext) {
  const map = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    m4v: 'video/x-m4v',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    wav: 'audio/wav',
    pdf: 'application/pdf',
  };
  return map[ext.toLowerCase()] || 'application/octet-stream';
}

app.post('/api/upload', uploadJson, async (req, res) => {
  const { data, ext } = req.body;
  // data: base64 of the raw file; ext: 'jpg' | 'mp4' | 'png' | ...
  if (!data || typeof data !== 'string') {
    return res.status(400).json({ error: 'data (base64) is required' });
  }
  if (typeof data !== 'string' || data.length > MAX_UPLOAD_BASE64) {
    return res.status(413).json({ error: 'Upload too large (max 50 MB)' });
  }
  const safeExt =
    /^[A-Za-z0-9]{1,6}$/.test(String(ext)) ? String(ext) : 'bin';

  try {
    // The client sends a full data URI ("data:image/jpeg;base64,....") from
    // FileReader.readAsDataURL. Decoding the WHOLE string as base64 would
    // silently decode the prefix's alphabet characters too, prepending ~14
    // bytes of garbage and corrupting every stored file (broken images).
    // Strip a leading data-URI prefix when present; raw base64 also works.
    const match = /^data:[^,]*,/i.exec(data);
    const b64 = match ? data.slice(match[0].length) : data;

    const buf = Buffer.from(b64, 'base64');
    if (buf.length < 1) throw new Error('Empty data');
    if (buf.length > MAX_UPLOAD_BYTES) {
      return res.status(413).json({ error: 'Upload too large (max 50 MB)' });
    }
    const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${safeExt}`;

    // Preferred path: persistent Firebase Storage object (kept private; reads
    // are served via /uploads/:name -> short-lived signed URL, so the URL the
    // client stores is IDENTICAL to the disk-path URL below).
    let storedViaStorage = false;
    try {
      const uploaded = await storageUploads.uploadBuffer(
        buf,
        name,
        mimeForExt(safeExt)
      );
      if (uploaded && uploaded.bucket) {
        storedViaStorage = true;
        console.log(`[upload] saved ${name} (${buf.length} bytes) -> Storage bucket ${uploaded.bucket}`);
      }
    } catch (storageError) {
      console.error('[upload] Storage write failed, falling back to disk:',
        (storageError && storageError.message) || storageError);
    }

    if (!storedViaStorage) {
      // Legacy path: local disk (ephemeral on some hosts, but keeps the
      // endpoint fully functional when Firebase Storage is not configured).
      fs.writeFileSync(path.join(UPLOADS_DIR, name), buf);
      console.log(`[upload] saved ${name} (${buf.length} bytes) -> disk`);
    }

    // Same URL shape either way — the client contract is unchanged.
    // IMPORTANT: always return an ABSOLUTE public URL so the client stores a
    // URL that survives server redeploy/restart (Render free tier wipes the
    // disk on every deploy, but the stored URL still points at the public
    // host which re-serves the file on the next upload).
    const publicUrl = `${process.env.PUBLIC_SERVER_URL || 'https://islami-ogreniyorum-server.onrender.com'}/uploads/${name}`;
    const url = storedViaStorage
      ? publicUrl   // identical shape — the signed URL GET endpoint below serves it
      : publicUrl;  // disk path is ephemeral but the URL is permanent
    res.json({ success: true, url, absoluteUrl: `${req.protocol}://${req.get('host')}${url}` });
  } catch (error) {
    console.error('[upload] failed:', error && error.message);
    res.status(400).json({ error: 'Upload failed' });
  }
});

// Serve uploaded media publicly so the whole community can view it.
app.use(
  '/uploads',
  express.static(UPLOADS_DIR, {
    maxAge: '7d',
    setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff'),
  })
);

// Signed-URL gateway for media stored in Firebase Storage (the disk fallback
// above only serves files that exist locally). For a private Storage object
// the static middleware falls through to here; we redirect to a short-lived
// V4 signed read URL (max 7 days per V4 rules) so the stored /uploads/<name>
// URL keeps working for every user without public-read IAM on the bucket.
app.get('/uploads/:name', async (req, res) => {
  const name = String(req.params.name || '');
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(name) || name.includes('..')) {
    return res.status(400).json({ error: 'Bad name' });
  }
  try {
    const signed = await storageUploads.getSignedUrl(name);
    if (signed) return res.redirect(302, signed);
    // No Storage on this host: the file must be on disk (static handled it)
    // or it genuinely doesn't exist.
    return res.status(404).json({ error: 'Not found' });
  } catch (error) {
    console.error('[uploads] signed-url error:', error && error.message);
    return res.status(404).json({ error: 'Not found' });
  }
});

// Register a device token for a user
app.post('/api/register', requireVerifiedUser, async (req, res) => {
  const userId = req.verifiedUserId;
  const { expoPushToken, name, email, platform } = req.body;
  if (!userId || !expoPushToken) {
    return res.status(400).json({ error: 'userId and expoPushToken are required' });
  }

  await storage.setDevice(userId, {
    expoPushToken,
    name: name || 'User',
    email: email || null,
    platform: platform || null,
  });
  console.log(`Registered device for ${userId} (${name || 'User'}) [${platform || 'unknown'}]`);
  res.json({ success: true });
});

// Unregister a device
app.post('/api/unregister', requireVerifiedUser, (req, res) => {
  const userId = req.verifiedUserId;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  storage.removeDevice(userId);
  console.log(`Unregistered device for ${userId}`);
  res.json({ success: true });
});

// Post a new question -> notify all other users (Rule 1: broadcast)
app.post('/api/posts', requireVerifiedUser, async (req, res) => {
  const userId = req.verifiedUserId;
  const { question, name, avatar } = req.body;
  if (!userId || !question) {
    return res.status(400).json({ error: 'userId and question are required' });
  }

  const postId = await storage.createQAPost(userId, question, name || null, avatar || null);

  // Rule 1: every registered user except the asker.
  await dispatchNotification({
    trigger: 'new_question',
    triggerUserId: userId,
    entityId: postId,
    title: 'New Question',
    body: `${name || 'A user'} asked: "${question.slice(0, 60)}${question.length > 60 ? '...' : ''}"`,
    data: { type: 'new_question', postId },
  });

  res.json({ success: true, postId });
});

// Add a contribution to a Q&A question -> notify owner + prior answerers (Rule 2)
app.post('/api/posts/:postId/contributions', requireVerifiedUser, async (req, res) => {
  const { postId } = req.params;
  const userId = req.verifiedUserId;
  const { text, name, avatar } = req.body;
  if (!userId || !text) {
    return res.status(400).json({ error: 'userId and text are required' });
  }

  const post = await storage.getQAPost(postId);
  if (!post) {
    return res.status(404).json({ error: 'Post not found' });
  }

  const contribId = await storage.addQAContribution(postId, userId, text, name || null, avatar || null);

  // Rule 2: question owner + every prior answerer, minus the new answerer.
  // computeRecipients fetches participants in a single sub-collection scan and
  // auto-excludes the triggering user.
  await dispatchNotification({
    trigger: 'new_answer',
    triggerUserId: userId,
    entityId: postId,
    title: 'New Answer',
    body: `${name || 'A user'} answered: "${text.slice(0, 60)}${text.length > 60 ? '...' : ''}"`,
    data: { type: 'new_answer', postId, contributionId: contribId },
  });

  res.json({ success: true, contributionId: contribId });
});

// Like / unlike a Q&A contribution -> notify the contribution author (toggle)
app.post('/api/posts/:postId/contributions/:contribId/like', requireVerifiedUser, async (req, res) => {
  const { postId, contribId } = req.params;
  const userId = req.verifiedUserId;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  const result = await storage.likeQAContribution(postId, contribId, userId);
  if (!result) {
    return res.status(404).json({ error: 'Contribution not found' });
  }

  // Notify the contribution author only on a fresh like (not on un-like).
  if (result.likedByMe && result.userId && String(result.userId) !== String(userId)) {
    const liker = await storage.getDevice(userId);
    const likerName = liker?.name || 'A user';
    await sendPushToUser(
      result.userId,
      'New Like',
      `${likerName} liked your comment`,
      { type: 'new_like', postId, contributionId: contribId },
      COMMUNITY_CHANNEL_ID
    );
  }

  res.json({ success: true, likes: result.likes, likedByMe: result.likedByMe });
});

// Like / unlink a Q&A question -> notify the question author (toggle)
app.post('/api/posts/:postId/like', requireVerifiedUser, async (req, res) => {
  const { postId } = req.params;
  const userId = req.verifiedUserId;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  const result = await storage.likeQAQuestion(postId, userId);
  if (!result) {
    return res.status(404).json({ error: 'Post not found' });
  }

  // Notify the question author only on a fresh like (not on un-like).
  if (result.likedByMe && result.ownerUserId && String(result.ownerUserId) !== String(userId)) {
    const liker = await storage.getDevice(userId);
    const likerName = liker?.name || 'A user';
    await sendPushToUser(
      result.ownerUserId,
      'New Like',
      `${likerName} liked your question`,
      { type: 'new_like', postId },
      COMMUNITY_CHANNEL_ID
    );
  }

  res.json({ success: true, likes: result.likes, likedByMe: result.likedByMe });
});

// Delete a Q&A question (owner only) -> removes it from the shared feed for everyone.
app.delete('/api/posts/:postId', requireVerifiedUser, async (req, res) => {
  const { postId } = req.params;
  const userId = req.verifiedUserId;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }
  const ok = await storage.deleteQAPost(postId, userId);
  if (!ok) {
    return res.status(404).json({ error: 'Post not found or not yours to delete' });
  }
  console.log(`Q&A post ${postId} deleted by ${userId}`);
  res.json({ success: true });
});

// Delete an answer/contribution (author or the AI pseudo-user) from a question.
app.delete('/api/posts/:postId/contributions/:contribId', requireVerifiedUser, async (req, res) => {
  const { postId, contribId } = req.params;
  const userId = req.verifiedUserId;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }
  const ok = await storage.deleteQAContribution(postId, contribId, userId);
  if (!ok) {
    return res.status(404).json({ error: 'Contribution not found or not yours to delete' });
  }
  console.log(`Q&A contribution ${contribId} deleted by ${userId}`);
  res.json({ success: true });
});

// Update a Q&A question (owner only)
app.put('/api/posts/:postId', requireVerifiedUser, async (req, res) => {
  const { postId } = req.params;
  const userId = req.verifiedUserId;
  const { question } = req.body;
  if (!userId || !question) {
    return res.status(400).json({ error: 'userId and question are required' });
  }
  const ok = await storage.updateQAPost(postId, userId, { question });
  if (!ok) {
    return res.status(404).json({ error: 'Post not found or not yours to update' });
  }
  console.log(`Q&A post ${postId} updated by ${userId}`);
  res.json({ success: true });
});

// Update a Q&A answer/contribution (author only)
app.put('/api/posts/:postId/contributions/:contribId', requireVerifiedUser, async (req, res) => {
  const { postId, contribId } = req.params;
  const userId = req.verifiedUserId;
  const { text } = req.body;
  if (!userId || !text) {
    return res.status(400).json({ error: 'userId and text are required' });
  }
  const ok = await storage.updateQAContribution(postId, contribId, userId, text);
  if (!ok) {
    return res.status(404).json({ error: 'Contribution not found or not yours to update' });
  }
  console.log(`Q&A contribution ${contribId} updated by ${userId}`);
  res.json({ success: true });
});

// ---------- User accounts ----------
// The app stores credentials on-device; these endpoints back up profile and
// auth changes so they survive reinstalls and can sync across devices.
//
// Firestore layout: users/{email(lowercased)} -> { fullName, email, passwordHash, profilePicture, updatedAt }
// (emails are used as IDs because the app identifies users by email everywhere.)

// Create or overwrite the stored profile for an email (used at sign-up).
app.post('/api/users/register', requireVerifiedUser, async (req, res) => {
  const { email, fullName, passwordHash, profilePicture, occupation, address, bio } = req.body;
  // When a token was verified, the verified email is authoritative.
  const targetEmail = (req.identityStatus === 'ok' ? req.verifiedUserId : email)
    || email;
  if (!targetEmail || typeof targetEmail !== 'string') {
    return res.status(400).json({ error: 'email is required' });
  }
  // Prevent a verified user from registering/overwriting another user's record.
  if (req.identityStatus === 'ok' && targetEmail !== req.verifiedUserId) {
    return res.status(403).json({ error: 'You can only manage your own account.' });
  }
  const id = targetEmail.trim().toLowerCase();
  // MERGE, don't replace: re-login / token refresh re-registers the device and
  // must never wipe fields this call doesn't carry (occupation, address, bio,
  // or a newer profilePicture saved from another device).
  const existing = await storage.getUser(id);
  await storage.setUser({
    id,
    fullName: fullName || (existing && existing.fullName) || '',
    email: id,
    passwordHash: passwordHash || (existing && existing.passwordHash) || null,
    profilePicture: profilePicture || (existing && existing.profilePicture) || null,
    occupation: occupation ?? (existing && existing.occupation) ?? '',
    address: address ?? (existing && existing.address) ?? '',
    bio: bio ?? (existing && existing.bio) ?? '',
    updatedAt: new Date().toISOString(),
  });
  console.log(`[users] registered ${String(targetEmail).trim().toLowerCase()}`);
  res.json({ success: true });
});

// Look up a user by email so a changed name/email reflects on other devices.
app.get('/api/users/:email', async (req, res) => {
  const user = await storage.getUser(String(req.params.email).trim().toLowerCase());
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json({ success: true, user });
});

// Editable profile fields (shared by POST /register and PUT below). These let
// users edit the information they first entered at signup — keyed by email.
const USER_PROFILE_FIELDS = ['fullName', 'profilePicture', 'occupation', 'address', 'bio'];
function extractUserPatch(body = {}) {
  const patch = {};
  if (typeof body.fullName === 'string') patch.fullName = body.fullName.slice(0, 120);
  if (typeof body.profilePicture === 'string') patch.profilePicture = body.profilePicture.slice(0, 2048);
  if (typeof body.occupation === 'string') patch.occupation = body.occupation.slice(0, 120);
  if (typeof body.address === 'string') patch.address = body.address.slice(0, 200);
  if (typeof body.bio === 'string') patch.bio = body.bio.slice(0, 500);
  return patch;
}

// Update name / email / password hash. The `id` query param is the ORIGINAL
// email (so an email change moves the record instead of creating a dupe).
app.put('/api/users/:email', requireVerifiedUser, async (req, res) => {
  const id = String(req.params.email).trim().toLowerCase();
  // Only the verified owner may modify their own account record.
  if (req.identityStatus === 'ok' && req.verifiedUserId !== id) {
    return res.status(403).json({ error: 'You can only manage your own account.' });
  }
  const existing = await storage.getUser(id);
  if (!existing) {
    return res.status(404).json({ error: 'User not found' });
  }

  const patch = {};
  if (typeof req.body.fullName === 'string') patch.fullName = req.body.fullName.slice(0, 120);
  if (typeof req.body.email === 'string' && req.body.email.includes('@')) {
    patch.email = req.body.email.trim().toLowerCase();
  }
  if (typeof req.body.passwordHash === 'string') patch.passwordHash = req.body.passwordHash;
  if (typeof req.body.profilePicture === 'string') patch.profilePicture = req.body.profilePicture.slice(0, 2048);
  // Edit Profile: the signup profile fields are editable for the life of the
  // account and are stored on the same per-email record.
  if (typeof req.body.occupation === 'string') patch.occupation = req.body.occupation.slice(0, 120);
  if (typeof req.body.address === 'string') patch.address = req.body.address.slice(0, 200);
  if (typeof req.body.bio === 'string') patch.bio = req.body.bio.slice(0, 1000);
  // Editable signup fields (occupation / address / bio) — stored per email.
  Object.assign(patch, extractUserPatch(req.body));
  // Extended profile (signup fields — editable later in Edit Profile).
  if (typeof req.body.occupation === 'string') patch.occupation = req.body.occupation.slice(0, 120);
  if (typeof req.body.address === 'string') patch.address = req.body.address.slice(0, 200);
  if (typeof req.body.bio === 'string') patch.bio = req.body.bio.slice(0, 500);

  if (req.identityStatus === 'ok' && patch.email && patch.email !== req.verifiedUserId) {
    return res.status(403).json({ error: 'You cannot change your email to another user.' });
  }

  const updated = await storage.setUser({ ...existing, ...patch, updatedAt: new Date().toISOString() });

  // Email change -> move the document to the new ID and delete the old one.
  if (patch.email && patch.email !== id) {
    await storage.deleteUser(id);
    await storage.setUser({ ...updated, id: patch.email });
    console.log(`[users] moved ${id} -> ${patch.email}`);
  }
  res.json({ success: true, user: updated });
});

// ---------- Prayer times (Diyanet convention, worldwide) ----------

// ---------- Prayer times (Diyanet convention, worldwide) ----------
// Proxies AlAdhan (method 13 = Diyanet İşleri Başkanlığı criteria) so the app
// can show trusted, official-convention times for ANY coordinate on earth.
// Falls back gracefully: the app keeps its on-device computation when this
// endpoint is unreachable.
app.get('/api/prayer-times', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ error: 'lat and lng query params are required numbers' });
  }
  const tz = req.query.tz !== undefined ? parseFloat(req.query.tz) : undefined;
  const method = String(req.query.method || 'diyanet');
  try {
    const payload = await getPrayerTimes({ lat, lng, tz, method });
    res.json({ success: true, ...payload });
  } catch (error) {
    console.error('[prayer-times] upstream failed:', error.message);
    res.status(502).json({ success: false, error: 'Prayer-time provider unavailable' });
  }
});

// ---------- Community posts ----------
// The app is local-first: it keeps its own post/comment IDs. Devices register
// their posts here so comments/likes can be routed back to the right author.

// Register a community post -> notify all other users (Rule 3: broadcast)
app.post('/api/community/posts', requireVerifiedUser, async (req, res) => {
  const { postId, text, name, avatar, mediaType, mediaUri } = req.body;
  const userId = req.verifiedUserId;
  if (!postId || !userId) {
    return res.status(400).json({ error: 'postId and userId are required' });
  }

  await storage.registerCommunityPost(postId, userId, {
    text: typeof text === 'string' ? text : '',
    authorName: name || null,
    authorAvatar: avatar || null,
    mediaType: mediaType || null,
    mediaUri: mediaUri || null,
  });

  // Rule 3: every registered user except the creator.
  const truncatedText = (typeof text === 'string' ? text : '').slice(0, 60);
  await dispatchNotification({
    trigger: 'new_post',
    triggerUserId: userId,
    entityId: postId,
    title: 'New Post',
    body: `${name || 'A user'} shared: "${truncatedText}${(typeof text === 'string' ? text : '').length > 60 ? '...' : ''}"`,
    data: { type: 'new_post', postId },
  });

  console.log(`Community post ${postId} registered for ${userId}`);
  res.json({ success: true });
});

// Comment on a community post -> notify owner + prior commenters (Rule 4)
app.post('/api/community/posts/:postId/comments', requireVerifiedUser, async (req, res) => {
  const { postId } = req.params;
  const userId = req.verifiedUserId;
  const { commentId, text, name, avatar } = req.body;
  if (!commentId || !userId || !text) {
    return res.status(400).json({ error: 'commentId, userId and text are required' });
  }

  const post = await storage.getCommunityPost(postId);
  if (!post) {
    return res.status(404).json({ error: 'Post not found' });
  }

  await storage.setCommunityComment(postId, commentId, userId, {
    text: typeof text === 'string' ? text : '',
    authorName: name || null,
    authorAvatar: avatar || null,
  });

  // Rule 4: post owner + every prior commenter, minus the new commenter.
  // computeRecipients fetches participants in a single sub-collection scan and
  // auto-excludes the triggering user.
  await dispatchNotification({
    trigger: 'new_comment',
    triggerUserId: userId,
    entityId: postId,
    title: 'New Comment',
    body: `${name || 'A user'} commented: "${text.slice(0, 60)}${text.length > 60 ? '...' : ''}"`,
    data: { type: 'community_comment', postId, commentId },
  });

  res.json({ success: true });
});

// Like / unlike a community post -> notify the post author (toggle)
app.post('/api/community/posts/:postId/like', requireVerifiedUser, async (req, res) => {
  const { postId } = req.params;
  const userId = req.verifiedUserId;
  const { name } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  const result = await storage.likeCommunityPost(postId, userId);
  if (!result) {
    return res.status(404).json({ error: 'Post not found' });
  }

  // Notify the post author only on a fresh like (not on un-like).
  if (result.likedByMe && result.ownerUserId && String(result.ownerUserId) !== String(userId)) {
    const liker = await storage.getDevice(userId);
    const likerName = liker?.name || name || 'A user';
    await sendPushToUser(
      result.ownerUserId,
      'New Like',
      `${likerName} liked your post`,
      { type: 'community_post_like', postId },
      COMMUNITY_CHANNEL_ID
    );
  }

  res.json({ success: true, likes: result.likes, likedByMe: result.likedByMe });
});

// Like / unlike a comment on a community post -> notify the comment's author (toggle)
app.post('/api/community/posts/:postId/comments/:commentId/like', requireVerifiedUser, async (req, res) => {
  const { postId, commentId } = req.params;
  const userId = req.verifiedUserId;
  const { name } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  const result = await storage.likeCommunityComment(postId, commentId, userId);
  if (!result) {
    return res.status(404).json({ error: 'Comment not found' });
  }

  // Notify the comment author only on a fresh like (not on un-like).
  if (result.likedByMe && result.userId && String(result.userId) !== String(userId)) {
    const liker = await storage.getDevice(userId);
    const likerName = liker?.name || name || 'A user';
    await sendPushToUser(
      result.userId,
      'New Like',
      `${likerName} liked your comment`,
      { type: 'community_comment_like', postId, commentId },
      COMMUNITY_CHANNEL_ID
    );
  }

  res.json({ success: true, likes: result.likes, likedByMe: result.likedByMe });
});

// Delete a community post (owner only) -> removes it from the shared feed.
app.delete('/api/community/posts/:postId', requireVerifiedUser, async (req, res) => {
  const { postId } = req.params;
  const userId = req.verifiedUserId;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }
  const ok = await storage.deleteCommunityPost(postId, userId);
  if (!ok) {
    return res.status(404).json({ error: 'Post not found or not yours to delete' });
  }
  console.log(`Community post ${postId} deleted by ${userId}`);
  res.json({ success: true });
});

// Delete a comment on a community post (author only).
app.delete('/api/community/posts/:postId/comments/:commentId', requireVerifiedUser, async (req, res) => {
  const { postId, commentId } = req.params;
  const userId = req.verifiedUserId;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }
  const ok = await storage.deleteCommunityComment(postId, commentId, userId);
  if (!ok) {
    return res.status(404).json({ error: 'Comment not found or not yours to delete' });
  }
  console.log(`Community comment ${commentId} deleted by ${userId}`);
  res.json({ success: true });
});

// Update a community post (owner only)
app.put('/api/community/posts/:postId', requireVerifiedUser, async (req, res) => {
  const { postId } = req.params;
  const userId = req.verifiedUserId;
  const { text } = req.body;
  if (!userId || !text) {
    return res.status(400).json({ error: 'userId and text are required' });
  }
  const ok = await storage.updateCommunityPost(postId, userId, text);
  if (!ok) {
    return res.status(404).json({ error: 'Post not found or not yours to update' });
  }
  console.log(`Community post ${postId} updated by ${userId}`);
  res.json({ success: true });
});

// Update a community comment (author only)
app.put('/api/community/posts/:postId/comments/:commentId', requireVerifiedUser, async (req, res) => {
  const { postId, commentId } = req.params;
  const userId = req.verifiedUserId;
  const { text } = req.body;
  if (!userId || !text) {
    return res.status(400).json({ error: 'userId and text are required' });
  }
  const ok = await storage.updateCommunityComment(postId, commentId, userId, text);
  if (!ok) {
    return res.status(404).json({ error: 'Comment not found or not yours to update' });
  }
  console.log(`Community comment ${commentId} updated by ${userId}`);
  res.json({ success: true });
});

// Broadcast an upcoming event notification to all users
// ---------- Shared feeds ----------
// Devices pull these to see everyone's questions/posts (the write paths above
// persist full content; these endpoints hand it back out).

app.get('/api/qa/feed', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const items = await storage.listQAPosts(limit);
    res.json({ success: true, items });
  } catch (error) {
    console.error('[qa-feed] failed:', error.message);
    res.status(500).json({ success: false, error: 'Feed unavailable' });
  }
});

app.get('/api/community/feed', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    // Live profile join: refresh authorName/authorAvatar from users collection
    // so profile picture updates propagate to all historic posts.
    const items = await storage.getCommunityFeedWithProfileJoin(limit);
    res.json({ success: true, items, count: items.length });
  } catch (error) {
    console.error('[community-feed] failed:', error.message);
    res.status(500).json({ success: false, error: 'Feed unavailable' });
  }
});

// ---------- Moderation: user reports ----------
// Play requires a working in-app reporting path for UGC. Reports land in the
// `reports` collection (status:'open') for manual review.
app.post('/api/reports', requireVerifiedUser, async (req, res) => {
  const { contentType, contentId, reason } = req.body;
  const reporterId = req.verifiedUserId;
  const validTypes = ['question', 'answer', 'post', 'comment'];
  if (!contentType || !validTypes.includes(contentType) || !contentId || !reporterId) {
    return res.status(400).json({
      error: `contentType (${validTypes.join('|')}), contentId and reporterId are required`,
    });
  }

  await storage.addReport({
    contentType,
    contentId: String(contentId),
    reporterId,
    reason: typeof reason === 'string' ? reason.slice(0, 500) : '',
  });
  console.log(`Report filed: ${contentType}/${contentId} by ${reporterId}`);
  res.json({ success: true });
});

app.post('/api/events/notify', async (req, res) => {
  const { title, body } = req.body;
  if (!title || !body) {
    return res.status(400).json({ error: 'title and body are required' });
  }

  await broadcastPush(title, body, { type: 'upcoming_event' });
  res.json({ success: true });
});

// AI: Find the best answer for a community question
// Answers come from the search + Groq LLM pipeline:
//   1. Serper.dev (SERPER_API_KEY) for real, citable Google web results.
//   2. Groq (GROQ_API_KEY + GROQ_MODEL) to synthesize a concise,
//      well-sourced answer from those results.
// When no GROQ_API_KEY is set, falls back to a plain snippet summary.
//
// Overall ceiling for the whole pipeline call. The per-call Groq timeout
// (GROQ_TIMEOUT_MS, 15s) is already short; this is a safety net so the route
// never hangs forever and the app can show its "could not answer" message fast.
const AI_ANSWER_CEILING_MS = Number(process.env.AI_ANSWER_TIMEOUT_MS || 20000);

app.post('/api/ai/answer', async (req, res) => {
  const { question, language } = req.body;
  if (
    !question ||
    typeof question !== 'string' ||
    question.trim().length < 3
  ) {
    return res.status(400).json({ error: 'question is required' });
  }
  // Cap the payload the AI providers see (cost + abuse protection).
  const safeQuestion = question.trim().slice(0, 1000);

  try {
    const result = await Promise.race([
      getAIAnswer(safeQuestion, language === 'en' ? 'en' : 'tr'),
      new Promise((resolve) => setTimeout(() => resolve(null), AI_ANSWER_CEILING_MS)),
    ]);

    if (!result) {
      console.error('[ai/answer] timed out after', AI_ANSWER_CEILING_MS, 'ms');
      return res.status(504).json({ success: false, error: 'AI answer timed out' });
    }

    // `sources` is present when the answer came from the web-search fallback
    // (Serper.dev / DuckDuckGo / Wikipedia) so the app can
    // render the referenced links under the answer.
    res.json({
      success: true,
      answer: result.answer,
      provider: result.provider,
      ...(result.model ? { model: result.model } : {}),
      ...(Array.isArray(result.sources) && result.sources.length > 0
        ? { sources: result.sources }
        : {}),
    });
  } catch (error) {
    console.error('AI answer error:', error.message);
    res.status(500).json({ error: 'Failed to generate answer' });
  }
});

// ---------- Account Deletion ----------
// DELETE /api/users/:email - Permanently delete a user account and all associated data
// Requires verified Firebase ID token
app.delete('/api/users/:email', requireVerifiedUser, async (req, res) => {
  const { email } = req.params;
  const userId = req.verifiedUserId;
  
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }
  
  try {
    // Verify the user is deleting their own account
    const userData = await storage.getUser(userId);
    if (!userData || userData.email !== email.toLowerCase()) {
      return res.status(403).json({ error: 'You can only delete your own account' });
    }
    
    // Delete all user's Q&A posts
    const qaPosts = await storage.listQAPosts(1000);
    for (const post of qaPosts) {
      if (post.ownerUserId === userId) {
        await storage.deleteQAPost(post.id, userId);
      }
    }
    
    // Delete all user's community posts and comments
    const communityPosts = await storage.listCommunityPosts(1000);
    for (const post of communityPosts) {
      if (post.ownerUserId === userId) {
        await storage.deleteCommunityPost(post.id, userId);
      }
    }
    
    // Remove device registrations
    await storage.removeDevice(userId);
    
    // Delete user account
    await storage.deleteUser(userId);
    
    console.log(`Account deleted: ${email} (${userId})`);
    res.json({ success: true, message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Account deletion error:', error.message);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

// AI: Search-augmented chat with Groq synthesis + quota-resilient fallback
// Uses Serper.dev (Google organic results; free tier: 2,500 credits/month) to
// retrieve real web results, then synthesizes them via Groq (Qwen/Llama family)
// into a concise, well-sourced answer.
//
// Quota resilience: when search is unavailable (Serper quota exhausted, no
// SERPER_API_KEY, or zero results) the query is sent DIRECTLY to Groq without
// search context — never a 500.
// When no GROQ_API_KEY is configured, falls back to a plain-text snippet
// summary (or a "no relevant sources" message).
//
// Env vars required for full pipeline:
//   SERPER_API_KEY                              (Serper.dev Google search)
//   GROQ_API_KEY + (optional) GROQ_MODEL       (Groq synthesis)
//   LLM_TIMEOUT_MS                              (optional, default 15000)
//
// The in-memory quota counter resets on server restart. For multi-instance
// deploys, replace with a shared store (Redis/Firestore).
//
app.post('/api/ai/chat', async (req, res) => {
  const { question, language } = req.body;
  if (
    !question ||
    typeof question !== 'string' ||
    question.trim().length < 3
  ) {
    return res.status(400).json({ error: 'question is required' });
  }
  const safeQuestion = question.trim().slice(0, 1000);

  try {
    const { handleSearchAugmentedChat } = await import('./services/chatPipeline.js');
    const result = await Promise.race([
      handleSearchAugmentedChat(safeQuestion, language === 'en' ? 'en' : 'tr'),
      new Promise((resolve) => setTimeout(() => resolve(null), AI_ANSWER_CEILING_MS)),
    ]);

    if (!result) {
      console.error('[ai/chat] timed out after', AI_ANSWER_CEILING_MS, 'ms');
      return res.status(504).json({ success: false, error: 'AI chat timed out' });
    }

    res.json({
      success: true,
      answer: result.reply,
      provider: result.provider,
      sources: result.sources,
    });
  } catch (error) {
    console.error('AI chat error:', error.message);
    res.status(500).json({ error: 'Failed to generate chat answer' });
  }
});

// ---------------------------------------------------------------------------
// AI: Web-search answer (no LLM required) — legacy endpoint
// Returns sourced answers from Serper.dev (Google results) / DuckDuckGo /
// Wikipedia. Kept for backward compat; prefer /api/ai/chat for the new
// search + LLM synthesis pipeline.
// ---------------------------------------------------------------------------
app.post('/api/ai/search', async (req, res) => {
  const { question, language } = req.body;
  if (
    !question ||
    typeof question !== 'string' ||
    question.trim().length < 3
  ) {
    return res.status(400).json({ error: 'question is required' });
  }
  const safeQuestion = question.trim().slice(0, 1000);

  try {
    const { getSearchAnswer } = require('./search-answer');
    const result = await getSearchAnswer(safeQuestion, language === 'en' ? 'en' : 'tr');
    if (!result) {
      return res.json({ success: false, error: 'No search results found' });
    }
    res.json({
      success: true,
      answer: result.answer,
      provider: result.provider,
      sources: result.sources,
    });
  } catch (error) {
    console.error('Search answer error:', error.message);
    res.status(500).json({ error: 'Failed to get search answer' });
  }
});

// Health check
app.get('/api/health', async (req, res) => {
  try {
    const counts = await storage.counts();
    res.json({
      status: 'ok',
      storage: storage.isFirestoreEnabled() ? 'firestore' : 'memory',
      deviceCount: counts.devices,
      postCount: counts.posts,
      communityPostCount: counts.communityPosts,
    });
  } catch (error) {
    console.error('Health check error:', error.message);
    res.json({
      status: 'ok',
      storage: storage.isFirestoreEnabled() ? 'firestore' : 'memory',
    });
  }
});

// News & Events: collected live from reliable Turkish Muslim website feeds.
// Returns items shaped for the app's News tab: [{ title, meta, accent, place, isPast, href, source }]
app.get('/api/news', async (req, res) => {
  try {
    const language = req.query.lang === 'en' ? 'en' : 'tr';
    // Note: collectNews() takes no arguments today (returns the combined
    // feed); the query parameter stays reserved for future filtering.
    const items = await collectNews();
    res.json({ success: true, items, count: items.length });
  } catch (error) {
    console.error('News endpoint error:', error.message);
    res.status(500).json({ error: 'Failed to collect news' });
  }
});

// Scholar videos: latest uploads from verified Islamic scholar YouTube
// channels (free public RSS feeds -- no API key). Tapping an item in the
// app opens the video on YouTube; each item also carries a channelHref so
// users can jump straight to the scholar's channel.
app.get('/api/youtube/videos', async (req, res) => {
  try {
    const language = req.query.lang === 'en' ? 'en' : 'tr';
    const items = await collectScholarVideos(language);
    res.json({ success: true, items, count: items.length });
  } catch (error) {
    console.error('Scholar videos endpoint error:', error.message);
    res.status(500).json({ error: 'Failed to load scholar videos' });
  }
});
// ---------- Public website (privacy policy & landing page) ----------
// The app's Privacy Policy URL points to: https://learningislamapp.com/privacy
// We serve the static site from the /website folder and map /privacy to the
// privacy-policy page so the app-store required link works.

app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'website', 'privacy-policy.html'));
});

app.get('/privacy-policy', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'website', 'privacy-policy.html'));
});

// Serve all other static website files (index.html, styles.css, sitemap.xml, robots.txt...)
app.use(express.static(path.join(__dirname, '..', 'website')));

// Redirect /privacy-policy.html alias handled above; else serve the landing page at root.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'website', 'index.html'));
});

// ---------- Terminal error handler ----------
// Receives everything forwarded by crashProof() (plus body-parser errors).
// Logs a short trace and answers JSON; respects parser statuses (400 etc.).
app.use((err, req, res, _next) => {
  const brief =
    err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n') : String(err);
  console.error('[error]', brief);
  if (!res.headersSent) {
    res.status(err.status || err.statusCode || 500).json({
      error: err.status === 400 ? 'Bad request' : 'Internal server error',
    });
  }
});

// ---------- 404 handler ----------
// Catch-all for undefined routes - must be after all other routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

const PORT = process.env.PORT || 3000;
storage.initStorage().then(() => {
  // Fail loudly (but stay up) if pushes can never be delivered.
  const token = process.env.EXPO_ACCESS_TOKEN || '';
  if (!token || token.includes('your-expo-access-token') || token.startsWith('PASTE_')) {
    console.warn(
      '[push] ⚠️  EXPO_ACCESS_TOKEN is missing or placeholder — ' +
        'push notifications will NOT reach devices. Paste your token into server/.env'
    );
  }

  app.listen(PORT, () => {
    console.log(`İslam nasıl öğrenilir push server running on port ${PORT}`);
    console.log(`Storage backend: ${storage.isFirestoreEnabled() ? 'Firestore ✅' : 'in-memory ⚠️'}`);
  });
});

