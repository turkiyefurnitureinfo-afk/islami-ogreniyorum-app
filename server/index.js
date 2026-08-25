require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const { Expo } = require('expo-server-sdk');
const { getAIAnswer } = require('./ai-answer');
const { collectNews, collectScholarVideos } = require('./news-collector');
const { getPrayerTimes } = require('./prayer-times');

const app = express();
app.use(cors());
app.use(express.json());

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
        typeof h === 'function' && h.length <= 3 ? crashProof(h) : h
      )
    );
}

// Last-resort process guards: log loudly but never exit mid-flight.
process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaughtException:', (err && err.stack) || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandledRejection:', (reason && reason.stack) || reason);
});

// Initialize Expo push notification client
// Set EXPO_ACCESS_TOKEN in your .env file (get it from https://expo.dev/settings/access-tokens)
const expo = new Expo({
  accessToken: process.env.EXPO_ACCESS_TOKEN,
});

// Persistent data layer: Firestore when a service-account key is present,
// automatic in-memory fallback otherwise. See ./storage.js for the schema.
const storage = require('./storage');

// Helper: send push notification to a specific user
async function sendPushToUser(userId, title, body, data = {}) {
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
async function broadcastPush(title, body, data = {}) {
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

// ---------- Routes ----------

// Register a device token for a user
app.post('/api/register', async (req, res) => {
  const { userId, expoPushToken, name } = req.body;
  if (!userId || !expoPushToken) {
    return res.status(400).json({ error: 'userId and expoPushToken are required' });
  }

  await storage.setDevice(userId, { expoPushToken, name: name || 'User' });
  console.log(`Registered device for ${userId} (${name || 'User'})`);
  res.json({ success: true });
});

// Unregister a device
app.post('/api/unregister', (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  storage.removeDevice(userId);
  console.log(`Unregistered device for ${userId}`);
  res.json({ success: true });
});

// Post a new question -> notify all other users
app.post('/api/posts', async (req, res) => {
  const { userId, question, name } = req.body;
  if (!userId || !question) {
    return res.status(400).json({ error: 'userId and question are required' });
  }

  const postId = await storage.createQAPost(userId, question, name || null);

  const author = await storage.getDevice(userId);
  const authorName = author?.name || 'A user';

  // Notify all OTHER users about the new question
  const allDevices = await storage.getAllDevices();
  for (const device of allDevices) {
    if (device.userId !== userId) {
      await sendPushToUser(
        device.userId,
        'New Question',
        `${authorName} asked: "${question.slice(0, 60)}${question.length > 60 ? '...' : ''}"`,
        { type: 'new_question', postId }
      );
    }
  }

  res.json({ success: true, postId });
});

// Add a contribution/comment -> notify the question author
app.post('/api/posts/:postId/contributions', async (req, res) => {
  const { postId } = req.params;
  const { userId, text, name } = req.body;
  if (!userId || !text) {
    return res.status(400).json({ error: 'userId and text are required' });
  }

  const post = await storage.getQAPost(postId);
  if (!post) {
    return res.status(404).json({ error: 'Post not found' });
  }

  const contribId = await storage.addQAContribution(postId, userId, text, name || null);

  // Notify the question author (if not the same user)
  if (post.ownerUserId !== userId) {
    const commenter = await storage.getDevice(userId);
    const commenterName = commenter?.name || 'A user';
    await sendPushToUser(
      post.ownerUserId,
      'New Comment',
      `${commenterName} commented: "${text.slice(0, 60)}${text.length > 60 ? '...' : ''}"`,
      { type: 'new_comment', postId, contributionId: contribId }
    );
  }

  res.json({ success: true, contributionId: contribId });
});

// Like a contribution -> notify the contribution author
app.post('/api/posts/:postId/contributions/:contribId/like', async (req, res) => {
  const { postId, contribId } = req.params;
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  const result = await storage.likeQAContribution(postId, contribId);
  if (!result) {
    return res.status(404).json({ error: 'Contribution not found' });
  }

  // Notify the contribution author (if not the same user)
  if (result.userId !== userId) {
    const liker = await storage.getDevice(userId);
    const likerName = liker?.name || 'A user';
    await sendPushToUser(
      result.userId,
      'New Like',
      `${likerName} liked your comment`,
      { type: 'new_like', postId, contributionId: contribId }
    );
  }

  res.json({ success: true, likes: result.likes });
});

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

// Register a community post (called by the author's device after creating it).
// Stores the full content so every device can fetch the shared feed.
app.post('/api/community/posts', async (req, res) => {
  const { postId, userId, text, name, mediaType, mediaUri } = req.body;
  if (!postId || !userId) {
    return res.status(400).json({ error: 'postId and userId are required' });
  }

  await storage.registerCommunityPost(postId, userId, {
    text: typeof text === 'string' ? text : '',
    authorName: name || null,
    mediaType: mediaType || null,
    mediaUri: mediaUri || null,
  });
  console.log(`Community post ${postId} registered for ${userId}`);
  res.json({ success: true });
});

// Comment on a community post -> notify the post author
app.post('/api/community/posts/:postId/comments', async (req, res) => {
  const { postId } = req.params;
  const { commentId, userId, text, name } = req.body;
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
  });

  // Notify the post owner (if the commenter isn't the owner)
  if (post.ownerUserId !== userId) {
    const commenter = await storage.getDevice(userId);
    const commenterName = commenter?.name || name || 'A user';
    await sendPushToUser(
      post.ownerUserId,
      'New Comment',
      `${commenterName} commented on your post: "${text.slice(0, 60)}${text.length > 60 ? '...' : ''}"`,
      { type: 'community_comment', postId, commentId }
    );
  }

  res.json({ success: true });
});

// Like a community post -> notify the post author
app.post('/api/community/posts/:postId/like', async (req, res) => {
  const { postId } = req.params;
  const { userId, name } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  const post = await storage.getCommunityPost(postId);
  if (!post) {
    return res.status(404).json({ error: 'Post not found' });
  }

  if (post.ownerUserId !== userId) {
    const liker = await storage.getDevice(userId);
    const likerName = liker?.name || name || 'A user';
    await sendPushToUser(
      post.ownerUserId,
      'New Like',
      `${likerName} liked your post`,
      { type: 'community_post_like', postId }
    );
  }

  res.json({ success: true });
});

// Like a comment on a community post -> notify the comment's author
app.post('/api/community/posts/:postId/comments/:commentId/like', async (req, res) => {
  const { postId, commentId } = req.params;
  const { userId, name } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  const comment = await storage.getCommunityComment(postId, commentId);
  if (!comment) {
    return res.status(404).json({ error: 'Comment not found' });
  }

  if (comment.userId !== userId) {
    const liker = await storage.getDevice(userId);
    const likerName = liker?.name || name || 'A user';
    await sendPushToUser(
      comment.userId,
      'New Like',
      `${likerName} liked your comment`,
      { type: 'community_comment_like', postId, commentId }
    );
  }

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
    const items = await storage.listCommunityPosts(limit);
    res.json({ success: true, items });
  } catch (error) {
    console.error('[community-feed] failed:', error.message);
    res.status(500).json({ success: false, error: 'Feed unavailable' });
  }
});

// ---------- Moderation: user reports ----------
// Play requires a working in-app reporting path for UGC. Reports land in the
// `reports` collection (status:'open') for manual review.
app.post('/api/reports', async (req, res) => {
  const { contentType, contentId, reporterId, reason } = req.body;
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
// Answers come from Google Programmable Search Engine (real sourced results),
// with a built-in engine as an offline fallback. Set GOOGLE_API_KEY + GOOGLE_CX.
app.post('/api/ai/answer', async (req, res) => {
  const { question, language } = req.body;
  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'question is required' });
  }

  try {
    const { answer, provider } = await getAIAnswer(question, language === 'en' ? 'en' : 'tr');
    res.json({ success: true, answer, provider });
  } catch (error) {
    console.error('AI answer error:', error);
    res.status(500).json({ error: 'Failed to generate answer' });
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
    const items = await collectNews(language);
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