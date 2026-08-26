import AsyncStorage from '@react-native-async-storage/async-storage';
import bcrypt from 'bcryptjs';

// Number of bcrypt rounds (balances security vs login speed on mobile)
const BCRYPT_ROUNDS = 10;

/**
 * Hash a plaintext password before storage.
 * Google / magic-link users pass null — returned as-is.
 */
export async function hashPassword(password) {
  if (!password) return null;
  return await bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Verify a plaintext password against the stored hash.
 * Returns false if either value is empty.
 */
export async function verifyPassword(password, hash) {
  if (!password || !hash) return false;
  return await bcrypt.compare(password, hash);
}

// Storage keys
const KEYS = {
  ACCOUNT: '@app/account',
  PROFILE: '@app/profile',
  SETTINGS: '@app/settings',
  WELCOME_SHOWN: '@app/welcome_shown',
  QANDA: '@app/qanda',
  COMMUNITY: '@app/community',
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
    ]);
  } catch (error) {
    console.error('Failed to clear all data:', error);
  }
}