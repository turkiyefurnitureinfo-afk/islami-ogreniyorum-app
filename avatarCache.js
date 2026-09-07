// ---------------------------------------------------------------------------
// avatarCache.js — offline-friendly profile pictures
// ---------------------------------------------------------------------------
// Remote avatars (Google / uploaded) previously failed to render whenever the
// device was offline, and server rows that predate avatar storage degrade the
// feed back to emoji. This module downloads every avatar to the app's cache
// directory the first time it is seen, so afterwards the picture renders from
// disk — online or offline.
//
// FIXED: switched from documentDirectory (persistent, never purged) to
// cacheDirectory (OS can purge when storage is low). Added a cache-size cap
// with LRU eviction so the cache never grows unbounded.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import * as FileSystem from 'expo-file-system';

// Use cacheDirectory — the OS can purge it when storage is low.
const AVATAR_DIR = ((FileSystem.cacheDirectory || FileSystem.documentDirectory) ?? '') + 'avatars/';

// Cache limits — prevent unbounded growth.
const MAX_CACHE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB max
const MAX_CACHE_FILES = 200;
const MAX_CONCURRENT_DOWNLOADS = 3;

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
// Track file access times for LRU eviction.
const fileAccessTimes = new Map();
// Semaphore for limiting concurrent downloads.
let activeDownloads = 0;
const downloadQueue = [];

function processQueue() {
  while (activeDownloads < MAX_CONCURRENT_DOWNLOADS && downloadQueue.length > 0) {
    const item = downloadQueue.shift();
    if (!item) continue;
    const { url, resolve } = item;
    activeDownloads++;
    downloadAvatar(url)
      .then(resolve)
      .catch(() => resolve(null))
      .finally(() => {
        activeDownloads--;
        processQueue();
      });
  }
}

async function downloadAvatar(url) {
  if (!AVATAR_DIR) return null;
  
  // Check if already resolved or in progress to prevent duplicate downloads
  if (resolved.has(url)) {
    const cached = resolved.get(url);
    if (cached) fileAccessTimes.set(cached, Date.now());
    return cached ?? null;
  }
  if (inflight.has(url)) {
    return inflight.get(url) ?? null;
  }
  
  const dir = await FileSystem.getInfoAsync(AVATAR_DIR);
  if (!dir.exists) {
    await FileSystem.makeDirectoryAsync(AVATAR_DIR, { intermediates: true });
  }
  const local = AVATAR_DIR + hashUrl(url) + '.img';
  const existing = await FileSystem.getInfoAsync(local);
  if (existing.exists) {
    fileAccessTimes.set(local, Date.now());
    // Record in the session memo too, so later calls take the fast path and
    // don't re-stat the disk.
    resolved.set(url, local);
    return local;
  }
  
  // Mark as in progress before starting download
  const downloadPromise = (async () => {
    try {
      await FileSystem.downloadAsync(url, local);
      // Use `local` (the known destination path) for cache tracking, not the
      // returned uri which may differ across platforms.
      fileAccessTimes.set(local, Date.now());
      // Populate the session memo so subsequent lookups resolve instantly instead
      // of falling through to a redundant disk existence check.
      resolved.set(url, local);
      await enforceCacheLimits();
      return local;
    } catch (error) {
      console.warn('Avatar download failed:', error?.message);
      return null;
    } finally {
      inflight.delete(url);
    }
  })();
  
  inflight.set(url, downloadPromise);
  return downloadPromise;
}

async function enforceCacheLimits() {
  try {
    const dir = await FileSystem.getInfoAsync(AVATAR_DIR);
    if (!dir.exists) return;
    const files = await FileSystem.readDirectoryAsync(AVATAR_DIR);
    const imgFiles = files.filter(f => f.endsWith('.img'));
    if (imgFiles.length > MAX_CACHE_FILES) {
      const sorted = imgFiles
        .map(f => ({ name: f, time: fileAccessTimes.get(AVATAR_DIR + f) || 0 }))
        .sort((a, b) => a.time - b.time);
      const toDelete = sorted.slice(0, sorted.length - MAX_CACHE_FILES);
      await Promise.all(toDelete.map(async (f) => {
        try {
          await FileSystem.deleteAsync(AVATAR_DIR + f.name, { idempotent: true });
          fileAccessTimes.delete(AVATAR_DIR + f.name);
        } catch {}
      }));
    }
    let totalSize = 0;
    const fileInfos = [];
    for (const f of imgFiles) {
      try {
        const info = await FileSystem.getInfoAsync(AVATAR_DIR + f);
        if (info.exists && info.size) {
          totalSize += info.size;
          fileInfos.push({ name: f, size: info.size, time: fileAccessTimes.get(AVATAR_DIR + f) || 0 });
        }
      } catch {}
    }
    if (totalSize > MAX_CACHE_SIZE_BYTES) {
      fileInfos.sort((a, b) => a.time - b.time);
      let currentSize = totalSize;
      for (const f of fileInfos) {
        if (currentSize <= MAX_CACHE_SIZE_BYTES) break;
        try {
          await FileSystem.deleteAsync(AVATAR_DIR + f.name, { idempotent: true });
          fileAccessTimes.delete(AVATAR_DIR + f.name);
          currentSize -= f.size;
        } catch {}
      }
    }
  } catch {}
}

/**
 * Clean up temp files and enforce cache limits. Call on app start.
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
    await enforceCacheLimits();
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
  if (resolved.has(url)) {
    const cached = resolved.get(url);
    if (cached) fileAccessTimes.set(cached, Date.now());
    return cached ?? null;
  }
  if (inflight.has(url)) return inflight.get(url) ?? null;

  const job = (async () => {
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
        fileAccessTimes.set(local, Date.now());
        return local;
      }
      
      // Queue the download to respect MAX_CONCURRENT_DOWNLOADS.
      return await new Promise((resolve) => {
        downloadQueue.push({ url, resolve });
        processQueue();
      });
    } catch (_e) {
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
    getCachedAvatar(String(u)).catch(() => {});
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
      const cached = resolved.get(url);
      if (cached) fileAccessTimes.set(cached, Date.now());
      setLocal(cached);
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