// ---------------------------------------------------------------------------
// profileSync.js — pure, unit-testable helpers for offline ↔ online profile
// sync (field-level last-writer-wins conflict resolution).
// ---------------------------------------------------------------------------
// Problem this solves: while the user edits their profile offline (or during a
// poor cellular connection), the server copy may advance independently. A naive
// "overwrite local with server" (or vice-versa) loses edits. These helpers
// merge the two copies field-by-field, picking the value from whichever side is
// fresher (updatedAt, falling back to lastSynced). Values that only exist on
// one side are never dropped, and a stale copy can never silently delete a
// field (a missing value never clobbers a present one).
//
// Everything here is a pure function of its inputs (except syncProfileToCloud,
// which is a dependency-injected orchestrator), so it can be reasoned about and
// unit-tested independently of React Native / AsyncStorage — see
// scripts/test-profile-sync.js.
// ---------------------------------------------------------------------------

/** Parse an ISO/epoch timestamp from a record field; 0 when absent/invalid. */
function timeOf(record, field) {
  const raw = record && record[field];
  if (!raw) return 0;
  const t = typeof raw === 'number' ? raw : Date.parse(String(raw));
  return Number.isFinite(t) ? t : 0;
}

/**
 * Freshness of a profile copy, used for conflict resolution.
 * Prefers `updatedAt`, falls back to `lastSynced`, then 0 (oldest).
 * @param {object|null} record
 * @returns {number}
 */
export function profileTime(record) {
  return Math.max(timeOf(record, 'updatedAt'), timeOf(record, 'lastSynced'));
}

/**
 * Merge a local profile copy with the server copy after reconnect.
 *
 * Rules:
 *   - One side missing/empty → the other side wins untouched.
 *   - Field-level last-writer-wins: the side whose record is fresher dictates
 *     every field both sides carry; ties resolve toward LOCAL so the user's
 *     own edits always win ambiguous races.
 *   - Absent values never clobber present ones (so a stale copy can't delete a
 *     field the other side still has).
 *   - `lastSynced` is stamped with `now` only when supplied (caller decides).
 *
 * @param {object|null} local - profile saved on this device
 * @param {object|null} server - profile stored in the cloud
 * @param {string|null} [now] - ISO timestamp to stamp as lastSynced
 * @returns {object} merged profile
 */
export function mergeUserProfiles(local, server, now = null) {
  const l = (local && typeof local === 'object') ? local : {};
  const s = (server && typeof server === 'object') ? server : {};
  const stamp = now ? { lastSynced: now } : {};

  if (!Object.keys(s).length) return { ...l, ...stamp };
  if (!Object.keys(l).length) return { ...s, ...stamp };

  const lTime = profileTime(l);
  const sTime = profileTime(s);

  const fields = new Set([...Object.keys(l), ...Object.keys(s)]);
  const merged = {};
  for (const field of fields) {
    const lv = l[field];
    const sv = s[field];
    if (lv === undefined) {
      if (sv !== undefined) merged[field] = sv;
      continue;
    }
    if (sv === undefined) {
      merged[field] = lv;
      continue;
    }
    // Both sides carry the field → newer side wins; tie → local wins.
    merged[field] = lTime >= sTime ? lv : sv;
  }
  return { ...merged, ...stamp };
}

/**
 * End-to-end offline/online sync orchestration (dependency-injected so tests
 * can simulate a device + cloud without AsyncStorage or a network):
 *
 *   1. read the local profile            (dep: readLocal)
 *   2. fetch the server profile          (dep: fetchServer)
 *   3. merge both copies (per-field LWW)
 *   4. write the winner back locally     (dep: writeLocal) and — only when the
 *      server was reachable — push it up  (dep: setServer)
 *
 * On network failure the local copy is left intact, the server copy is never
 * overwritten with stale data, and no content is lost.
 *
 * @param {object} deps
 * @param {() => Promise<object|null>} deps.readLocal
 * @param {() => Promise<object|null>} deps.fetchServer - THROWS when offline
 * @param {(merged:object) => Promise<void>} deps.writeLocal
 * @param {(merged:object) => Promise<void>} deps.setServer
 * @param {string|null} [deps.now] - ISO timestamp for lastSynced
 * @returns {Promise<{merged:object, online:boolean, changed:boolean}>}
 */
export async function syncProfileToCloud({ readLocal, fetchServer, writeLocal, setServer, now = null } = {}) {
  if (typeof readLocal !== 'function' || typeof writeLocal !== 'function') {
    throw new Error('profileSync: readLocal and writeLocal are required');
  }

  let local = null;
  try {
    local = (await readLocal()) || null;
  } catch {
    local = null;
  }

  let server = null;
  let online = false;
  if (typeof fetchServer === 'function') {
    try {
      server = await fetchServer();
      online = true;
    } catch {
      online = false; // poor connection → stay offline, never overwrite anything
    }
  }

  const merged = server
    ? mergeUserProfiles(local, server, now)
    : { ...(local || {}), ...(now ? { lastSynced: now } : {}) };

  const changed =
    JSON.stringify(merged) !== JSON.stringify(local || {}) ||
    JSON.stringify(merged) !== JSON.stringify(server || {});

  await writeLocal(merged);
  if (online && typeof setServer === 'function') {
    await setServer(merged);
  }

  return { merged, online, changed };
}