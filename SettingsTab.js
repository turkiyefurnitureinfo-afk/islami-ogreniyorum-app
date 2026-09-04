import React, { useState } from 'react';
import { ScrollView, View, Text, Pressable, Switch, TextInput, Modal, Alert, Linking, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { PRIVACY_POLICY_URL, SUPPORT_EMAIL } from './config.js';
import { clearAccount, clearAllData, saveProfile as persistProfile, loadProfile, saveAccount, saveProfileForEmail, loadProfileForEmail } from './storage.js';
import { registerUserProfile, updateServerUser } from './notifications.js';
import { cloudSaveProfile } from './cloudSync.js';
import {
  isFirebaseConfigured,
  firebaseUpdatePassword,
  firebaseUpdateEmail,
  firebaseUpdateProfile,
  firebaseReauthenticate,
  firebaseSignOut,
  friendlyFirebaseError,
} from './firebaseAuth.js';
import { uploadProfileImage } from './mediaService.js';
import { useCachedAvatar } from './avatarCache.js';

// Avatar for the Edit Profile modal: renders from the on-disk cache first so
// the picture still shows offline; a neutral placeholder shows when the
// remote load fails while uncached; the emoji only appears when no picture
// exists at all.
function ModalAvatar({ url, fallback, style }) {
  const cached = useCachedAvatar(url);
  const src = cached || url;
  const [errored, setErrored] = useState(false);
  if (src) {
    if (errored) setErrored(false);
    return (
      <Image
        source={{ uri: src }}
        style={style}
        onError={() => setErrored(true)}
      />
    );
  }
  // No source at all (genuinely no avatar) → emoji fallback.
  if (!url) {
    return <Text style={style}>{fallback}</Text>;
  }
  // URL exists but the image failed to load (offline + uncached) → neutral
  // placeholder, NOT the emoji. The emoji is reserved for "no picture at all".
  return (
    <View style={style}>
      <Text style={{ fontSize: 16, opacity: 0.4 }}>👤</Text>
    </View>
  );
}

const SettingsTab = ({ styles, t, theme, setTheme, language, setLanguage, notificationsOn, setNotificationsOn, soundOptions, notificationSound, setNotificationSound, prayerMethod, setPrayerMethod, prayerSourceLabel, account, setAccount, saveAccount, isGoogleUser, setSignedIn, profilePicture, setProfilePicture }) => {
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
  const [draftOccupation, setDraftOccupation] = useState('');
  const [draftAddress, setDraftAddress] = useState('');
  const [draftBio, setDraftBio] = useState('');
  const [draftCurrentPassword, setDraftCurrentPassword] = useState('');
  const [draftNewPassword, setDraftNewPassword] = useState('');
  const [draftConfirmPassword, setDraftConfirmPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const openProfile = async () => {
    setDraftName(account.fullName || '');
    setDraftEmail(account.email || '');
    setErrorMsg('');
    setProfileModalOpen(true);
    // Pre-fill the signup fields (occupation/address/bio) from the PER-EMAIL
    // profile record so Edit Profile shows exactly what was saved at signup.
    const emailKey = account.email || '';
    if (emailKey) {
      try {
        const prof = (await loadProfileForEmail(emailKey)) || {};
        setDraftOccupation(prof.occupation || '');
        setDraftAddress(prof.address || '');
        setDraftBio(prof.bio || '');
        if (prof.fullName && !account.fullName) setDraftName(prof.fullName);
      } catch {
        setDraftOccupation('');
        setDraftAddress('');
        setDraftBio('');
      }
    }
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

  // ---- Profile picture (Edit Profile) ----
  const [pickerOpen, setPickerOpen] = useState(false);

  // Pick a new profile picture from the device gallery (same flow as the
  // ProfileSetupScreen so the UX is consistent across the app).
  const pickProfilePicture = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        await changeProfilePicture(result.assets[0].uri);
      }
    } catch (error) {
      console.warn('Profile picture pick failed:', error?.message || error);
    }
  };

  // Capture a new profile picture with the camera.
  const takeProfilePicture = async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (permission && permission.status !== 'granted') return;
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        await changeProfilePicture(result.assets[0].uri);
      }
    } catch (error) {
      console.warn('Profile picture capture failed:', error?.message || error);
    }
  };

  // Remove the current picture (reverts to the placeholder avatar).
  const removeProfilePicture = async () => {
    await changeProfilePicture('');
  };

  // Persist the chosen picture: local state + AsyncStorage + the backend
  // (so the avatar survives reinstalls, mirroring the profile-save flow).
  // NOTE: persistProfile is storage.js's saveProfile — the component's own
  // saveProfile() function below would otherwise shadow the import.
  const changeProfilePicture = async (uri) => {
    // Mirror a device-local picture to Firebase Storage first (best-effort) so
    // the stored value is a permanent https:// URL that renders on every
    // device — a bare file:// path would be invisible to everyone else and
    // break for the author too once Android clears the picker's cache.
    let finalUri = uri;
    if (finalUri && /^file:/i.test(finalUri)) {
      try {
        finalUri = (await uploadProfileImage(finalUri)) || finalUri;
      } catch (_e) {
        // Offline / Storage unavailable — keep the local file; the on-disk
        // avatar cache keeps it rendering on this device.
      }
    }
    setProfilePicture(finalUri);
    try {
      const savedProfile = (await loadProfile()) || {};
      await persistProfile({ ...savedProfile, profilePicture: finalUri });
    } catch {}
    // Also update the account with the profile picture so it persists across sessions
    const updatedAccount = { ...account, profilePicture: finalUri || '' };
    setAccount(updatedAccount);
    saveAccount(updatedAccount);
    updateServerUser(account.email, { profilePicture: finalUri || '' }).catch(() => {});
    Alert.alert(getTranslation('profileUpdated', 'Your profile has been updated successfully.'));
  };

  const saveProfile = async () => {
    if (!draftName.trim()) {
      setErrorMsg(getTranslation('enterYourName', 'Please enter a valid name.'));
      return;
    }
    const email = draftEmail.trim();
    if (!email || !email.includes('@')) {
      setErrorMsg(getTranslation('enterYourEmail', 'Please enter a valid email address.'));
      return;
    }
    const updated = { ...account, fullName: draftName.trim(), email, profilePicture: profilePicture || account.profilePicture };
    setAccount(updated);
    saveAccount(updated);

    // Persist the FULL signup profile PER EMAIL (occupation/address/bio
    // included) so Edit Profile pre-fills next time and the data survives
    // reinstalls. Keyed by the account's email, exactly as at signup.
    try {
      const emailKey = account.email || email;
      const existing = (await loadProfileForEmail(emailKey)) || {};
      await saveProfileForEmail(emailKey, {
        ...existing,
        fullName: updated.fullName,
        email,
        profilePicture: updated.profilePicture || '',
        occupation: draftOccupation.trim(),
        address: draftAddress.trim(),
        bio: draftBio.trim(),
      });
    } catch {}

    // Also save the full profile data (occupation, address, bio, profilePicture) to profile storage
    try {
      const savedProfile = (await loadProfile()) || {};
      await persistProfile({
        ...savedProfile,
        profilePicture: profilePicture || savedProfile.profilePicture,
      });
    } catch {}

    setProfileModalOpen(false);
    Alert.alert(getTranslation('profileUpdated', 'Your profile has been updated successfully.'));

    // Update the Firebase display name and photo URL (best-effort).
    if (isFirebaseConfigured()) {
      firebaseUpdateProfile(updated.fullName, updated.profilePicture || undefined).catch(() => {});
    }
    // Best-effort sync to the backend so the change survives reinstalls.
    updateServerUser(account.email || email, {
      fullName: updated.fullName,
      email,
      profilePicture: updated.profilePicture || '',
      occupation: draftOccupation.trim(),
      address: draftAddress.trim(),
      bio: draftBio.trim(),
    }).catch(() => {});

    // CLOUD: authoritative write so the edit survives logout / uninstall.
    try {
      cloudSaveProfile(account.email || email, updated.fullName, updated.profilePicture, {
        occupation: draftOccupation.trim(),
        address: draftAddress.trim(),
        bio: draftBio.trim(),
      });
    } catch (_e) { /* best-effort */ }
  };

  const saveEmail = () => {
    const email = draftEmail.trim();
    if (!email || !email.includes('@')) {
      setErrorMsg(getTranslation('enterYourEmail', 'Please enter a valid email address.'));
      return;
    }
    // Update the Firebase account email (requires a still-fresh session).
    if (isFirebaseConfigured()) {
      firebaseUpdateEmail(email)
        .then(() => {
          const updated = { ...account, email };
          setAccount(updated);
          saveAccount(updated);
          setEmailModalOpen(false);
          Alert.alert(getTranslation('emailUpdated', 'Your email address has been updated successfully.'));
          // Move the server record to the new email (best-effort).
          updateServerUser(account.email, { email, fullName: updated.fullName }).catch(() => {});
        })
        .catch((error) => {
          setErrorMsg(friendlyFirebaseError(error, language || 'tr'));
        });
    } else {
      const updated = { ...account, email };
      setAccount(updated);
      saveAccount(updated);
      setEmailModalOpen(false);
      Alert.alert(getTranslation('emailUpdated', 'Your email address has been updated successfully.'));
      updateServerUser(account.email, { email, fullName: updated.fullName }).catch(() => {});
    }
  };

  const savePassword = async () => {
    // For Google users, there's no password to change.
    if (isGoogleUser) {
      setErrorMsg(getTranslation('passwordNotAvailableForGoogle', 'Password changes are not available for Google accounts.'));
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
    // Update the password with Firebase (best-effort; requires a fresh session).
    if (isFirebaseConfigured()) {
      if (!draftCurrentPassword) {
        setErrorMsg(getTranslation('currentPasswordWrong', 'The current password is incorrect.'));
        return;
      }
      try {
        // Firebase requires re-auth before changing the password.
        await firebaseReauthenticate(account.email, draftCurrentPassword);
        await firebaseUpdatePassword(draftNewPassword);
        const updated = { ...account, password: '' };
        setAccount(updated);
        saveAccount(updated);
        setPasswordModalOpen(false);
        Alert.alert(getTranslation('passwordChanged', 'Your password has been updated successfully.'));
      } catch (error) {
        setErrorMsg(friendlyFirebaseError(error, language || 'tr'));
      }
      return;
    }
    // Firebase not configured — cannot securely change the password.
    setErrorMsg(
      getTranslation('passwordNotAvailableForGoogle', 'Firebase must be configured to change your password.')
    );
    return;
  };

  const handleLogout = () => {
    // Sign out of Firebase too (no-op when Firebase isn't configured), then
    // clear the locally cached account so the next launch shows the auth
    // screen instead of restoring the signed-in state.
    if (isFirebaseConfigured()) {
      firebaseSignOut().catch(() => {});
    }
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
          <ScrollView contentContainerStyle={styles.modalScroll}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{getTranslation('editProfileTitle', 'Edit Profile')}</Text>
            <Text style={styles.modalMessage}>{getTranslation('editProfileMessage', 'Update your account information below.')}</Text>

            {/* ---- Profile picture (Edit Profile) ---- */}
          <Pressable
            onPress={() => (profilePicture ? setPickerOpen(true) : pickProfilePicture())}
            style={styles.profilePictureButton}
          >
            {profilePicture ? (
              <ModalAvatar
                url={profilePicture}
                fallback="👤"
                style={[styles.profilePicture, styles.modalProfilePicture]}
              />
            ) : (
              <View style={[styles.profilePicturePlaceholder, styles.modalProfilePicturePlaceholder]}>
                <Text style={styles.profilePicturePlaceholderText}>📷</Text>
              </View>
            )}
          </Pressable>
          <Text style={styles.profilePictureHint}>
            {profilePicture
              ? getTranslation('tapToChangePicture', 'Tap to change your profile picture')
              : getTranslation('tapToAddPicture', 'Tap to add a profile picture')}
          </Text>

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

            <Text style={styles.label}>{getTranslation('occupation', 'Occupation')}</Text>
            <TextInput
              value={draftOccupation}
              onChangeText={setDraftOccupation}
              placeholder={getTranslation('occupationPlaceholder', 'e.g., Student, Engineer')}
              placeholderTextColor="#8ea4b3"
              style={styles.input}
            />

            <Text style={styles.label}>{getTranslation('addressOptional', 'Address (Optional)')}</Text>
            <TextInput
              value={draftAddress}
              onChangeText={setDraftAddress}
              placeholder={getTranslation('addressPlaceholder', 'City, Country')}
              placeholderTextColor="#8ea4b3"
              style={styles.input}
            />

            <Text style={styles.label}>{getTranslation('aboutMe', 'About Me')}</Text>
            <TextInput
              value={draftBio}
              onChangeText={setDraftBio}
              placeholder={getTranslation('aboutMePlaceholder', 'Tell us about yourself...')}
              placeholderTextColor="#8ea4b3"
              style={[styles.input, styles.bioInput]}
              multiline
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
          </ScrollView>
        </View>
      </Modal>

      {/* ---- Change Email Modal ---- */}
      <Modal visible={emailModalOpen} transparent animationType="fade" onRequestClose={() => setEmailModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <ScrollView contentContainerStyle={styles.modalScroll}>
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
          </ScrollView>
        </View>
      </Modal>

      {/* ---- Change Password Modal ---- */}
      <Modal visible={passwordModalOpen} transparent animationType="fade" onRequestClose={() => setPasswordModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <ScrollView contentContainerStyle={styles.modalScroll}>
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
          </ScrollView>
        </View>
      </Modal>

      {/* ---- Profile Picture Source Modal ---- */}
      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.modalBackdrop}>
          <ScrollView contentContainerStyle={styles.modalScroll}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{getTranslation('profilePictureTitle', 'Profile Picture')}</Text>
            <Text style={styles.modalMessage}>{getTranslation('profilePictureMessage', 'Choose a source for your new profile picture.')}</Text>

            <View style={styles.modalButtonRow}>
              <Pressable
                style={styles.modalCancelButton}
                onPress={() => { setPickerOpen(false); pickProfilePicture(); }}
              >
                <Text style={styles.modalCancelButtonText}>🖼 {getTranslation('chooseFromGallery', 'Gallery')}</Text>
              </Pressable>
              <Pressable
                style={styles.modalCancelButton}
                onPress={() => { setPickerOpen(false); takeProfilePicture(); }}
              >
                <Text style={styles.modalCancelButtonText}>📷 {getTranslation('takePhoto', 'Camera')}</Text>
              </Pressable>
            </View>
            <View style={styles.modalButtonRow}>
              <Pressable
                style={styles.modalCancelButton}
                onPress={() => { setPickerOpen(false); removeProfilePicture(); }}
              >
                <Text style={[styles.modalCancelButtonText, { color: '#e05d5d' }]}>
                  {getTranslation('removePicture', 'Remove Picture')}
                </Text>
              </Pressable>
              <Pressable style={styles.modalCancelButton} onPress={() => setPickerOpen(false)}>
                <Text style={styles.modalCancelButtonText}>{getTranslation('cancel', 'Cancel')}</Text>
              </Pressable>
            </View>
          </View>
          </ScrollView>
        </View>
      </Modal>

    </ScrollView>
  );
};

export default SettingsTab;
