// Quick behavioral test for the feedSync.js helpers extracted from App.js.
// Run: node scripts/test-feedSync.js   (uses @babel/core, already installed)
const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');

function toCJS(file) {
  const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const { code } = babel.transformSync(src, {
    filename: file,
    presets: [require('babel-preset-expo')],
    babelrc: false,
    configFile: false,
  });
  return code;
}

function load(file) {
  const code = toCJS(file);
  const module_ = { exports: {} };
  const fn = new Function('require', 'module', 'exports', code);
  // Intercept relative imports so they resolve via our toCJS loader too.
  let resolved = {};
  const localRequire = (id) => {
    if (id.startsWith('./') || id.startsWith('../')) {
      const abs = path.join(__dirname, '..', id);
      if (!resolved[abs]) resolved[abs] = load(id);
      return resolved[abs];
    }
    return require(id);
  };
  fn(localRequire, module_, module_.exports);
  return module_.exports;
}

const feedSync = load('feedSync.js');

let pass = 0, fail = 0;
const T = (name, cond) => {
  if (cond) { pass++; console.log('  ok - ' + name); }
  else { fail++; console.log('  FAIL - ' + name); }
};

// --- hasRealContent ---
T('hasRealContent true for owned item', feedSync.hasRealContent([{ ownerEmail: 'a@b.c' }]) === true);
T('hasRealContent false for sample', feedSync.hasRealContent([{ question: 'x' }]) === false);
T('hasRealContent false for empty', feedSync.hasRealContent([]) === false);

// --- sameId ---
T('sameId numeric/string', feedSync.sameId(5, '5') === true);
T('sameId null-safe', feedSync.sameId(null, 0) === false);

// --- isRealUserPost / onlyRealUserPosts (community feed only shows real users) ---
T('isRealUserPost true with ownerEmail', feedSync.isRealUserPost({ ownerEmail: 'a@b.c' }) === true);
T('isRealUserPost false without ownerEmail', feedSync.isRealUserPost({ user: { name: 'Demo' }, text: 'x' }) === false);
T('isRealUserPost false for null', feedSync.isRealUserPost(null) === false);
T('onlyRealUserPosts drops fake posts', feedSync.onlyRealUserPosts([
  { ownerEmail: 'a@b.c', text: 'real' },
  { user: { name: 'Fake' }, text: 'demo' },
]).length === 1);
T('onlyRealUserPosts null-safe empty', feedSync.onlyRealUserPosts(null).length === 0);

// --- normalizeServerQA ---
const qa = feedSync.normalizeServerQA({
  id: 'p1', question: 'Q?', ownerUserId: 'o@x.c', likes: 3,
  contributions: [{ id: 'c1', userId: 'u@x.c', authorName: 'A', text: 'ppt', createdAt: new Date().toISOString() }],
}, 'tr');
T('normalizeServerQA ids', qa.id === 'srv-p1' && qa.serverPostId === 'p1');
T('normalizeServerQA answer owner', qa.answers[0].ownerEmail === 'u@x.c');

// --- normalizeServerCommunityPost ---
const cp = feedSync.normalizeServerCommunityPost({
  id: 'p1', authorName: 'A', ownerUserId: 'o@x.c', text: 'hi',
  comments: [{ id: 'c1', userId: 'u@x.c' }],
}, 'tr');
T('community comment uses commenterEmail', cp.comments[0].commenterEmail === 'u@x.c');
T('community post media null when absent', cp.media === null);

// --- normalizeServerCommunityPost: media must survive (the "upload succeeded
// but the image never appears" bug). mediaType is metadata, not a gate, and a
// server-RELATIVE path must be absolutized rather than silently discarded.
const API = 'https://api.example.com';

const mediaNoType = feedSync.normalizeServerCommunityPost(
  { id: 'p2', ownerUserId: 'o@x.c', text: 'pic', mediaUri: 'https://cdn.x/a.jpg' },
  'tr',
  API
);
T('media survives when mediaType is missing', !!mediaNoType.media && mediaNoType.media.uri === 'https://cdn.x/a.jpg');
T('media type inferred as image', mediaNoType.media.type === 'image');

const mediaRelative = feedSync.normalizeServerCommunityPost(
  { id: 'p3', ownerUserId: 'o@x.c', text: 'pic', mediaUri: '/uploads/123-ab.jpg', mediaType: 'image' },
  'tr',
  API
);
T('server-relative mediaUri is absolutized, not dropped',
  !!mediaRelative.media && mediaRelative.media.uri === API + '/uploads/123-ab.jpg');

const mediaGs = feedSync.normalizeServerCommunityPost(
  { id: 'p4', ownerUserId: 'o@x.c', mediaUri: 'gs://bucket.firebasestorage.app/123-ab.jpg' },
  'tr',
  API
);
T('gs:// object URI routes through the signed-URL gateway',
  !!mediaGs.media && mediaGs.media.uri === API + '/uploads/123-ab.jpg');

const mediaAltField = feedSync.normalizeServerCommunityPost(
  { id: 'p5', ownerUserId: 'o@x.c', mediaUrl: 'https://cdn.x/b.mp4' },
  'tr',
  API
);
T('mediaUrl alt field is honored', !!mediaAltField.media && mediaAltField.media.uri === 'https://cdn.x/b.mp4');
T('video type inferred from extension', mediaAltField.media.type === 'video');

const mediaLocalOnly = feedSync.normalizeServerCommunityPost(
  { id: 'p6', ownerUserId: 'o@x.c', mediaUri: 'file:///data/user/0/cache/x.jpg', mediaType: 'image' },
  'tr',
  API
);
T('local file:// media stays dropped (not renderable elsewhere)', mediaLocalOnly.media === null);

// --- inferMediaType ---
T('inferMediaType honors explicit image', feedSync.inferMediaType('image', 'https://x/y') === 'image');
T('inferMediaType honors mime video', feedSync.inferMediaType('video/mp4', 'https://x/y') === 'video');
T('inferMediaType defaults to image', feedSync.inferMediaType(null, 'https://x/y') === 'image');
T('inferMediaType ignores query string when sniffing ext',
  feedSync.inferMediaType(null, 'https://x/y.mp4?token=1') === 'video');

// --- absolutizeMediaRef ---
T('absolutizeMediaRef passes https through', feedSync.absolutizeMediaRef('https://x/a.jpg', API) === 'https://x/a.jpg');
T('absolutizeMediaRef upgrades protocol-relative', feedSync.absolutizeMediaRef('//x/a.jpg', API) === 'https://x/a.jpg');
T('absolutizeMediaRef joins server-relative', feedSync.absolutizeMediaRef('/uploads/a.jpg', API) === API + '/uploads/a.jpg');
T('absolutizeMediaRef maps gs:// to the gateway', feedSync.absolutizeMediaRef('gs://b/a.jpg', API) === API + '/uploads/a.jpg');
T('absolutizeMediaRef rejects file://', feedSync.absolutizeMediaRef('file:///a.jpg', API) === null);
T('absolutizeMediaRef rejects data:', feedSync.absolutizeMediaRef('data:image/png;base64,AAAA', API) === null);
T('absolutizeMediaRef rejects non-string', feedSync.absolutizeMediaRef(42, API) === null);
T('absolutizeMediaRef rejects empty', feedSync.absolutizeMediaRef('   ', API) === null);

// --- mergeQA ---
const prev = [{ id: 'srv-p1', serverPostId: 'p1', likedByMe: true, ownerEmail: 'who@x' }];
const freshBase = feedSync.normalizeServerQA({ id: 'p1', question: 'Q?', ownerUserId: 'own@x.c', likes: 9, contributions: [] }, 'tr');
const merged = feedSync.mergeQA(prev, [freshBase], new Set());
T('mergeQA preserves likedByMe', merged[0].likedByMe === true);
T('mergeQA merges server likes', merged[0].likes === 9);
T('mergeQA keeps id', merged[0].id === 'srv-p1');

const deleted = new Set(['qa:p9']);
const dqa = feedSync.normalizeServerQA({ id: 'p9', question: 'gone' }, 'tr');
T('mergeQA excludes tombstoned', feedSync.mergeQA(prev, [dqa], deleted).length === 1);

// --- mergeCommunityPosts ---
const prevC = [{ id: 1, serverId: 1, likedByMe: true }];
const freshC = feedSync.normalizeServerCommunityPost({ id: 1, ownerUserId: 'o@x', text: 't' }, 'tr');
const mergedC = feedSync.mergeCommunityPosts(prevC, [freshC], new Set());
T('mergeCommunityPosts preserves likedByMe', mergedC[0].likedByMe === true);

// A server row without media must not erase media the device already renders.
const prevWithMedia = [{
  id: 7, serverId: 7, likedByMe: false,
  user: { name: 'A', avatar: '👤', avatarUrl: null },
  media: { type: 'image', uri: 'https://cdn.x/kept.jpg' },
}];
const freshNoMedia = feedSync.normalizeServerCommunityPost(
  { id: 7, ownerUserId: 'o@x', text: 't' }, 'tr'
);
const mergedMedia = feedSync.mergeCommunityPosts(prevWithMedia, [freshNoMedia], new Set());
T('mergeCommunityPosts keeps local media when server row lacks it',
  !!mergedMedia[0].media && mergedMedia[0].media.uri === 'https://cdn.x/kept.jpg');

// A server row WITH media still wins (fresh truth from the backend).
const prevStaleMedia = [{
  id: 8, serverId: 8, likedByMe: false,
  user: { name: 'A', avatar: '', avatarUrl: null },
  media: { type: 'image', uri: 'https://cdn.x/stale.jpg' },
}];
const freshWithMedia = feedSync.normalizeServerCommunityPost(
  { id: 8, ownerUserId: 'o@x', text: 't', mediaUri: 'https://cdn.x/fresh.jpg' }, 'tr'
);
const mergedFresh = feedSync.mergeCommunityPosts(prevStaleMedia, [freshWithMedia], new Set());
T('mergeCommunityPosts prefers server media when present',
  !!mergedFresh[0].media && mergedFresh[0].media.uri === 'https://cdn.x/fresh.jpg');

// --- avatar preservation on merge (offline picture fix) ---
// Server rows created before authorAvatar was stored have no avatar; the
// locally-known picture must survive a refresh instead of degrading to emoji.
const prevWithAvatar = [{
  id: 1,
  serverId: 1,
  likedByMe: false,
  ownerEmail: 'o@x',
  user: { name: 'Ali', avatar: '🧔', avatarUrl: 'https://example.com/a.jpg' },
  comments: [{
    id: 'srv-1-c1',
    user: { name: 'Veli', avatar: '👦', avatarUrl: 'https://example.com/c.jpg' },
    commenterEmail: 'v@x',
    text: 'hi',
    timestamp: 'now',
    likes: 0,
    likedByMe: false,
  }],
}];
const freshNoAvatar = feedSync.normalizeServerCommunityPost({
  id: 1,
  ownerUserId: 'o@x',
  text: 't',
  // Comment exists on the server but has no authorAvatar stored (older row).
  comments: [{ id: 'c1', userId: 'v@x', authorName: 'Veli', text: 'hi', createdAt: new Date().toISOString() }],
}, 'tr');
const mergedAvatar = feedSync.mergeCommunityPosts(prevWithAvatar, [freshNoAvatar], new Set());
T('mergeCommunityPosts preserves post avatar when server lacks it', mergedAvatar[0].user.avatarUrl === 'https://example.com/a.jpg');
T('mergeCommunityPosts preserves comment avatar when server lacks it', mergedAvatar[0].comments[0].user.avatarUrl === 'https://example.com/c.jpg');
// Server-provided avatars still win when present.
const freshWithAvatar = feedSync.normalizeServerCommunityPost({ id: 1, ownerUserId: 'o@x', text: 't', authorAvatar: 'https://example.com/new.jpg' }, 'tr');
const mergedServer = feedSync.mergeCommunityPosts(prevWithAvatar, [freshWithAvatar], new Set());
T('mergeCommunityPosts prefers server avatar when present', mergedServer[0].user.avatarUrl === 'https://example.com/new.jpg');

// mergeQA: answer avatars preserved the same way.
const prevQA = [{
  id: 'srv-p1',
  serverPostId: 'p1',
  likedByMe: false,
  ownerEmail: 'o@x',
  answers: [{
    id: 'srv-p1-c1',
    serverContribId: 'c1',
    user: { name: 'A', avatar: '👩', avatarUrl: 'https://example.com/ans.jpg' },
    text: 'x',
    timestamp: 'now',
    likes: 0,
    likedByMe: false,
    ownerEmail: 'a@x',
  }],
}];
const freshQA = feedSync.normalizeServerQA({ id: 'p1', question: 'Q?', ownerUserId: 'o@x', likes: 1, contributions: [{ id: 'c1', userId: 'a@x', authorName: 'A', text: 'x', createdAt: new Date().toISOString() }] }, 'tr');
const mergedQAav = feedSync.mergeQA(prevQA, [freshQA], new Set());
T('mergeQA preserves answer avatar when server lacks it', mergedQAav[0].answers[0].user.avatarUrl === 'https://example.com/ans.jpg');

// --- answer / comment tombstones: deleted items must not return after merge ---
const prevWithAnswers = [{
  id: 'srv-p1',
  serverPostId: 'p1',
  likedByMe: false,
  ownerEmail: 'o@x',
  answers: [
    { id: 'srv-p1-c1', serverContribId: 'c1', text: 'keep me', ownerEmail: 'a@x' },
    { id: 'srv-p1-c2', serverContribId: 'c2', text: 'delete me', ownerEmail: 'a@x' },
  ],
}];
const freshWithAnswers = feedSync.normalizeServerQA({
  id: 'p1', question: 'Q?', ownerUserId: 'o@x', likes: 1,
  contributions: [
    { id: 'c1', userId: 'a@x', authorName: 'A', text: 'keep me', createdAt: new Date().toISOString() },
    { id: 'c2', userId: 'a@x', authorName: 'A', text: 'delete me', createdAt: new Date().toISOString() },
  ],
}, 'tr');
const deletedAns = new Set(['answer:c2']);
const mergedAnsTombstone = feedSync.mergeQA(prevWithAnswers, [freshWithAnswers], deletedAns);
T('mergeQA excludes tombstoned answers', mergedAnsTombstone[0].answers.length === 1 && mergedAnsTombstone[0].answers[0].serverContribId === 'c1');

const prevWithComments = [{
  id: 1,
  serverId: 1,
  likedByMe: false,
  ownerEmail: 'o@x',
  comments: [
    { id: 'srv-1-c1', text: 'keep me', commenterEmail: 'v@x' },
    { id: 'srv-1-c2', text: 'delete me', commenterEmail: 'v@x' },
  ],
}];
const freshWithComments = feedSync.normalizeServerCommunityPost({
  id: 1, ownerUserId: 'o@x', text: 't',
  comments: [
    { id: 'c1', userId: 'v@x', authorName: 'V', text: 'keep me', createdAt: new Date().toISOString() },
    { id: 'c2', userId: 'v@x', authorName: 'V', text: 'delete me', createdAt: new Date().toISOString() },
  ],
}, 'tr');
const deletedCom = new Set(['comment:srv-1-c2']);
const mergedComTombstone = feedSync.mergeCommunityPosts(prevWithComments, [freshWithComments], deletedCom);
T('mergeCommunityPosts excludes tombstoned comments', mergedComTombstone[0].comments.length === 1 && mergedComTombstone[0].comments[0].id === 'srv-1-c1');

// --- Newest-first ordering (community feed) ---
// Feed refresh must keep the newest post at the top even when the existing
// local list is not sorted by recency (the historical merge bug).
const older = feedSync.normalizeServerCommunityPost({ id: 1, ownerUserId: 'o@x', text: 'old', createdAt: '2024-01-01T00:00:00.000Z' }, 'tr');
const newer = feedSync.normalizeServerCommunityPost({ id: 2, ownerUserId: 'o@x', text: 'new', createdAt: '2024-02-01T00:00:00.000Z' }, 'tr');
// Existing local list is intentionally oldest-first.
const unorderedPrev = [older, newer];
const reSorted = feedSync.mergeCommunityPosts(unorderedPrev, [older, newer], new Set());
T('mergeCommunityPosts orders newest first (by createdAt)', reSorted[0].id === 2 && reSorted[0].text === 'new');
const contentSortUp = feedSync.contentSortTime(newer) > feedSync.contentSortTime(older);
T('contentSortTime uses createdAt', contentSortUp);

// --- Newest-first ordering (Q&A feed) ---
const qaOld = feedSync.normalizeServerQA({ id: 'p1', question: 'old?', ownerUserId: 'o@x', createdAt: '2024-01-01T00:00:00.000Z', contributions: [] }, 'tr');
const qaNew = feedSync.normalizeServerQA({ id: 'p2', question: 'new?', ownerUserId: 'o@x', createdAt: '2024-02-01T00:00:00.000Z', contributions: [] }, 'tr');
const qaSorted = feedSync.mergeQA([qaOld, qaNew], [qaOld, qaNew], new Set());
T('mergeQA orders newest first (by createdAt)', qaSorted[0].id === 'srv-p2');

// A brand-new locally-created post (numeric Date.now() id, no createdAt) must
// outrank older server posts, falling back to its id as the sort key.
const localNew = { id: 9999999999999, serverId: undefined, user: { name: 'Me' }, ownerEmail: 'o@x', text: 'just posted', comments: [] };
const mergedWithLocalAppend = feedSync.mergeCommunityPosts([localNew, older, newer], [older, newer], new Set());
const localFirst = mergedWithLocalAppend[0].id === localNew.id;
T('local-only newest post sorts to top (id fallback)', localFirst);

// --- Deletion propagation: posts removed by OTHER users must vanish from
// local state when the server no longer returns them (no user-level tombstone).
// Before the fix, mergeCommunityPosts kept every "no match" local post as if
// it were an unsynced draft — so deleted-by-others posts never disappeared.
const prevOwnPost = feedSync.normalizeServerCommunityPost({ id: 1, ownerUserId: 'me@x', text: 'mine', createdAt: '2024-01-01T00:00:00.000Z' }, 'tr');
const prevOtherPost = feedSync.normalizeServerCommunityPost({ id: 2, ownerUserId: 'other@x', text: 'theirs', createdAt: '2024-01-02T00:00:00.000Z' }, 'tr');
// 'other' post is gone from the server (deleted by its owner) — simulate by
// only returning prevOwnPost on the next feed poll.
const deletedMerged = feedSync.mergeCommunityPosts([prevOwnPost, prevOtherPost], [prevOwnPost], new Set());
T('mergeCommunityPosts drops posts deleted by other users',
  deletedMerged.length === 1 && deletedMerged[0].id === prevOwnPost.id);

// The user's own unsynced draft (no serverId) must NOT be dropped when the
// server doesn't return it.
const unsyncedDraft = { id: 999, serverId: undefined, ownerEmail: 'me@x', text: 'draft', comments: [] };
const keptDraft = feedSync.mergeCommunityPosts([unsyncedDraft, prevOwnPost], [prevOwnPost], new Set());
T('mergeCommunityPosts keeps local-only draft (no serverId)', keptDraft.some((p) => p.id === 999));

// A post with serverId that IS in the server response must survive even if
// its local numeric id doesn't match by string conversion quirks.
const serverPost = feedSync.normalizeServerCommunityPost({ id: 'abc123', ownerUserId: 'me@x', text: 'kept' }, 'tr');
const localCopy = { id: 'abc123', serverId: 'abc123', ownerEmail: 'me@x', text: 'old text', user: { name: 'Me', avatar: '👤', avatarUrl: 'https://x/a.jpg' }, comments: [] };
const freshServer = [serverPost];
const survived = feedSync.mergeCommunityPosts([localCopy], freshServer, new Set());
T('mergeCommunityPosts keeps post present on server', survived.length === 1 && survived[0].id === 'abc123');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);