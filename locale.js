import { I18nManager, NativeModules, Platform } from 'react-native';

/**
 * Best-effort device locale detection WITHOUT extra native dependencies.
 * @returns {string} e.g. 'tr-TR', 'en-US', 'de-DE'
 */
export function getDeviceLocale() {
  try {
    if (Platform.OS === 'ios') {
      return (
        NativeModules.SettingsManager?.settings?.AppleLocale ||
        NativeModules.SettingsManager?.settings?.AppleLanguages?.[0] ||
        'en'
      );
    }
    if (Platform.OS === 'android') {
      return I18nManager.getConstants().localeIdentifier || 'en';
    }
    // Web
    return (typeof navigator !== 'undefined' && navigator.language) || 'en';
  } catch (e) {
    return 'en';
  }
}

/** Map a device locale to one of the app's supported languages. */
export function localeToLanguage(locale) {
  return (locale || '').toLowerCase().startsWith('tr') ? 'tr' : 'en';
}