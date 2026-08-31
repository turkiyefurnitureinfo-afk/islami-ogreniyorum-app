// ---------------------------------------------------------------------------
// avatarCache.js — offline-friendly profile pictures
// ---------------------------------------------------------------------------
// Remote avatars (Google / uploaded) previously failed to render whenever the
// device was offline, and server rows that predate avatar storage degrade the
// feed back to emoji. This module downloads every avatar to the app's cache
// directory the first time it is seen, so afterwards the picture renders from
// disk — online or offline.
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
import * as FileSystem from 'expo-file-system';

// Use documentDirectory for persistent storage - cacheDirectory can be cleared by the system
const AVATAR_DIR = (FileSystem.documentDirectory || '') + 'avatars/';

// djb2 hash → short, filesystem-safe, deterministic file name per URL.
function hashUrl(url) {
  let h = 5381;
  for (let i = 0; i < url.length; i++) {
    h = ((h << 5) + h + url.charCodeAt(i)) >>> 0;
  }
  return h.toString(16) + '_' + url.length.toString(16);
}

const isRemote = (url) => /^https?:\/\//i.test(url || '');

// url -> local file path, memoised for the session.
const resolved = new Map();
// De-dupe concurrent downloads of the same URL.
const inflight = new Map();

/**
 * Clean up any leftover .temp files from failed/interrupted downloads.
 * Call this on app start to prevent .temp file accumulation.
 */
export async function cleanupTempFiles() {
  try {
    if (!AVATAR_DIR) return;
    const dir = await FileSystem.getInfoAsync(AVATAR_DIR);
    if (!dir.exists) return;
    
    const files = await FileSystem.readDirectoryAsync(AVATAR_DIR);
    const tempFiles = files.filter(f => f.endsWith('.temp') || f.includes('.temp.'));
    
    await Promise.all(tempFiles.map(async (f) => {
      try {
        await FileSystem.deleteAsync(AVATAR_DIR + f, { idempotent: true });
      } catch {}
    }));
  } catch {}
}

/**
 * Resolve an avatar URL to a local cached file path.
 * - Non-remote URLs (file:// / content://) are returned untouched.
 * - Already-downloaded avatars resolve instantly from the memo / disk.
 * - Returns null when the download fails (offline, first sight) — callers
 *   then fall back to the remote URL.
 * @param {string} url
 * @returns {Promise<string|null>}
 */
export async function getCachedAvatar(url) {
  if (!url) return null;
  if (!isRemote(url)) return url;
  if (resolved.has(url)) return resolved.get(url);
  if (inflight.has(url)) return inflight.get(url);

  const job = (async () => {
    let tempPath = null;
    try {
      if (!AVATAR_DIR) return null;
      const dir = await FileSystem.getInfoAsync(AVATAR_DIR);
      if (!dir.exists) {
        await FileSystem.makeDirectoryAsync(AVATAR_DIR, { intermediates: true });
      }
      const local = AVATAR_DIR + hashUrl(url) + '.img';
      const existing = await FileSystem.getInfoAsync(local);
      if (existing.exists) {
        resolved.set(url, local);
        return local;
      }
      
      // Use downloadResumable to have better control over temp files
      const { uri } = await FileSystem.downloadAsync(url, local);
      tempPath = uri;
      resolved.set(url, uri);
      return uri;
    } catch (_e) {
      // Clean up any temp file left behind on failure
      if (tempPath) {
        try {
          await FileSystem.deleteAsync(tempPath, { idempotent: true });
        } catch {}
      }
      // Offline / failed download — caller falls back to the remote URL.
      return null;
    } finally {
      inflight.delete(url);
    }
  })();

  inflight.set(url, job);
  return job;
}

/**
 * Fire-and-forget bulk download — used after feed syncs so avatars are on
 * disk BEFORE the user goes offline.
 * @param {Array<string|undefined|null>} urls
 */
export function precacheAvatars(urls) {
  (urls || []).filter(Boolean).forEach((u) => {
    getCachedAvatar(u).catch(() => {});
  });
}

/**
 * React hook: resolves an avatar URL to the best available source.
 * Returns the cached local path when available, null otherwise — the caller
 * falls back to the remote URL and finally to the emoji.
 * @param {string|undefined} url
 * @returns {string|null}
 */
export function useCachedAvatar(url) {
  const [local, setLocal] = useState(null);

  useEffect(() => {
    if (!url) {
      setLocal(null);
      return undefined;
    }
    if (!isRemote(url)) {
      setLocal(url);
      return undefined;
    }
    if (resolved.has(url)) {
      setLocal(resolved.get(url));
      return undefined;
    }
    let alive = true;
    getCachedAvatar(url).then((path) => {
      if (alive && path) setLocal(path);
    });
    return () => {
      alive = false;
    };
  }, [url]);

  return local;
}