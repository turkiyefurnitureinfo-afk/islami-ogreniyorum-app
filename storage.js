import AsyncStorage from '@react-native-async-storage/async-storage';
// Offline ↔ online profile conflict-resolution helpers (pure logic in
// profileSync.js, unit-tested by scripts/test-profile-sync.js).
import { mergeUserProfiles, profileTime, syncProfileToCloud } from './profileSync.js';
export { mergeUserProfiles, profileTime, syncProfileToCloud };

// Storage keys
// =============
// The storage split is now:
//   PHONE ONLY (AsyncStorage): settings, prayerAlarms, welcomeShown,
//     deletedItems, profileDirectory (cache), qanda/community (offline cache),
//     accountCache (local cache of Firebase account for faster startup)
//   CLOUD (backend): user account, profile (occupation/address/bio/picture),
//     Q&A content, community content
//
// Q&A and community posts are kept on the phone as a FAST OFFLINE CACHE so
// the feed renders instantly on launch. The cloud copy (written via
// cloudSync.js) is authoritative and survives logout / uninstall.
//
// IMPORTANT: All data stored in AsyncStorage is LOCAL TO THE PHONE and will be
// automatically wiped when the user uninstalls the app. This is the expected
// behavior - user settings, alarms, and cached data are device-specific.
// User account and profile data stored in the cloud (Firebase + backend server)
// will survive uninstallation and be re-synced when the user logs in again.
//
// Data persistence summary:
//   - Profile data (occupation, address, bio, picture): Cloud (survives uninstall)
//   - Settings (theme, language, notifications, alarms): Phone only (cleared on uninstall)
//   - Q&A tab data: Phone cache + Cloud (cloud survives uninstall)
//   - Community tab data: Phone cache + Cloud (cloud survives uninstall)
//   - Setting tab data: Phone only (cleared on uninstall, re-saved on next login)
//   - Account cache: Phone only (fast startup + offline fallback, re-synced on login)
const KEYS = {
  ACCOUNT_CACHE: '@app/account_cache',  // Local cache of Firebase account (for fast startup)
  SETTINGS: '@app/settings',
  WELCOME_SHOWN: '@app/welcome_shown',
  QANDA: '@app/qanda',
  COMMUNITY: '@app/community',
  PROFILE_DIRECTORY: '@app/profile_directory',
  // Community-post registrations that never reached the backend (offline, or
  // the request timed out while Render cold-started). Retried until they land,
  // so a post the user can see is never silently local-only.
  PENDING_POSTS: '@app/pending_post_registrations',
};

/**
 * Save the user's account data to local cache for fast startup.
 * This is a LOCAL CACHE only - the authoritative account data comes from Firebase Auth.
 * @param {object} account - { email, fullName, profilePicture, uid, authProvider }
 */
export async function saveAccountCache(account) {
  try {
    await AsyncStorage.setItem(KEYS.ACCOUNT_CACHE, JSON.stringify(account));
  } catch (error) {
    console.error('Failed to save account cache:', error);
  }
}

/**
 * Load the cached account data (for fast startup / offline fallback).
 * @returns {Promise<object|null>}
 */
export async function loadAccountCache() {
  try {
    const raw = await AsyncStorage.getItem(KEYS.ACCOUNT_CACHE);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error('Failed to load account cache:', error);
    return null;
  }
}

/**
 * Clear the account cache (used on logout).
 */
export async function clearAccountCache() {
  try {
    await AsyncStorage.removeItem(KEYS.ACCOUNT_CACHE);
  } catch (error) {
    console.error('Failed to clear account cache:', error);
  }
}

// ---------------------------------------------------------------------------
// Profile directory — the best-known profile (name + picture) per email.
// Used so the community feed shows the user's CURRENT profile picture, not the
// one embedded in their (older) posts. Entries are refreshed from the backend
// after feed syncs; the signed-in user's own entry always comes live from
// account state, so their edits reflect instantly everywhere.
//
// Shape: { [email]: { fullName: string, profilePicture: string, fetchedAt: ISO } }
// ---------------------------------------------------------------------------

/**
 * Profile directory — the best-known profile (name + picture) per email.
 *
 * Used so the community feed shows the user's CURRENT profile picture, not the
 * one embedded in their (older) posts. Entries are refreshed from the backend
 * after feed syncs; the signed-in user's own entry always comes live from
 * account state, so their edits reflect instantly everywhere.
 *
 * Shape: { [email]: { fullName: string, profilePicture: string, fetchedAt: ISO } }
 */

/**
 * Save the profile directory.
 * @param {Record<string, {fullName?: string, profilePicture?: string, fetchedAt?: string}>} dir
 */
export async function saveProfileDirectory(dir) {
  try {
    await AsyncStorage.setItem(KEYS.PROFILE_DIRECTORY, JSON.stringify(dir || {}));
  } catch (error) {
    console.error('Failed to save profile directory:', error);
  }
}

/**
 * Load the profile directory.
 * @returns {Promise<Record<string, {fullName?: string, profilePicture?: string, fetchedAt?: string}>>}
 */
export async function loadProfileDirectory() {
  try {
    const raw = await AsyncStorage.getItem(KEYS.PROFILE_DIRECTORY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('Failed to load profile directory:', error);
    return {};
  }
}

/**
 * Save app settings (theme, language, notifications, sound).
 */
export async function saveSettings(settings) {
  try {
    await AsyncStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
  } catch (error) {
    console.error('Failed to save settings:', error);
  }
}

/**
 * Load app settings.
 * @returns {Promise<object|null>}
 */
export async function loadSettings() {
  try {
    const raw = await AsyncStorage.getItem(KEYS.SETTINGS);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error('Failed to load settings:', error);
    return null;
  }
}

/**
 * Save whether the welcome screen has been shown.
 */
export async function saveWelcomeShown(shown) {
  try {
    await AsyncStorage.setItem(KEYS.WELCOME_SHOWN, JSON.stringify(shown));
  } catch (error) {
    console.error('Failed to save welcome state:', error);
  }
}

/**
 * Load whether the welcome screen has been shown.
 * @returns {Promise<boolean>}
 */
export async function loadWelcomeShown() {
  try {
    const raw = await AsyncStorage.getItem(KEYS.WELCOME_SHOWN);
    return raw ? JSON.parse(raw) : false;
  } catch (error) {
    console.error('Failed to load welcome state:', error);
    return false;
  }
}

/**
 * Save the Q&A data for the current language.
 */
export async function saveQAndA(qAndA) {
  try {
    await AsyncStorage.setItem(KEYS.QANDA, JSON.stringify(qAndA));
  } catch (error) {
    console.error('Failed to save Q&A:', error);
  }
}

/**
 * Load the Q&A data.
 * @returns {Promise<Array|null>}
 */
export async function loadQAndA() {
  try {
    const raw = await AsyncStorage.getItem(KEYS.QANDA);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error('Failed to load Q&A:', error);
    return null;
  }
}

/**
 * Save the community posts data for the current language.
 */
export async function saveCommunityPosts(posts) {
  try {
    await AsyncStorage.setItem(KEYS.COMMUNITY, JSON.stringify(posts));
  } catch (error) {
    console.error('Failed to save community posts:', error);
  }
}

/**
 * Load the community posts data.
 * @returns {Promise<Array|null>}
 */
export async function loadCommunityPosts() {
  try {
    const raw = await AsyncStorage.getItem(KEYS.COMMUNITY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error('Failed to load community posts:', error);
    return null;
  }
}

/**
 * Persist community-post registrations that still need to reach the backend.
 *
 * A community post is written to AsyncStorage immediately (so the feed shows it
 * at once), but the matching backend registration can fail: the device is
 * offline, or Render's free tier is cold-starting and the request blows past the
 * caller's timeout. Without this queue such a post stays LOCAL-ONLY forever, so
 * it is visible now and gone after a reinstall.
 *
 * @param {Array<object>} list - pending registration entries
 */
export async function savePendingRegistrations(list) {
  try {
    await AsyncStorage.setItem(
      KEYS.PENDING_POSTS,
      JSON.stringify(Array.isArray(list) ? list : [])
    );
  } catch (error) {
    console.error('Failed to save pending registrations:', error);
  }
}

/**
 * Load community-post registrations still awaiting the backend.
 * @returns {Promise<Array<object>>} empty array when nothing is queued
 */
export async function loadPendingRegistrations() {
  try {
    const raw = await AsyncStorage.getItem(KEYS.PENDING_POSTS);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Failed to load pending registrations:', error);
    return [];
  }
}
export async function clearAllData() {
  try {
    await AsyncStorage.multiRemove([
      KEYS.ACCOUNT_CACHE,
      KEYS.SETTINGS,
      KEYS.WELCOME_SHOWN,
      KEYS.QANDA,
      KEYS.COMMUNITY,
      KEYS.PROFILE_DIRECTORY,
      KEYS.PENDING_POSTS,
    ]);
  } catch (error) {
    console.error('Failed to clear all data:', error);
  }
}