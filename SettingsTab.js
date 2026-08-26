import React, { useState } from 'react';
import { ScrollView, View, Text, Pressable, Switch, TextInput, Modal, Alert, Linking } from 'react-native';
import { PRIVACY_POLICY_URL, SUPPORT_EMAIL } from './config.js';
import { clearAccount, clearAllData, verifyPassword, hashPassword } from './storage.js';

const SettingsTab = ({ styles, t, theme, setTheme, language, setLanguage, notificationsOn, setNotificationsOn, soundOptions, notificationSound, setNotificationSound, prayerMethod, setPrayerMethod, prayerSourceLabel, account, setAccount, saveAccount, isGoogleUser, setSignedIn }) => {
  // Helper function to safely get translations with a fallback
  const getTranslation = (key, fallback = '') => (t && t[key] !== undefined ? t[key] : fallback);

  // Calculation-method chips (labels localized where they have names)
  const PRAYER_METHODS = [
    { key: 'diyanet', label: getTranslation('methodDiyanet', 'Diyanet') },
    { key: 'mwl', label: 'MWL' },
    { key: 'isna', label: 'ISNA' },
    { key: 'egypt', label: getTranslation('methodEgypt', 'Egypt') },
    { key: 'makkah', label: getTranslation('methodMakkah', 'Makkah') },
    { key: 'karachi', label: getTranslation('methodKarachi', 'Karachi') },
  ];

  // ---- Edit Profile / Change Email / Change Password modal state ----
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);

  const [draftName, setDraftName] = useState('');
  const [draftEmail, setDraftEmail] = useState('');
  const [draftCurrentPassword, setDraftCurrentPassword] = useState('');
  const [draftNewPassword, setDraftNewPassword] = useState('');
  const [draftConfirmPassword, setDraftConfirmPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const openProfile = () => {
    setDraftName(account.fullName || '');
    setDraftEmail(account.email || '');
    setErrorMsg('');
    setProfileModalOpen(true);
  };

  const openEmail = () => {
    setDraftEmail(account.email || '');
    setErrorMsg('');
    setEmailModalOpen(true);
  };

  const openPassword = () => {
    setDraftCurrentPassword('');
    setDraftNewPassword('');
    setDraftConfirmPassword('');
    setErrorMsg('');
    setPasswordModalOpen(true);
  };

  const saveProfile = () => {
    if (!draftName.trim()) {
      setErrorMsg(getTranslation('enterYourName', 'Please enter a valid name.'));
      return;
    }
    const email = draftEmail.trim();
    if (!email || !email.includes('@')) {
      setErrorMsg(getTranslation('enterYourEmail', 'Please enter a valid email address.'));
      return;
    }
    const updated = { ...account, fullName: draftName.trim(), email };
    setAccount(updated);
    saveAccount(updated);
    setProfileModalOpen(false);
    Alert.alert(getTranslation('profileUpdated', 'Your profile has been updated successfully.'));
  };

  const saveEmail = () => {
    const email = draftEmail.trim();
    if (!email || !email.includes('@')) {
      setErrorMsg(getTranslation('enterYourEmail', 'Please enter a valid email address.'));
      return;
    }
    const updated = { ...account, email };
    setAccount(updated);
    saveAccount(updated);
    setEmailModalOpen(false);
    Alert.alert(getTranslation('emailUpdated', 'Your email address has been updated successfully.'));
  };

    const savePassword = async () => {
    // For Google users, there's no password to verify
    if (isGoogleUser) {
      setErrorMsg(getTranslation('passwordNotAvailableForGoogle', 'Password changes are not available for Google accounts.'));
      return;
    }
    // Verify current password using bcrypt
    if (!draftCurrentPassword) {
      setErrorMsg(getTranslation('currentPasswordWrong', 'The current password is incorrect.'));
      return;
    }
    const isCurrentValid = await verifyPassword(draftCurrentPassword, account.password);
    if (!isCurrentValid) {
      setErrorMsg(getTranslation('currentPasswordWrong', 'The current password is incorrect.'));
      return;
    }
    if (draftNewPassword.length < 6) {
      setErrorMsg(getTranslation('passwordTooShort', 'Password must be at least 6 characters.'));
      return;
    }
    if (draftNewPassword !== draftConfirmPassword) {
      setErrorMsg(getTranslation('passwordMismatch', 'The new passwords do not match.'));
      return;
    }
    // Hash the new password before storing
    const hashedNewPassword = await hashPassword(draftNewPassword);
    const updated = { ...account, password: hashedNewPassword };
    setAccount(updated);
    saveAccount(updated);
    setPasswordModalOpen(false);
    Alert.alert(getTranslation('passwordChanged', 'Your password has been updated successfully.'));
  };

  const handleLogout = () => {
    clearAccount();
    setSignedIn(false);
  };

  const handleDeleteAccount = () => {
    // Clear all local data and sign out
    clearAllData();
    setSignedIn(false);
  };

  const handleChangeEmailPress = () => {
    if (isGoogleUser) {
      Alert.alert(getTranslation('changeEmailGoogle', 'Email cannot be changed because you signed in with Google.'));
      return;
    }
    openEmail();
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
          <Text style={styles.settingTitle}>{getTranslation('calculationMethod', 'Calculation Method')}</Text>
        </View>

        <View style={styles.soundList}>
          {PRAYER_METHODS.map((m) => (
            <Pressable
              key={m.key}
              onPress={() => setPrayerMethod(m.key)}
              style={[styles.soundItem, prayerMethod === m.key && styles.soundItemActive]}
            >
              <Text style={styles.soundText}>{m.label}</Text>
            </Pressable>
          ))}
        </View>
        {!!prayerSourceLabel && (
          <Text style={styles.settingValue}>{prayerSourceLabel}</Text>
        )}
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
        <Pressable style={styles.settingRow} onPress={openProfile}><Text style={styles.settingRowText}>{getTranslation('editProfile', 'Edit Profile')}</Text><Text style={styles.arrow}>›</Text></Pressable>
        <Pressable style={styles.settingRow} onPress={handleChangeEmailPress}><Text style={styles.settingRowText}>{getTranslation('changeEmail', 'Change Email')}</Text><Text style={styles.arrow}>›</Text></Pressable>
        <Pressable style={styles.settingRow} onPress={openPassword}><Text style={styles.settingRowText}>{getTranslation('changePassword', 'Change Password')}</Text><Text style={styles.arrow}>›</Text></Pressable>
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
    {/* ---- Edit Profile Modal ---- */}
      <Modal visible={profileModalOpen} transparent animationType="fade" onRequestClose={() => setProfileModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{getTranslation('editProfileTitle', 'Edit Profile')}</Text>
            <Text style={styles.modalMessage}>{getTranslation('editProfileMessage', 'Update your account information below.')}</Text>

            <Text style={styles.label}>{getTranslation('fullName', 'Full name')}</Text>
            <TextInput
              value={draftName}
              onChangeText={setDraftName}
              placeholder={getTranslation('yourNamePlaceholder', 'Your name')}
              placeholderTextColor="#8ea4b3"
              style={styles.input}
            />

            <Text style={styles.label}>{getTranslation('email', 'Email')}</Text>
            <TextInput
              value={draftEmail}
              onChangeText={setDraftEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholder={getTranslation('emailPlaceholder', 'example@email.com')}
              placeholderTextColor="#8ea4b3"
              style={styles.input}
            />

            {!!errorMsg && <Text style={styles.modalError}>{errorMsg}</Text>}

            <View style={styles.modalButtonRow}>
              <Pressable style={styles.modalCancelButton} onPress={() => setProfileModalOpen(false)}>
                <Text style={styles.modalCancelButtonText}>{getTranslation('cancel', 'Cancel')}</Text>
              </Pressable>
              <Pressable style={styles.modalButton} onPress={saveProfile}>
                <Text style={styles.modalButtonText}>{getTranslation('save', 'Save')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ---- Change Email Modal ---- */}
      <Modal visible={emailModalOpen} transparent animationType="fade" onRequestClose={() => setEmailModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{getTranslation('changeEmailTitle', 'Change Email')}</Text>
            <Text style={styles.modalMessage}>{getTranslation('changeEmailMessage', 'Enter your new email address.')}</Text>

            <Text style={styles.label}>{getTranslation('newEmail', 'New Email')}</Text>
            <TextInput
              value={draftEmail}
              onChangeText={setDraftEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholder={getTranslation('newEmailPlaceholder', 'new@email.com')}
              placeholderTextColor="#8ea4b3"
              style={styles.input}
            />

            {!!errorMsg && <Text style={styles.modalError}>{errorMsg}</Text>}

            <View style={styles.modalButtonRow}>
              <Pressable style={styles.modalCancelButton} onPress={() => setEmailModalOpen(false)}>
                <Text style={styles.modalCancelButtonText}>{getTranslation('cancel', 'Cancel')}</Text>
              </Pressable>
              <Pressable style={styles.modalButton} onPress={saveEmail}>
                <Text style={styles.modalButtonText}>{getTranslation('save', 'Save')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ---- Change Password Modal ---- */}
      <Modal visible={passwordModalOpen} transparent animationType="fade" onRequestClose={() => setPasswordModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{getTranslation('changePasswordTitle', 'Change Password')}</Text>
            <Text style={styles.modalMessage}>{getTranslation('changePasswordMessage', 'For security, enter your current password, then create your new password.')}</Text>

            <Text style={styles.label}>{getTranslation('currentPassword', 'Current Password')}</Text>
            <TextInput
              value={draftCurrentPassword}
              onChangeText={setDraftCurrentPassword}
              secureTextEntry
              placeholder={getTranslation('passwordLogin', 'Your password')}
              placeholderTextColor="#8ea4b3"
              style={styles.input}
            />

            <Text style={styles.label}>{getTranslation('newPassword', 'New Password')}</Text>
            <TextInput
              value={draftNewPassword}
              onChangeText={setDraftNewPassword}
              secureTextEntry
              placeholder={getTranslation('passwordSignUp', 'Create password')}
              placeholderTextColor="#8ea4b3"
              style={styles.input}
            />

            <Text style={styles.label}>{getTranslation('confirmNewPassword', 'Confirm New Password')}</Text>
            <TextInput
              value={draftConfirmPassword}
              onChangeText={setDraftConfirmPassword}
              secureTextEntry
              placeholder={getTranslation('confirmNewPassword', 'Confirm New Password')}
              placeholderTextColor="#8ea4b3"
              style={styles.input}
            />

            <Text style={styles.passwordRequirement}>{getTranslation('passwordTooShort', 'Password must be at least 6 characters.')}</Text>

            {!!errorMsg && <Text style={styles.modalError}>{errorMsg}</Text>}

            <View style={styles.modalButtonRow}>
              <Pressable style={styles.modalCancelButton} onPress={() => setPasswordModalOpen(false)}>
                <Text style={styles.modalCancelButtonText}>{getTranslation('cancel', 'Cancel')}</Text>
              </Pressable>
              <Pressable style={styles.modalButton} onPress={savePassword}>
                <Text style={styles.modalButtonText}>{getTranslation('save', 'Save')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

    </ScrollView>
  );
};

export default SettingsTab;