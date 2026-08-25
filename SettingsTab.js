import React from 'react';
import { ScrollView, View, Text, Pressable, Switch, Linking } from 'react-native';
import { PRIVACY_POLICY_URL, SUPPORT_EMAIL } from './config.js';
import { clearAccount, clearAllData } from './storage.js';

const SettingsTab = ({ styles, t, theme, setTheme, language, setLanguage, notificationsOn, setNotificationsOn, soundOptions, notificationSound, setNotificationSound, account, setSignedIn }) => {
  // Helper function to safely get translations with a fallback
  const getTranslation = (key, fallback = '') => (t && t[key] !== undefined ? t[key] : fallback);

  const handleLogout = () => {
    clearAccount();
    setSignedIn(false);
  };

  const handleDeleteAccount = () => {
    // Clear all local data and sign out
    clearAllData();
    setSignedIn(false);
  };

  return (
    <ScrollView contentContainerStyle={styles.contentPadding}>
      <View style={styles.settingCard}>
        <View style={styles.settingHeader}>
          <Text style={styles.settingTitle}>{getTranslation('appearance', 'Appearance')}</Text>
          <Text style={styles.settingValue}>{getTranslation('mode', 'Mode')}</Text>
        </View>

        <View style={styles.buttonRow}>
          <Pressable
            onPress={() => setTheme('light')}
            style={[styles.modeButton, theme === 'light' && styles.modeButtonActive]}
          >
            <Text style={styles.modeButtonText}>☀️ {getTranslation('light', 'Light')}</Text>
          </Pressable>

          <Pressable
            onPress={() => setTheme('dark')}
            style={[styles.modeButton, theme === 'dark' && styles.modeButtonActive]}
          >
            <Text style={styles.modeButtonText}>🌙 {getTranslation('dark', 'Dark')}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.settingCard}>
        <View style={styles.settingHeader}>
          <Text style={styles.settingTitle}>{getTranslation('language', 'Language')}</Text>
          <Text style={styles.settingValue}>{getTranslation('languageLabel', 'Language selection')}</Text>
        </View>

        <View style={styles.buttonRow}>
          <Pressable
            onPress={() => setLanguage('tr')}
            style={[styles.modeButton, language === 'tr' && styles.modeButtonActive]}
          >
            <Text style={styles.modeButtonText}>{getTranslation('turkish', 'Turkish')}</Text>
          </Pressable>

          <Pressable
            onPress={() => setLanguage('en')}
            style={[styles.modeButton, language === 'en' && styles.modeButtonActive]}
          >
            <Text style={styles.modeButtonText}>{getTranslation('english', 'English')}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.settingCard}>
        <View style={styles.settingHeader}>
          <Text style={styles.settingTitle}>{getTranslation('notifications', 'Notifications')}</Text>
          <Switch value={notificationsOn} onValueChange={setNotificationsOn} />
        </View>

        <View style={styles.soundList}>
          {soundOptions.map((sound) => (
            <Pressable key={sound} onPress={() => setNotificationSound(sound)} style={[styles.soundItem, notificationSound === sound && styles.soundItemActive]}>
              <Text style={styles.soundText}>{sound}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.settingValue}>{getTranslation('selectedSound', 'Selected Sound')}: {notificationSound}</Text>
      </View>

      <View style={styles.settingCard}>
        <View style={styles.accountRow}>
          <Text style={styles.accountIcon}>🛡️</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.settingTitle}>{getTranslation('account', 'Account')}</Text>
            <Text style={styles.accountName}>{account.fullName || getTranslation('muslimUser', 'Muslim User')}</Text>
          </View>
          <Pressable onPress={handleLogout}><Text style={styles.logoutButtonText}>{getTranslation('logout', 'Logout')}</Text></Pressable>
        </View>
        <Pressable style={styles.settingRow}><Text style={styles.settingRowText}>{getTranslation('editProfile', 'Edit Profile')}</Text><Text style={styles.arrow}>›</Text></Pressable>
        <Pressable style={styles.settingRow}><Text style={styles.settingRowText}>{getTranslation('changeEmail', 'Change Email')}</Text><Text style={styles.arrow}>›</Text></Pressable>
        <Pressable style={styles.settingRow}><Text style={styles.settingRowText}>{getTranslation('changePassword', 'Change Password')}</Text><Text style={styles.arrow}>›</Text></Pressable>
      </View>

      {/* Privacy & Legal */}
      <View style={styles.settingCard}>
        <View style={styles.settingHeader}>
          <Text style={styles.settingTitle}>{getTranslation('privacyLegal', 'Privacy & Legal')}</Text>
        </View>
        <Pressable style={styles.settingRow} onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}>
          <Text style={styles.settingRowText}>{getTranslation('privacyPolicy', 'Privacy Policy')}</Text>
          <Text style={styles.arrow}>›</Text>
        </Pressable>
        <Pressable style={styles.settingRow} onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}>
          <Text style={styles.settingRowText}>{getTranslation('contactSupport', 'Contact Support')}</Text>
          <Text style={styles.arrow}>›</Text>
        </Pressable>
      </View>

      {/* Danger Zone */}
      <View style={styles.settingCard}>
        <View style={styles.settingHeader}>
          <Text style={[styles.settingTitle, { color: '#e05d5d' }]}>{getTranslation('dangerZone', 'Danger Zone')}</Text>
        </View>
        <Pressable style={styles.settingRow} onPress={handleDeleteAccount}>
          <Text style={[styles.settingRowText, { color: '#e05d5d' }]}>{getTranslation('deleteAccount', 'Delete Account')}</Text>
          <Text style={styles.arrow}>›</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
};

export default SettingsTab;