import AsyncStorage from '@react-native-async-storage/async-storage';

// Storage keys
// =============
// The storage split is now:
//   PHONE ONLY (AsyncStorage): settings, prayerAlarms, welcomeShown,
//     deletedItems, profileDirectory (cache), qanda/community (offline cache)
//   CLOUD (backend): user account, profile (occupation/address/bio/picture),
//     Q&A content, community content
//
// Q&A and community posts are kept on the phone as a FAST OFFLINE CACHE so
// the feed renders instantly on launch. The cloud copy (written via
// cloudSync.js) is authoritative and survives logout / uninstall.
const KEYS = {
  ACCOUNT: '@app/account',
  PROFILE: '@app/profile',
  SETTINGS: '@app/settings',
  WELCOME_SHOWN: '@app/welcome_shown',
  QANDA: '@app/qanda',
  COMMUNITY: '@app/community',
  DELETED_ITEMS: '@app/deleted_items',
  PROFILE_DIRECTORY: '@app/profile_directory',
};

/**
 * Save the user's account data (email, name, etc.)
 */
export async function saveAccount(account) {
  try {
    await AsyncStorage.setItem(KEYS.ACCOUNT, JSON.stringify(account));
  } catch (error) {
    console.error('Failed to save account:', error);
  }
}

/**
 * Load the user's account data.
 * @returns {Promise<object|null>}
 */
export async function loadAccount() {
  try {
    const raw = await AsyncStorage.getItem(KEYS.ACCOUNT);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error('Failed to load account:', error);
    return null;
  }
}

/**
 * Clear the user's account data (used on logout / account deletion).
 */
export async function clearAccount() {
  try {
    await AsyncStorage.removeItem(KEYS.ACCOUNT);
  } catch (error) {
    console.error('Failed to clear account:', error);
  }
}

/**
 * Save profile setup data (occupation, address, bio, profile picture).
 */
export async function saveProfile(profile) {
  try {
    await AsyncStorage.setItem(KEYS.PROFILE, JSON.stringify(profile));
  } catch (error) {
    console.error('Failed to save profile:', error);
  }
}

/**
 * Load profile setup data.
 * @returns {Promise<object|null>}
 */
export async function loadProfile() {
  try {
    const raw = await AsyncStorage.getItem(KEYS.PROFILE);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error('Failed to load profile:', error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-email profile storage — occupation / address / bio / picture are kept
// under "@app/profile:<email>" so multiple accounts on one device each get
// their own profile (the legacy single-key PROFILE remains as a fallback for
// data written by older builds).
// ---------------------------------------------------------------------------

const profileKeyFor = (email) => `${KEYS.PROFILE}:${String(email || '').trim().toLowerCase()}`;

/**
 * Save profile setup data for a specific account email.
 * @param {string} email - the account's email (storage key)
 * @param {object} profile - { occupation, address, bio, profilePicture }
 */
export async function saveProfileForEmail(email, profile) {
  try {
    await AsyncStorage.setItem(profileKeyFor(email), JSON.stringify(profile || {}));
  } catch (error) {
    console.error('Failed to save profile for email:', error);
  }
}

/**
 * Load profile setup data for a specific account email. Falls back to the
 * legacy single-profile record when no per-email entry exists yet (migration).
 * @param {string} email - the account's email (storage key)
 * @returns {Promise<object|null>}
 */
export async function loadProfileForEmail(email) {
  try {
    const raw = await AsyncStorage.getItem(profileKeyFor(email));
    if (raw) return JSON.parse(raw);
    // Migration: return the legacy profile (if any) without removing it.
    return await loadProfile();
  } catch (error) {
    console.error('Failed to load profile for email:', error);
    return null;
  }
}

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
 * Save deleted item IDs so deletions survive app restarts.
 * @param {Set<string>} deletedIds
 */
export async function saveDeletedItems(deletedIds) {
  try {
    await AsyncStorage.setItem(KEYS.DELETED_ITEMS, JSON.stringify([...deletedIds]));
  } catch (error) {
    console.error('Failed to save deleted items:', error);
  }
}

/**
 * Load deleted item IDs.
 * @returns {Promise<Set<string>>}
 */
export async function loadDeletedItems() {
  try {
    const raw = await AsyncStorage.getItem(KEYS.DELETED_ITEMS);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch (error) {
    console.error('Failed to load deleted items:', error);
    return new Set();
  }
}

/**
 * Clear all app data (used for account deletion).
 */
export async function clearAllData() {
  try {
    await AsyncStorage.multiRemove([
      KEYS.ACCOUNT,
      KEYS.PROFILE,
      KEYS.SETTINGS,
      KEYS.WELCOME_SHOWN,
      KEYS.QANDA,
      KEYS.COMMUNITY,
      KEYS.DELETED_ITEMS,
      KEYS.PROFILE_DIRECTORY,
    ]);
  } catch (error) {
    console.error('Failed to clear all data:', error);
  }
}