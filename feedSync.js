// ---------------------------------------------------------------------------
// feedSync.js — pure, unit-testable helpers for syncing the local-first feed
// with the backend (Q&A questions and community posts).
//
// Extracted from App.js so the app's core merge logic can be reasoned about and
// tested independently of React/React Native. Everything here is a pure
// function of its inputs (except the timeAgo formatting helper, which is
// deterministic for a given input/timestamp).
// ---------------------------------------------------------------------------

import { timeAgo } from './utils.js';

/**
 * Compare content ids safely whether they are numeric (local Date.now()) or
 * strings (server / 'srv-...' prefixed ids).
 */
export const sameId = (a, b) => String(a ?? '') === String(b ?? '');

/**
 * Best-effort sortable timestamp for a post or QA item, in milliseconds.
 * Prefers a server `createdAt` (ISO/Date), otherwise falls back to the local
 * numeric `id` (Date.now() at creation). Returns 0 when neither is available so
 * such items sort last (treated as oldest/unknown).
 * @param {object} item
 * @returns {number}
 */
export function contentSortTime(item) {
  const c = item && item.createdAt;
  if (c) {
    const t = typeof c === 'string' ? Date.parse(c) : Number(c);
    if (Number.isFinite(t) && t > 0) return t;
  }
  const id = item && item.id;
  if (id != null && String(id) !== '' && Number.isFinite(Number(id))) {
    return Number(id);
  }
  return 0;
}

/**
 * True if a feed list contains at least one item the user actually created or
 * that came from the server (i.e. is NOT just bundled sample content). Used to
 * decide whether a language change should drop back to sample data or keep the
 * user's real feed.
 * @param {Array<object>} list
 */
export const hasRealContent = (list) =>
  Array.isArray(list) &&
  list.some((item) => item.ownerEmail || item.serverPostId || item.serverId);

/**
 * True when a community post genuinely belongs to a real, signed-in user — i.e.
 * it carries an owner email. Demo/fake posts bundled by older builds (or pushed
 * by the server without an owner) are NOT user content and must never appear in
 * the feed.
 * @param {object|null} item
 */
export const isRealUserPost = (item) => !!item && Boolean(item.ownerEmail);

/**
 * Keep only real-user items from a feed list. Used when hydrating the community
 * feed from local storage and when merging server posts, so stale demo/fake
 * content can never reappear — the community feed only ever shows content that
 * came from real users.
 * @param {Array<object>|null} list
 */
export const onlyRealUserPosts = (list) =>
  Array.isArray(list) ? list.filter(isRealUserPost) : [];

/**
 * Shape a backend Q&A document ("qaPosts/{id}") into the app's local item
 * shape, mapping server contribution rows onto the answer objects the UI
 * expects (names, avatars, timestamps, like state, ownership email).
 * @param {object} doc
 * @param {'tr'|'en'} language
 */
export function normalizeServerQA(doc, language) {
  return {
    id: 'srv-' + doc.id,
    serverPostId: doc.id,
    question: doc.question || '',
    answer: '',
    source: '',
    href: '',
    likes: doc.likes || 0,
    likedByMe: false,
    ownerEmail: doc.ownerUserId || null,
    createdAt: doc.createdAt || null,
    answers: (doc.contributions || []).map((c) => ({
      id: 'srv-' + doc.id + '-' + c.id,
      serverContribId: c.id,
      user: { name: c.authorName || '👤', avatar: '👤', avatarUrl: c.authorAvatar || null },
      text: c.text || '',
      timestamp: timeAgo(c.createdAt, language),
      likes: c.likes || 0,
      likedByMe: false,
      ownerEmail: c.userId || null,
    })),
    timestamp: timeAgo(doc.createdAt, language),
  };
}

/**
 * Shape a backend community post document ("communityPosts/{id}") into the
 * app's local post shape.
 * @param {object} doc
 * @param {'tr'|'en'} language
 */
export function normalizeServerCommunityPost(doc, language) {
  return {
    // Firestore doc id == the author's original local numeric post id, so
    // comment/like routing keeps working on other devices.
    id: doc.id,
    serverId: doc.id,
    user: { name: doc.authorName || '👤', avatar: '👤', avatarUrl: doc.authorAvatar || null },
    ownerEmail: doc.ownerUserId || null,
    text: doc.text || '',
    // Machine-sortable creation time (ISO). Used to keep the feed newest-first
    // even after a merge; `timestamp` above is the human-readable version.
    createdAt: doc.createdAt || null,
    timestamp: timeAgo(doc.createdAt, language),
    likes: doc.likes || 0,
    likedByMe: false,
    media:
      doc.mediaType && doc.mediaUri
        ? { type: doc.mediaType, uri: doc.mediaUri }
        : null,
    comments: (doc.comments || []).map((c) => ({
      id: 'srv-' + doc.id + '-' + c.id,
      serverId: c.id,
      user: { name: c.authorName || '👤', avatar: '👤', avatarUrl: c.authorAvatar || null },
      commenterEmail: c.userId || null,
      text: c.text || '',
      createdAt: c.createdAt || null,
      timestamp: timeAgo(c.createdAt, language),
      likes: 0,
      likedByMe: false,
    })),
  };
}

/**
 * Merge a fresh list of server Q&A items into the current local list without
 * losing identity, like/ownership state, or user tombstones.
 *
 * @param {Array<object>} prev        current local list
 * @param {Array<object>} serverQ     normalized server items
 * @param {Set<string>}   deletedIds  tombstoned 'qa:<serverPostId>' entries
 * @returns {Array<object>}
 */
export function mergeQA(prev, serverQ, deletedIds) {
  // Exclude items the current user deleted (tombstone) so a refresh never
  // resurrects them, then index the survivors by their server post id.
  const filteredQ = serverQ.filter((q) => !deletedIds.has('qa:' + q.serverPostId));
  const serverById = new Map(filteredQ.map((q) => [q.serverPostId, q]));

  const out = [];
  for (const item of prev) {
    if (item.serverPostId && serverById.has(item.serverPostId)) {
      // Refresh our synced copy but keep identity & like state.
      const fresh = serverById.get(item.serverPostId);
      const oldAnswers = Array.isArray(item.answers) ? item.answers : [];
      out.push({
        ...fresh,
        id: item.id,
        likedByMe: item.likedByMe,
        ownerEmail: item.ownerEmail || fresh.ownerEmail,
        // Exclude answers the current user deleted (tombstone) so a refresh
        // never brings them back. Tombstones are 'answer:<serverContribId>'.
        // Preserve locally-known avatars the server row lacks (older posts
        // were registered before authorAvatar was stored server-side), so a
        // refresh never degrades a picture back to the emoji.
        // Also preserve AI answers that were generated locally (they have no server match).
        answers: [
          // Keep AI answers from local data (they won't be in server data)
          ...oldAnswers.filter((a) => a.isAI),
          // Add server answers, excluding deleted ones
          ...(fresh.answers || [])
            .filter((a) => !deletedIds.has('answer:' + String(a.serverContribId)))
            .map((a) => {
              const old = oldAnswers.find((oa) => sameId(oa.id, a.id));
              if (old && old.user && old.user.avatarUrl && !(a.user && a.user.avatarUrl)) {
                return {
                  ...a,
                  user: {
                    ...(a.user || old.user),
                    avatarUrl: old.user.avatarUrl,
                    avatar: old.user.avatar || (a.user && a.user.avatar),
                  },
                };
              }
              return a;
            }),
        ],
        // Preserve AI answer data - always keep local AI answer if it exists
        aiAnswer: item.aiAnswer || fresh.aiAnswer,
        aiAnswerLoading: item.aiAnswerLoading || fresh.aiAnswerLoading,
        aiError: item.aiError || fresh.aiError,
        aiFallbackUrl: item.aiFallbackUrl || fresh.aiFallbackUrl,
      });
      serverById.delete(item.serverPostId);
    } else if (!item.serverPostId && !item.ownerEmail) {
      // Seeded sample content: keep only while there's no real feed.
      if (serverQ.length === 0) out.push(item);
    } else {
      out.push(item); // my unsynced drafts or orphans
    }
  }
  for (const remaining of serverById.values()) out.push(remaining);
  // Keep the Q&A feed newest-first across merges (server createdAt, else the
  // local Date.now() id). Ties remain in insertion order (stable sort).
  return out.sort((a, b) => contentSortTime(b) - contentSortTime(a));
}

/**
 * Merge a fresh list of server community posts into the current local list,
 * preserving identity, ownership and like state.
 *
 * @param {Array<object>} prev        current local list
 * @param {Array<object>} serverP     normalized server posts
 * @param {Set<string>}   deletedIds  tombstoned 'post:<serverId>' entries
 * @returns {Array<object>}
 */
export function mergeCommunityPosts(prev, serverP, deletedIds) {
  // Exclude posts the current user deleted (tombstone).
  const filteredP = serverP.filter((p) => !deletedIds.has('post:' + String(p.serverId)));
  const byRawId = new Map(filteredP.map((p) => [String(p.id), p]));

  const out = [];
  const consumed = new Set();
  for (const post of prev) {
    const key = String(post.id);
    const match = byRawId.get(key);
    if (match) {
      consumed.add(key);
      const oldComments = Array.isArray(post.comments) ? post.comments : [];
      out.push({
        ...match,
        id: post.id,
        ownerEmail: post.ownerEmail || match.ownerEmail,
        likedByMe: post.likedByMe,
        // Keep the locally-known avatar when the server row predates avatar
        // storage — otherwise a refresh would degrade the picture to emoji.
        user:
          match.user && match.user.avatarUrl
            ? match.user
            : post.user && post.user.avatarUrl
              ? {
                  ...(match.user || post.user),
                  avatarUrl: post.user.avatarUrl,
                  avatar: post.user.avatar || (match.user && match.user.avatar),
                }
              : match.user,
        // Exclude comments the current user deleted (tombstone) so a refresh
        // never brings them back. Tombstones are 'comment:<commentId>'.
        comments: (match.comments || [])
          .filter((c) => !deletedIds.has('comment:' + String(c.id)))
          .map((c) => {
            const old = oldComments.find((pc) => sameId(pc.id, c.id));
            if (old && old.user && old.user.avatarUrl && !(c.user && c.user.avatarUrl)) {
              return {
                ...c,
                user: {
                  ...(c.user || old.user),
                  avatarUrl: old.user.avatarUrl,
                  avatar: old.user.avatar || (c.user && c.user.avatar),
                },
              };
            }
            return c;
          }),
      });
    } else {
      out.push(post);
    }
  }
  for (const p of filteredP) {
    if (!consumed.has(String(p.id))) out.push(p);
  }
  // Keep the feed newest-first regardless of merge order. Server posts carry a
  // `createdAt`; local-only posts fall back to their Date.now() id. Ties are
  // broken by insertion order (stable sort).
  return out.sort((a, b) => contentSortTime(b) - contentSortTime(a));
}