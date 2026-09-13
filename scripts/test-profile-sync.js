// End-to-end offline/online profile-sync conflict tests.
// Run: node scripts/test-profile-sync.js   (uses @babel/core, already installed)
//
// Follows the same loader pattern as scripts/test-feedSync.js so the ESM
// profileSync.js helpers can run under plain Node.
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

const { profileTime, mergeUserProfiles, syncProfileToCloud } = load('profileSync.js');

let pass = 0, fail = 0;
const T = (name, cond) => {
  if (cond) { pass++; console.log('  ok - ' + name); }
  else { fail++; console.log('  FAIL - ' + name); }
};

const NOW = '2026-09-13T12:00:00.000Z';
const t = (s) => ({ ...s, updatedAt: s.updatedAt });
const EARLIER = '2026-09-13T10:00:00.000Z';
const LATER = '2026-09-13T11:00:00.000Z';

// --- profileTime ---
T('profileTime prefers updatedAt', profileTime({ updatedAt: LATER, lastSynced: EARLIER }) === Date.parse(LATER));
T('profileTime falls back to lastSynced', profileTime({ lastSynced: NOW }) === Date.parse(NOW));
T('profileTime null → 0', profileTime(null) === 0);
T('profileTime junk → 0', profileTime({ updatedAt: 'not-a-date' }) === 0);

// --- mergeUserProfiles: simple cases ---
T('no server copy → local untouched',
  mergeUserProfiles({ email: 'a@b.c', bio: 'hi' }, null, NOW).bio === 'hi');
T('no local copy → server untouched',
  mergeUserProfiles(null, { email: 'a@b.c', bio: 'srv' }, NOW).bio === 'srv');
T('both empty → {}', JSON.stringify(mergeUserProfiles(null, null)) === '{}');
T('stamps lastSynced only when now given',
  mergeUserProfiles({ email: 'a' }, null, NOW).lastSynced === NOW &&
  !('lastSynced' in mergeUserProfiles({ email: 'a' }, null, null)));

// --- mergeUserProfiles: freshness ---
const localOlder = t({ email: 'a@b.c', fullName: 'Old', bio: 'local-bio', updatedAt: EARLIER });
const serverNewer = t({ email: 'a@b.c', fullName: 'New', bio: 'server-bio', updatedAt: LATER });
const mergedNewer = mergeUserProfiles(localOlder, serverNewer, NOW);
T('server newer wins every shared field',
  mergedNewer.fullName === 'New' && mergedNewer.bio === 'server-bio');

const localNewer = t({ email: 'a@b.c', fullName: 'NewerLocal', bio: 'l2', updatedAt: LATER });
const serverOlder = t({ email: 'a@b.c', fullName: 'OlderServer', bio: 's2', updatedAt: EARLIER });
const mergedLocal = mergeUserProfiles(localNewer, serverOlder, NOW);
T('local newer wins every shared field',
  mergedLocal.fullName === 'NewerLocal' && mergedLocal.bio === 'l2');

// --- mergeUserProfiles: single-record freshness drives every shared field ---
// The schema carries ONE updatedAt per copy, so the fresher copy dictates all
// shared fields; ties resolve toward local (covered above / below).
const localMid = t({ email: 'a@b.c', fullName: 'LocalName', bio: 'local-bio', updatedAt: EARLIER });
const serverMid = t({ email: 'a@b.c', fullName: 'OldName', bio: 'ServerBio', updatedAt: LATER });
const mixed = mergeUserProfiles(localMid, serverMid, NOW);
T('fresher copy dictates all shared fields', mixed.bio === 'ServerBio' && mixed.fullName === 'OldName');

// --- mergeUserProfiles: no silent deletion, tie → local ---
const withAvatar = t({ email: 'a@b.c', fullName: 'Same', bio: 'x', avatarUrl: 'https://cdn/x.png', updatedAt: EARLIER });
const noAvatar = t({ email: 'a@b.c', fullName: 'Same', bio: 'y', updatedAt: EARLIER });
const mergedTie = mergeUserProfiles(withAvatar, noAvatar, NOW);
T('missing server field never deletes local field', mergedTie.avatarUrl === 'https://cdn/x.png');
T('tie resolves toward local', mergedTie.bio === 'x');

// --- syncProfileToCloud: end-to-end scenarios with injected fakes ---
function makeHarness({ local, server, offline = false }) {
  const state = { local: local ? { ...local } : null, server: server ? { ...server } : null };
  return {
    state,
    deps: {
      readLocal: async () => (state.local ? { ...state.local } : null),
      fetchServer: async () => {
        if (offline) throw new Error('no signal');
        return state.server ? { ...state.server } : null;
      },
      writeLocal: async (merged) => { state.local = { ...merged }; },
      setServer: async (merged) => { state.server = { ...merged }; },
    },
  };
}

async function main() {
  // Scenario 1: ONLINE first sync — local wins (tie/last-writer is local).
{
  const h = makeHarness({
    local: t({ email: 'a@b.c', fullName: 'Me', bio: 'hello', updatedAt: NOW }),
    server: null,
  });
  const r = await syncProfileToCloud({ ...h.deps, now: NOW });
  T('scenario 1: online, online=true', r.online === true);
  T('scenario 1: local pushed to empty server', h.state.server.fullName === 'Me');
  T('scenario 1: local content intact', h.state.local.bio === 'hello' && h.state.local.lastSynced === NOW);
}

// Scenario 2: OFFLINE — local must NOT be overwritten, nothing sent up.
{
  const originalLocal = t({ email: 'a@b.c', fullName: 'MeOffline', bio: 'offline edits', updatedAt: LATER });
  const h = makeHarness({
    local: originalLocal,
    server: t({ email: 'a@b.c', fullName: 'ServerCopy', bio: 'server edits', updatedAt: EARLIER }),
    offline: true,
  });
  const r = await syncProfileToCloud({ ...h.deps, now: NOW });
  T('scenario 2: offline reported', r.online === false);
  T('scenario 2: local not overwritten by server', h.state.local.fullName === 'MeOffline');
  T('scenario 2: server copy untouched (no stale push)', h.state.server.fullName === 'ServerCopy');
}

// Scenario 3: Server advanced while device was offline → server wins, no loss.
{
  const h = makeHarness({
    local: t({ email: 'a@b.c', fullName: 'OldName', bio: 'local old', updatedAt: EARLIER }),
    server: t({ email: 'a@b.c', fullName: 'NewName', bio: 'server new', updatedAt: LATER }),
  });
  const r = await syncProfileToCloud({ ...h.deps, now: NOW });
  T('scenario 3: server (newer) wins', h.state.local.fullName === 'NewName' && h.state.server.bio === 'server new');
  T('scenario 3: lastSynced stamped both sides', h.state.local.lastSynced === NOW && h.state.server.lastSynced === NOW);
}

// Scenario 4: Concurrent edits (poor connection) — tie → local wins shared
// fields, but server-only fields still merge through (nothing clobbered).
{
  const h = makeHarness({
    local: t({ email: 'a@b.c', fullName: 'LocalNew', bio: 'from local', updatedAt: NOW }),
    server: t({ email: 'a@b.c', fullName: 'FromServer', bio: 'ServerNew', occupation: 'Engineer', updatedAt: NOW }),
  });
  const r = await syncProfileToCloud({ ...h.deps, now: NOW });
  T('scenario 4: tie → local wins shared fields', h.state.local.fullName === 'LocalNew' && h.state.local.bio === 'from local');
  T('scenario 4: server-only field survives (occupation merged)', h.state.local.occupation === 'Engineer');
  T('scenario 4: changed flag true', r.changed === true);
}

// Scenario 5: No content overwritten — server-only field (occupation) stays on
// the device when a stale local copy (no occupation) syncs up.
{
  const h = makeHarness({
    local: t({ email: 'a@b.c', fullName: 'Stale', updatedAt: EARLIER }),
    server: t({ email: 'a@b.c', fullName: 'Stale', occupation: 'Engineer', updatedAt: EARLIER }),
  });
  await syncProfileToCloud({ ...h.deps, now: NOW });
  T('scenario 5: server-only field never lost', h.state.local.occupation === 'Engineer');
}
}

main()
  .then(() => {
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  })
  .catch((error) => {
    console.error('[test-profile-sync] harness crashed:', error);
    process.exit(1);
  });