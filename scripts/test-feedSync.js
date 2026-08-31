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


console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);