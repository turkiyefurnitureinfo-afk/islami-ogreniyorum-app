import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { API_URL } from './config.js';

// Configure how notifications are presented while the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    // SDK 53: shouldShowAlert is the legacy flag kept for compatibility;
    // banner/list flags are the modern equivalents with identical meaning.
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// ---------------------------------------------------------------------------
// Sound modes
//
// The Settings tab offers three meaningful choices (legacy decorative names
// like 'Çan' / 'Bell' still work -- they behave like System Default):
//
//   'Yüksek Alarm (30 dk)' / 'High Alarm (up to 30 min)'
//       -> loud bundled chime on a dedicated alarm channel, and the
//          notification RE-RINGS every 5 minutes until the user taps it
//          (which cancels the rest of the chain) or 30 minutes pass.
//   'Sistem Varsayılanı' / 'System Default' (+ legacy names)
//       -> standard single system notification sound.
//   'Sessiz' / 'Silent'
//       -> silent notification.
// ---------------------------------------------------------------------------

// Bundled loud chime (generated WAV in android/app/src/main/res/raw/)
export const HIGH_ALARM_SOUND = 'notification_high.wav';

const ALARM_CHANNEL_ID = 'prayer-alarm';
const DEFAULT_CHANNEL_ID = 'prayer-times';
const REMINDER_INTERVAL_MIN = 5;   // re-ring cadence inside the alarm window
const RING_WINDOW_MIN = 30;        // hard cap requested: stop after 30 minutes
const ALARM_DAYS = 7;              // how many days ahead to pre-schedule chains

function resolveSoundMode(soundOption) {
  const s = String(soundOption || '');
  if (s === 'Sessiz' || s === 'Silent') return 'silent';
  if (/yüksek alarm|high alarm/i.test(s)) return 'alarm';
  return 'default';
}

// ---------------------------------------------------------------------------
// Verified-identity helper for backend writes.
//
// When the user is signed in via native Firebase Auth, we attach a fresh ID
// token in the Authorization header so the server can cryptographically verify
// ownership (see server/verify.js). If the module is unavailable (Expo Go,
// unsigned build, no native config) we simply omit the header and the server
// falls back to trusting the client-supplied userId — exactly the previous
// behaviour, so nothing breaks for guests/legacy builds.
// ---------------------------------------------------------------------------
let authModule = null; // lazily required to avoid importing Firebase at load time
function getAuthModule() {
  if (authModule !== null) return authModule;
  try {
    authModule = require('./firebaseAuth.js');
  } catch (_e) {
    authModule = false;
  }
  return authModule;
}

async function currentIdToken() {
  const fb = getAuthModule();
  if (!fb) return null;
  try {
    const user = fb.getCurrentFirebaseUser();
    if (user && typeof user.getIdToken === 'function') {
      // getIdToken(true) forces a fresh token; fall back to cached if needed.
      return await user.getIdToken(true);
    }
  } catch (_e) {
    // Token retrieval failed (e.g. offline) — proceed without it.
  }
  return null;
}

/**
 * Build an Authorization header for the currently signed-in user, or {} when no
 * verified identity token is available.
 * @returns {Promise<Record<string,string>>}
 */
export async function authHeaders() {
  const token = await currentIdToken();
  return token ? { Authorization: 'Bearer ' + token } : {};
}

/**
 * Request notification permissions from the user.
 * @returns {Promise<boolean>} true if permission was granted
 */
export async function requestNotificationPermissions() {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

/**
 * Cancel all previously scheduled prayer notifications.
 */
export async function cancelAllPrayerNotifications() {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/**
 * Send an immediate notification (for community activity like new questions,
 * comments, likes, etc.).
 *
 * @param {string} title - notification title
 * @param {string} body - notification body text
  * @param {string|null} sound - optional sound name (null = use channel default, undefined = silent)
 */
export async function sendImmediateNotification(title, body, sound = null) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound,
    },
    trigger: null,
  });
}

/**
 * Schedule daily recurring notifications for each of the 5 daily prayers.
 * Notifications repeat every day at the computed prayer times.
 *
 * @param {object} params
 * @param {object} params.times - prayer times in minutes since local midnight
 * @param {string} params.language - 'tr' or 'en'
 * @param {string} params.sound - selected sound option string
 * @param {object} params.t - translations object for the current language
 */
export async function schedulePrayerNotifications({ times, language, sound, t }) {
  // Cancel any existing scheduled notifications first
  await cancelAllPrayerNotifications();

  const prayers = [
    { key: 'fajr', label: t.fajr },
    { key: 'dhuhr', label: t.dhuhr },
    { key: 'asr', label: t.asr },
    { key: 'maghrib', label: t.maghrib },
    { key: 'isha', label: t.isha },
  ];

  const mode = resolveSoundMode(sound);
  const title = language === 'tr' ? 'Namaz Vakti' : 'Prayer Time';
  const reminderSuffix =
    language === 'tr' ? ' — hatırlatma ⏰' : ' — reminder ⏰';

  const buildContent = (body, chainId) => ({
    title,
    body,
    // Don't set `sound` here — let the channel decide. Setting it explicitly
    // (e.g. 'default') would override the channel's configured HIGH_ALARM_SOUND
    // and break the high-alarm / system-sound modes. null = silent mode only.
    sound: mode === 'silent' ? null : undefined,
    // NOTE: expo-notifications content object uses `channelId` (not `_channelId`).
    // The underscore form is silently ignored, which previously routed alarm
    // notifications to the default channel — so the loud chime never played.
    channelId:
      mode === 'alarm'
        ? ALARM_CHANNEL_ID
        : DEFAULT_CHANNEL_ID,
    // Shows the "⏹ Kapat / Stop" action button on the notification itself
    ...(mode === 'alarm' ? { categoryIdentifier: 'prayer_alarm' } : {}),
    data: chainId ? { chainId } : undefined,
  });

  // --- ALARM MODE: concrete chains for the next days -----------------------
  // Each prayer gets an independent ring sequence: rings at prayer time,
  // then again every REMINDER_INTERVAL_MIN minutes until RING_WINDOW_MIN
  // (hard cap 30 min). When the user dismisses the alarm (tap or the
  // ⏹ Kapat / Stop button), the remaining rings OF THAT PRAYER are cancelled
  // -- silence until the next prayer time. Other prayers are never affected.
  if (mode === 'alarm') {
    const now = new Date();
    let scheduled = 0;

    for (const prayer of prayers) {
      const minutes = times[prayer.key];
      const hour = Math.floor(minutes / 60);
      const minute = Math.floor(minutes % 60);

      for (let dayOffset = 0; dayOffset < ALARM_DAYS; dayOffset++) {
        const fire = new Date(now);
        fire.setDate(fire.getDate() + dayOffset);
        fire.setHours(hour, minute, 0, 0);
        if (fire.getTime() <= now.getTime()) continue; // already passed today

        const body =
          language === 'tr'
            ? `${prayer.label} namazı vakti geldi`
            : `It's time for ${prayer.label} prayer`;
        const chainId = `${prayer.key}-${fire.getTime()}`;

        // Initial ring at prayer time
        await Notifications.scheduleNotificationAsync({
          content: buildContent(body, chainId),
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fire },
        });
        scheduled++;

        // Follow-up rings (user tap cancels these; hard cap at 30 min)
        const reminderCount = Math.floor(RING_WINDOW_MIN / REMINDER_INTERVAL_MIN);
        for (let r = 1; r <= reminderCount; r++) {
          const at = new Date(fire.getTime() + r * REMINDER_INTERVAL_MIN * 60000);
          await Notifications.scheduleNotificationAsync({
            content: {
              ...buildContent(body + reminderSuffix, chainId),
              title,
            },
            trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
          });
          scheduled++;
        }
      }
    }
    return scheduled;
  }

  // --- DEFAULT / SILENT MODE: simple daily repeats (previous behavior) -----
  for (const prayer of prayers) {
    const minutes = times[prayer.key];
    const hour = Math.floor(minutes / 60);
    const minute = Math.floor(minutes % 60);

    const body =
      language === 'tr'
        ? `${prayer.label} namazı vakti geldi`
        : `It's time for ${prayer.label} prayer`;

    await Notifications.scheduleNotificationAsync({
      content: buildContent(body, null),
      // SDK 53 (expo-notifications 0.31.x) requires the explicit typed form;
      // the legacy bare {hour, minute, repeats} shape is silently ignored on
      // Android (it parses as a channel-only trigger instead of a daily one).
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute,
      },
    });
  }
  return prayers.length;
}

/**
 * Cancel every pending follow-up ring in an alarm chain. Called when the
 * user taps any notification from that chain ("off by the user").
 * @param {string} chainId - e.g. 'fajr-1735689600000'
 */
export async function cancelPrayerChain(chainId) {
  if (!chainId) return;
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    let cancelled = 0;
    for (const n of scheduled) {
      if (n?.content?.data?.chainId === chainId) {
        await Notifications.cancelScheduledNotificationAsync(n.identifier);
        cancelled++;
      }
    }
    if (cancelled > 0) {
      console.log(`Cancelled ${cancelled} remaining ring(s) for chain ${chainId}`);
    }
  } catch (error) {
    console.error('Failed to cancel prayer chain:', error);
  }
}

/**
 * Handler for stopping a ringing prayer alarm.
 *
 * BEHAVIOR (as specified): when the user dismisses the alarm -- by TAPPING
 * the notification or pressing its "⏹ Kapat / Stop" button -- every pending
 * follow-up ring FOR THAT PRAYER is cancelled. The alarm stays completely
 * silent until the NEXT prayer time. Other prayers are never affected.
 *
 * Note: swipe-to-dismiss cannot be detected on expo-notifications 0.28.x
 * (SDK 51) -- no dismissed-event API exists yet. On this version a swipe
 * only clears the visible notification, so use tap or the ⏹ button for a
 * guaranteed full stop. Future SDK upgrades enable swipe automatically via
 * a feature-detected listener if desired.
 *
 * Returns the subscription; call .remove() on cleanup.
 */
export function registerPrayerAlarmCancellationHandler() {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const chainId =
      /** @type {string|null} */ (
        response?.notification?.request?.content?.data?.chainId || null
      );

    // Any interaction with the alarm (plain tap OR the stop button) ends
    // this prayer's ringing session. Next prayer's alarm is untouched.
    if (chainId) {
      cancelPrayerChain(chainId);
    }
  });
}

/**
 * Android requires a notification channel for local notifications.
 * This should be called once at app startup.
 */
export async function setupNotificationChannel() {
  if (Platform.OS === 'android') {
    // Standard channel for System Default / Silent selections
    await Notifications.setNotificationChannelAsync(DEFAULT_CHANNEL_ID, {
      name: 'Namaz Vakitleri',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#d8b56a',
    });
    // Loud alarm channel used by "Yüksek Alarm / High Alarm" -- plays the
    // bundled chime with a strong vibration pattern so it clearly stands out.
    await Notifications.setNotificationChannelAsync(ALARM_CHANNEL_ID, {
      name: 'Namaz Alarmları (yüksek ses)',
      description:
        'Prayer time alarm: rings loudly and re-rings until turned off or 30 minutes pass.',
      importance: Notifications.AndroidImportance.HIGH,
      sound: HIGH_ALARM_SOUND,
      vibrationPattern: [0, 500, 250, 500, 250, 500],
      lightColor: '#d8b56a',
      enableVibrate: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });

    // Action button shown ON every alarm notification: one-tap "stop".
    try {
      await Notifications.setNotificationCategoryAsync('prayer_alarm', [
        {
          identifier: 'turn-off',
          buttonTitle: '⏹ Kapat / Stop',
          options: { opensAppToForeground: true },
        },
      ]);
    } catch (error) {
      console.warn('Could not register prayer_alarm category:', error.message);
    }
  }
}

/**
 * Get the Expo push token for this device.
 * @returns {Promise<string|null>} the push token or null if unavailable
 */
export async function getExpoPushToken() {
  try {
    const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
    if (!projectId) {
      console.log('No EAS projectId configured - skipping push token registration');
      return null;
    }
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    return token?.data || null;
  } catch (error) {
    console.error('Failed to get Expo push token:', error);
    return null;
  }
}

/**
 * Register this device with the push notification backend.
 * @param {string} userId - the user's unique ID (email or account ID)
 * @param {string} name - the user's display name
 */
export async function registerDeviceWithBackend(userId, name) {
  const expoPushToken = await getExpoPushToken();
  if (!expoPushToken) {
    console.log('No Expo push token available - skipping backend registration');
    return false;
  }
  try {
    const headers = {
      'Content-Type': 'application/json',
      ...(await authHeaders()),
    };
    const response = await fetch(`${API_URL}/api/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ userId, expoPushToken, name }),
    });
    return response.ok;
  } catch (error) {
    console.error('Failed to register device with backend:', error);
    return false;
  }
}

/**
 * Unregister this device from the push notification backend.
 * @param {string} userId - the user's unique ID
 */
export async function unregisterDeviceFromBackend(userId) {
  try {
    const headers = {
      'Content-Type': 'application/json',
      ...(await authHeaders()),
    };
    const response = await fetch(`${API_URL}/api/unregister`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ userId }),
    });
    return response.ok;
  } catch (error) {
    console.error('Failed to unregister device from backend:', error);
    return false;
  }
}

/**
 * Notify the backend that a new question was posted.
 * @param {string} userId - the author's user ID
 * @param {string} question - the question text
 */
export async function notifyBackendNewQuestion(userId, question, name, avatar) {
  try {
    const headers = {
      'Content-Type': 'application/json',
      ...(await authHeaders()),
    };
    const response = await fetch(`${API_URL}/api/posts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ userId, question, name, avatar: avatar || null }),
    });
    if (!response.ok) return { ok: false, postId: null };
    const data = await response.json().catch(() => ({}));
    // The server assigns its own canonical post ID — the caller stores it so
    // later answers/likes can be routed back to this thread.
    return { ok: true, postId: data.postId ?? null };
  } catch (error) {
    console.error('Failed to notify backend of new question:', error);
    return { ok: false, postId: null };
  }
}

/**
 * Notify the backend that a new contribution/comment was added.
 * @param {number} postId - the post ID
 * @param {string} userId - the commenter's user ID
 * @param {string} text - the comment text
 */
export async function notifyBackendNewContribution(postId, userId, text, name, avatar) {
  try {
    const headers = {
      'Content-Type': 'application/json',
      ...(await authHeaders()),
    };
    const response = await fetch(`${API_URL}/api/posts/${postId}/contributions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ userId, text, name, avatar: avatar || null }),
    });
    if (!response.ok) return { ok: false, contributionId: null };
    const data = await response.json().catch(() => ({}));
    return { ok: true, contributionId: data.contributionId ?? null };
  } catch (error) {
    console.error('Failed to notify backend of new contribution:', error);
    return { ok: false, contributionId: null };
  }
}

/**
 * Notify the backend that a contribution was liked.
 * @param {number} postId - the post ID
 * @param {number} contribId - the contribution ID
 * @param {string} userId - the liker's user ID
 */
export async function notifyBackendLike(postId, contribId, userId) {
  try {
    const headers = {
      'Content-Type': 'application/json',
      ...(await authHeaders()),
    };
    const response = await fetch(`${API_URL}/api/posts/${postId}/contributions/${contribId}/like`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ userId }),
    });
    return response.ok;
  } catch (error) {
    console.error('Failed to notify backend of like:', error);
    return false;
  }
}

/**
 * Notify the backend to broadcast an upcoming event to all users.
 * @param {string} title - event notification title
 * @param {string} body - event notification body
 */
export async function notifyBackendEvent(title, body) {
  try {
    const response = await fetch(`${API_URL}/api/events/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body }),
    });
    return response.ok;
  } catch (error) {
    console.error('Failed to notify backend of event:', error);
    return false;
  }
}

/**
 * Schedule a one-time notification for an upcoming event.
 * Fires at 9:00 AM on the event day (or immediately if the event is today).
 *
 * @param {object} params
 * @param {string} params.title - notification title
 * @param {string} params.body - notification body text
 * @param {Date} params.eventDate - when the event occurs
 * @param {string|null} params.sound - optional sound name
 */
export async function scheduleEventNotification({ title, body, eventDate, sound = null }) {
  const now = new Date();

  // Fire the notification at 9:00 AM on the event day
  const fireTime = new Date(eventDate);
  fireTime.setHours(9, 0, 0, 0);

  // If the event is in the past, don't schedule it
  if (fireTime.getTime() <= now.getTime()) {
    return;
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound,
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireTime },
  });
}

/**
 * Register a newly created community post with the backend so that later
 * comments/likes from other users can be routed back to this post's author.
 *
 * @param {number} postId - the app's local post ID
 * @param {string} userId - the author's user ID (email)
 * @param {string} name - the author's display name
 */
export async function notifyBackendCommunityPost(postId, userId, name, text, mediaType, mediaUri, avatar) {
  try {
    const headers = {
      'Content-Type': 'application/json',
      ...(await authHeaders()),
    };
    const response = await fetch(`${API_URL}/api/community/posts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ postId, userId, name, text, mediaType, mediaUri, avatar: avatar || null }),
    });
    return response.ok;
  } catch (error) {
    console.error('Failed to register community post with backend:', error);
    return false;
  }
}

/**
 * File a moderation report for a piece of user-generated content.
 *
 * @param {object} p
 * @param {'question'|'answer'|'post'|'comment'} p.contentType
 * @param {string|number} p.contentId - server id when known, else local id
 * @param {string} p.reporterId - the reporting user's email/id
 * @param {string} [p.reason] - optional free-text reason
 * @returns {Promise<boolean>}
 */
export async function sendContentReport({ contentType, contentId, reporterId, reason }) {
  try {
    const headers = {
      'Content-Type': 'application/json',
      ...(await authHeaders()),
    };
    const response = await fetch(`${API_URL}/api/reports`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ contentType, contentId, reporterId, reason }),
    });
    return response.ok;
  } catch (error) {
    console.error('Failed to send content report:', error);
    return false;
  }
}

/**
 * Notify a community post's author that someone commented on their post.
 *
 * @param {number} postId - the post's local ID
 * @param {number} commentId - the new comment's local ID
 * @param {string} userId - the commenter's user ID (email)
 * @param {string} text - the comment text
 * @param {string} name - the commenter's display name
 */
export async function notifyBackendCommunityComment(postId, commentId, userId, text, name, avatar) {
  try {
    const headers = {
      'Content-Type': 'application/json',
      ...(await authHeaders()),
    };
    const response = await fetch(`${API_URL}/api/community/posts/${postId}/comments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ commentId, userId, text, name, avatar: avatar || null }),
    });
    return response.ok;
  } catch (error) {
    console.error('Failed to notify backend of community comment:', error);
    return false;
  }
}

/**
 * Notify a community post's author that someone liked their post.
 *
 * @param {number} postId - the post's local ID
 * @param {string} userId - the liker's user ID (email)
 * @param {string} name - the liker's display name
 */
export async function notifyBackendCommunityPostLike(postId, userId, name) {
  try {
    const headers = {
      'Content-Type': 'application/json',
      ...(await authHeaders()),
    };
    const response = await fetch(`${API_URL}/api/community/posts/${postId}/like`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ userId, name }),
    });
    return response.ok;
  } catch (error) {
    console.error('Failed to notify backend of community post like:', error);
    return false;
  }
}

/**
 * Notify a community comment's author that someone liked their comment.
 *
 * @param {number} postId - the post's local ID
 * @param {number} commentId - the comment's local ID
 * @param {string} userId - the liker's user ID (email)
 * @param {string} name - the liker's display name
 */
export async function notifyBackendCommunityCommentLike(postId, commentId, userId, name) {
  try {
    const headers = {
      'Content-Type': 'application/json',
      ...(await authHeaders()),
    };
    const response = await fetch(`${API_URL}/api/community/posts/${postId}/comments/${commentId}/like`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ userId, name }),
    });
    return response.ok;
  } catch (error) {
    console.error('Failed to notify backend of community comment like:', error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Server-side deletion helpers.
//
// Deleting content used to ONLY hide it locally (tombstone). These calls ask
// the backend to permanently remove the item from the shared feed so it truly
// disappears for every user on the next sync, instead of being resurrected by
// a server refresh or seen by other devices. All are best-effort (offline must
// never block the UI); the local item is always removed regardless.
// ---------------------------------------------------------------------------

/** DELETE /api/posts/:postId — permanently remove a question thread. */
export async function deleteServerQuestion(serverPostId, userId) {
  try {
    const headers = { 'Content-Type': 'application/json', ...(await authHeaders()) };
    const response = await fetch(`${API_URL}/api/posts/${encodeURIComponent(serverPostId)}`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ userId }),
    });
    return response.ok;
  } catch (error) {
    console.warn('deleteServerQuestion failed', error.message);
    return false;
  }
}

/** DELETE /api/posts/:postId/contributions/:contribId — permanently remove an answer. */
export async function deleteServerAnswer(serverPostId, contribId, userId) {
  try {
    const headers = { 'Content-Type': 'application/json', ...(await authHeaders()) };
    const response = await fetch(
      `${API_URL}/api/posts/${encodeURIComponent(serverPostId)}/contributions/${encodeURIComponent(contribId)}`,
      { method: 'DELETE', headers, body: JSON.stringify({ userId }) }
    );
    return response.ok;
  } catch (error) {
    console.warn('deleteServerAnswer failed', error.message);
    return false;
  }
}

/** DELETE /api/community/posts/:postId — permanently remove a community post. */
export async function deleteServerCommunityPost(postId, userId) {
  try {
    const headers = { 'Content-Type': 'application/json', ...(await authHeaders()) };
    const response = await fetch(`${API_URL}/api/community/posts/${encodeURIComponent(postId)}`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ userId }),
    });
    return response.ok;
  } catch (error) {
    console.warn('deleteServerCommunityPost failed', error.message);
    return false;
  }
}

/** DELETE /api/community/posts/:postId/comments/:commentId — permanently remove a comment. */
export async function deleteServerCommunityComment(postId, commentId, userId) {
  try {
    const headers = { 'Content-Type': 'application/json', ...(await authHeaders()) };
    const response = await fetch(
      `${API_URL}/api/community/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}`,
      { method: 'DELETE', headers, body: JSON.stringify({ userId }) }
    );
    return response.ok;
  } catch (error) {
    console.warn('deleteServerCommunityComment failed', error.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Account sync (server-backed profile + password storage)
// ---------------------------------------------------------------------------
// Accounts are stored on-device, but we also keep a lightweight copy on the
// backend so profile/email/password changes survive reinstalls and show up on
// other devices. All calls are best-effort (offline must never block the app).

/** POST /api/users/register — store/refresh the profile for an email. */
export async function registerUserProfile(
  email,
  fullName,
  passwordHash = null,
  profilePicture = null,
  extended = null
) {
  try {
    const headers = {
      'Content-Type': 'application/json',
      ...(await authHeaders()),
    };
    const response = await fetch(`${API_URL}/api/users/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email,
        fullName,
        passwordHash,
        profilePicture,
        // Extended signup-profile fields (occupation / address / bio) — the
        // server MERGES, so passing them is always safe.
        occupation: extended?.occupation ?? undefined,
        address: extended?.address ?? undefined,
        bio: extended?.bio ?? undefined,
      }),
    });
    return response.ok;
  } catch (error) {
    console.warn('registerUserProfile failed', error.message);
    return false;
  }
}

/** GET /api/users/:email — fetch the server copy of an account (may be null). */
export async function fetchServerUser(email) {
  try {
    const response = await fetch(`${API_URL}/api/users/${encodeURIComponent(String(email).trim().toLowerCase())}`, {
      method: 'GET',
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data && data.success ? data.user : null;
  } catch (error) {
    console.warn('fetchServerUser failed', error.message);
    return null;
  }
}

/** PUT /api/users/:email — update profile/email and/or password hash. */
export async function updateServerUser(currentEmail, patch) {
  try {
    const headers = {
      'Content-Type': 'application/json',
      ...(await authHeaders()),
    };
    const response = await fetch(`${API_URL}/api/users/${encodeURIComponent(String(currentEmail).trim().toLowerCase())}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(patch),
    });
    return response.ok;
  } catch (error) {
    console.warn('updateServerUser failed', error.message);
    return false;
  }
}