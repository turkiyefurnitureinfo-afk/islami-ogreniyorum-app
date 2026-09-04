/**
 * Cloud Sync Module
 * ==================
 * Centralizes ALL cloud (backend) writes for user data so the app survives
 * logout / uninstall / device change. The storage split is:
 *
 *   CLOUD (backend Firestore / memory):
 *     - User account (email, fullName, profilePicture)
 *     - User profile (occupation, address, bio)
 *     - Q&A questions + answers
 *     - Community posts + comments
 *     - Profile directory (best-known avatar/name per email)
 *
 *   PHONE (AsyncStorage only):
 *     - Prayer alarms (per-prayer clock config)
 *     - App settings (theme, language, notifications toggle, sound, prayerMethod)
 *
 * Every function here is best-effort: a failed network call must never block
 * the UI. Local state is always updated first; the cloud write happens in the
 * background and is retried on the next launch if it failed.
 */

import { API_URL } from './config.js';
import { getSecurityHeaders } from './security.js';
import { getCurrentFirebaseUser } from './firebaseAuth.js';

/**
 * Build the Authorization header with a fresh Firebase ID token when a user
 * is signed in. Returns an empty object for guests / unconfigured builds so
 * the caller can spread it harmlessly into the request headers.
 * @returns {Promise<Record<string, string>>}
 */
async function authHeaders() {
  try {
    const user = getCurrentFirebaseUser();
    if (user && typeof user.getIdToken === 'function') {
      const token = await user.getIdToken(true);
      return { Authorization: `Bearer ${token}` };
    }
  } catch (_e) {
    /* guest / unconfigured */
  }
  return {};
}

async function cloudFetch(path, { method = 'GET', body } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(await authHeaders()),
    ...(typeof getSecurityHeaders === 'function' ? (await getSecurityHeaders()) : {}),
  };
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return response;
}

// ---------------------------------------------------------------------------
// Account + Profile
// ---------------------------------------------------------------------------

export async function cloudSaveProfile(email, fullName, profilePicture, extended = {}) {
  try {
    const response = await cloudFetch('/api/users/register', {
      method: 'POST',
      body: {
        email,
        fullName,
        profilePicture: profilePicture || null,
        occupation: extended.occupation ?? '',
        address: extended.address ?? '',
        bio: extended.bio ?? '',
      },
    });
    return response.ok;
  } catch (error) {
    console.warn('cloudSaveProfile failed:', error.message);
    return false;
  }
}

export async function cloudFetchProfile(email) {
  try {
    const response = await cloudFetch(
      `/api/users/${encodeURIComponent(String(email).trim().toLowerCase())}`
    );
    if (!response.ok) return null;
    const data = await response.json();
    return data && data.success ? data.user : null;
  } catch (error) {
    console.warn('cloudFetchProfile failed:', error.message);
    return null;
  }
}

export async function cloudPatchProfile(email, patch) {
  try {
    const response = await cloudFetch(
      `/api/users/${encodeURIComponent(String(email).trim().toLowerCase())}`,
      { method: 'PUT', body: patch }
    );
    return response.ok;
  } catch (error) {
    console.warn('cloudPatchProfile failed:', error.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Q&A
// ---------------------------------------------------------------------------

export async function cloudCreateQuestion(userId, question, name, avatar) {
  try {
    const response = await cloudFetch('/api/posts', {
      method: 'POST',
      body: { userId, question, name, avatar },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.postId || null;
  } catch (error) {
    console.warn('cloudCreateQuestion failed:', error.message);
    return null;
  }
}

export async function cloudCreateAnswer(postId, userId, text, name, avatar) {
  try {
    const response = await cloudFetch(`/api/posts/${encodeURIComponent(postId)}/contributions`, {
      method: 'POST',
      body: { userId, text, name, avatar },
    });
    return response.ok;
  } catch (error) {
    console.warn('cloudCreateAnswer failed:', error.message);
    return false;
  }
}

export async function cloudFetchQAFeed(limit = 50) {
  try {
    const response = await cloudFetch(`/api/qa/feed?limit=${limit}`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.items || [];
  } catch (error) {
    console.warn('cloudFetchQAFeed failed:', error.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Community
// ---------------------------------------------------------------------------

export async function cloudCreatePost(postId, userId, name, text, avatar, mediaType, mediaUri) {
  try {
    const response = await cloudFetch('/api/community/posts', {
      method: 'POST',
      body: { postId, userId, name, avatar, text, mediaType, mediaUri },
    });
    return response.ok;
  } catch (error) {
    console.warn('cloudCreatePost failed:', error.message);
    return false;
  }
}

export async function cloudCreateComment(postId, commentId, userId, text, name, avatar) {
  try {
    const response = await cloudFetch(
      `/api/community/posts/${encodeURIComponent(postId)}/comments`,
      { method: 'POST', body: { commentId, userId, text, name, avatar } }
    );
    return response.ok;
  } catch (error) {
    console.warn('cloudCreateComment failed:', error.message);
    return false;
  }
}

export async function cloudFetchCommunityFeed(limit = 50) {
  try {
    const response = await cloudFetch(`/api/community/feed?limit=${limit}`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.items || [];
  } catch (error) {
    console.warn('cloudFetchCommunityFeed failed:', error.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Profile directory
// ---------------------------------------------------------------------------

export async function cloudUpdateDirectoryEntry(email, entry) {
  try {
    await cloudPatchProfile(email, {
      profileDirectory: JSON.stringify(entry),
    });
    return true;
  } catch (error) {
    console.warn('cloudUpdateDirectoryEntry failed:', error.message);
    return false;
  }
}
