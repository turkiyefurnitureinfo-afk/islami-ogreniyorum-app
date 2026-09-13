// ---------------------------------------------------------------------------
// push-dispatch.js — pure, testable helpers for Expo push dispatch.
// ---------------------------------------------------------------------------
// Extracted from index.js so the sanitization / channel-routing / message
// building / chunked-send logic can be unit-tested (scripts/test-push-dispatch.js)
// WITHOUT booting an HTTP server, Firestore or the expo-server-sdk.
//
// This module is intentionally dependency-free: the caller owns the Expo
// client, the storage layer and the token validator (which comes from the
// expo-server-sdk and therefore lives in index.js).
// ---------------------------------------------------------------------------

'use strict';

/** Expo batches must stay at 100 messages per sendPushNotificationsAsync call. */
const DEFAULT_CHUNK_SIZE = 100;

/**
 * Sanitize free-text user input: string, trimmed, length-capped, control chars
 * stripped (keeps \n and \t so multi-line post text survives intact).
 * @param {*} value
 * @param {number} [maxLen=2000]
 * @returns {string}
 */
function sanitizeText(value, maxLen = 2000) {
  if (value == null) return '';
  let s = String(value);
  // Strip control chars (keep \n \t) to avoid Firestore/log breakage.
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  s = s.trim();
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

/**
 * Map a notification trigger to the Expo channel it should use.
 * Community/Q&A thread activity gets its own channel so the user can mute it
 * independently of prayer times; everything else uses the default channel.
 * @param {string} trigger
 * @param {string|null} communityChannelId - the configured community channel id
 * @returns {string|null}
 */
function channelForTrigger(trigger, communityChannelId) {
  if (trigger === 'new_post' || trigger === 'new_comment' || trigger === 'new_answer') {
    return communityChannelId;
  }
  return null;
}

/**
 * Build a single Expo push message. Returns null when the token is missing,
 * not a string, or fails the optional `tokenValid` predicate — malformed
 * tokens are skipped, never allowed to crash chunking.
 *
 * @param {object} params
 * @param {*} params.token - Expo push token for one device
 * @param {*} params.title - notification title (sanitized, ≤120 chars)
 * @param {*} params.body - notification body (sanitized, ≤240 chars)
 * @param {object} [params.data] - extra payload (defaults to {})
 * @param {string|null} [params.channelId] - Expo channel override
 * @param {string} [params.sound='default'] - notification sound
 * @param {Function|null} [params.tokenValid] - optional validator; returning
 *   false rejects the token.
 * @returns {object|null}
 */
function buildPushMessage({ token, title, body, data = {}, channelId = null, sound = 'default', tokenValid = null }) {
  if (typeof token !== 'string' || token.length === 0) return null;
  if (typeof tokenValid === 'function' && tokenValid(token) === false) return null;
  const message = {
    to: token,
    sound: typeof sound === 'string' && sound.length > 0 ? sound : 'default',
    title: sanitizeText(title, 120) || 'Notification',
    body: sanitizeText(body, 240) || '',
    data: (data && typeof data === 'object') ? data : {},
  };
  if (channelId) message.channelId = channelId;
  return message;
}

/**
 * Send an Expo push batch in chunks of at most `chunkSize` messages.
 * NEVER throws: a network failure on one chunk (logged via onChunkError) does
 * not abort later chunks, and per-token ticket errors (Expo returns
 * {status:'error'} per token) are counted and forwarded via onTicketError.
 * Only successfully acknowledged tickets count toward `sent`.
 *
 * @param {object} expoClient - object exposing sendPushNotificationsAsync(chunk)
 * @param {Array<object>} messages - Expo push messages (from buildPushMessage)
 * @param {object} [opts]
 * @param {number} [opts.chunkSize=DEFAULT_CHUNK_SIZE]
 * @param {(error:Error, chunk:Array) => void} [opts.onChunkError]
 * @param {(ticket:object) => void} [opts.onTicketError]
 * @returns {Promise<{ok:boolean, sent:number, failed:number}>}
 */
async function sendPushChunks(expoClient, messages, opts = {}) {
  const { chunkSize = DEFAULT_CHUNK_SIZE, onChunkError, onTicketError } = opts;
  const list = Array.isArray(messages) ? messages : [];
  if (
    !expoClient ||
    typeof expoClient.sendPushNotificationsAsync !== 'function'
  ) {
    return { ok: false, sent: 0, failed: list.length, reason: 'no-expo-client' };
  }

  const chunks = [];
  for (let i = 0; i < list.length; i += chunkSize) {
    chunks.push(list.slice(i, i + chunkSize));
  }

  let sent = 0;
  let failed = 0;
  for (const chunk of chunks) {
    try {
      const tickets = (await expoClient.sendPushNotificationsAsync(chunk)) || [];
      for (const ticket of Array.isArray(tickets) ? tickets : []) {
        if (ticket && ticket.status === 'error') {
          failed += 1;
          if (typeof onTicketError === 'function') onTicketError(ticket);
        } else {
          sent += 1;
        }
      }
    } catch (error) {
      failed += chunk.length;
      if (typeof onChunkError === 'function') onChunkError(error, chunk);
    }
  }
  return { ok: sent > 0, sent, failed };
}

module.exports = {
  DEFAULT_CHUNK_SIZE,
  sanitizeText,
  channelForTrigger,
  buildPushMessage,
  sendPushChunks,
};