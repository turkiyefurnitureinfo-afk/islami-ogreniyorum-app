import React, { useState, useEffect } from 'react';
import { ScrollView, View, Text, Pressable, Switch, TextInput, Modal, Alert, Linking, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { PRIVACY_POLICY_URL, SUPPORT_EMAIL } from './config.js';
import { clearAllData, clearAccountCache } from './storage.js';
import { registerUserProfile, updateServerUser, fetchServerUser, cancelAllPrayerNotifications, deleteServerUser } from './notifications.js';
import { cloudSaveProfile } from './cloudSync.js';
import {
  isFirebaseConfigured,
  firebaseUpdatePassword,
  firebaseUpdateEmail,
  firebaseUpdateProfile,
  firebaseReauthenticate,
  firebaseSignOut,
  friendlyFirebaseError,
  firebaseDeleteAccount,
  ensureFreshLogin,
} from './firebaseAuth.js';
import { uploadProfileImage } from './mediaService.js';
import { useCachedAvatar } from './avatarCache.js';
import { signOutGoogle } from './googleAuth.js';
import { ALARM_OFFSET_OPTIONS } from './prayerAlarms.js';
import { fmt } from './utils.js';

// Avatar for the Edit Profile modal: renders from the on-disk cache first so
// the picture still shows offline; a neutral placeholder shows when the
// remote load fails while uncached; the emoji only appears when no picture
// exists at all.
function ModalAvatar({ url, fallback, style }) {
  const cached = useCachedAvatar(url);
  const src = cached || url;
  const [errored, setErrored] = useState(false);
  // Reset the error flag whenever the resolved source changes (e.g. a fresh
  // URL becomes available from the avatar cache) so a stale failure from a
  // previous avatar never hides a newly-available picture. Done in an effect
  // rather than during render to avoid the React "update during render" issue.
  useEffect(() => {
    setErrored(false);
  }, [src]);
  if (src) {
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

const SettingsTab = ({ styles, t, theme, setTheme, language, setLanguage, notificationsOn, setNotificationsOn, soundOptions, notificationSound, setNotificationSound, prayerMethod, setPrayerMethod, prayerSourceLabel, account, setAccount, isGoogleUser, setIsGoogleUser, setSignedIn, profilePicture, setProfilePicture, setOccupation, setAddress, setBio, prayerAlarms, setPrayerAlarms, times }) => {
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
    // Pre-fill the signup fields (occupation/address/bio) from the CLOUD
    // profile so Edit Profile shows the latest saved data.
    const emailKey = account.email || '';
    if (emailKey) {
      try {
        // Fetch profile from cloud server
        const serverUser = await fetchServerUser(emailKey);
        if (serverUser) {
          setDraftOccupation(serverUser.occupation || '');
          setDraftAddress(serverUser.address || '');
          setDraftBio(serverUser.bio || '');
          if (serverUser.fullName && !account.fullName) setDraftName(serverUser.fullName);
        } else {
          setDraftOccupation('');
          setDraftAddress('');
          setDraftBio('');
        }
      } catch {
        // Offline - leave fields empty
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

  // Persist the chosen picture: local state + cloud server
  // (so the avatar survives reinstalls).
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
    // Update account state only (no local storage)
    const updatedAccount = { ...account, profilePicture: finalUri || '' };
    setAccount(updatedAccount);
    // Save to cloud server
    updateServerUser(account.email, { profilePicture: finalUri || '' }).catch(() => {});
    Alert.alert(getTranslation('profileUpdated', 'Your profile has been updated successfully.'));
  };

  const saveProfile = async () => {
    if (!draftName.trim()) {
      setErrorMsg(getTranslation('enterYourName', 'Please enter a valid name.'));
      return;
    }
        const email = draftEmail.trim();
    // Use a regex for proper email validation instead of just checking for '@'
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      setErrorMsg(getTranslation('enterYourEmail', 'Please enter a valid email address.'));
      return;
    }
    const updated = { ...account, fullName: draftName.trim(), email, profilePicture: profilePicture || account.profilePicture };
    setAccount(updated);
    // No local storage save - only cloud

    // Profile data is saved to cloud only
    setProfileModalOpen(false);
    Alert.alert(getTranslation('profileUpdated', 'Your profile has been updated successfully.'));

    // Update the Firebase display name and photo URL (best-effort).
    if (isFirebaseConfigured()) {
      firebaseUpdateProfile(updated.fullName, updated.profilePicture || undefined).catch(() => {});
    }
    // Save to cloud server so the change survives reinstalls.
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
    // Use a regex for proper email validation instead of just checking for '@'
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      setErrorMsg(getTranslation('enterYourEmail', 'Please enter a valid email address.'));
      return;
    }
    // Update the Firebase account email (requires a still-fresh session).
    if (isFirebaseConfigured()) {
      firebaseUpdateEmail(email)
        .then(() => {
          const updated = { ...account, email };
          setAccount(updated);
          // No local storage save - only cloud
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
      // No local storage save - only cloud
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
        // No local storage save - only cloud
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
    // Cancel all pending prayer notifications on sign-out so they don't
    // keep ringing for a user who is no longer signed in.
    cancelAllPrayerNotifications().catch(() => {});
    // Sign out of Firebase too (no-op when Firebase isn't configured).
    // Account data is stored in the cloud, so no need to clear the cloud.
    if (isFirebaseConfigured()) {
      firebaseSignOut().catch(() => {});
    }
    // Also revoke the native Google Sign-In session so the account chooser
    // appears again on the next "Sign in with Google" (otherwise the module
    // silently re-uses the previous Google account).
    signOutGoogle().catch(() => {});
    // Clear account state and clear the local account cache
    clearAccountCache();
    setAccount({ fullName: '', email: '', password: '' });
    setProfilePicture('');
    setSignedIn(false);
    setIsGoogleUser(false);
    setOccupation('');
    setAddress('');
    setBio('');
  };

  // ---- Password re-auth modal state ----------------------------------------
  // Deleting an account is a sensitive Firebase operation that requires a
  // recent login. When the stored session is stale (and for users created
  // before passwords were kept client-side), we surface this modal to collect
  // the password, then re-authenticate before calling user.delete().
  const [reauthModalOpen, setReauthModalOpen] = useState(false);
  const [reauthPassword, setReauthPassword] = useState('');
  const [reauthModalTitle, setReauthModalTitle] = useState({
    title: '',
    message: '',
  });
  const reauthResolverRef = React.useRef(null);

  /**
   * Ask the user for their password via a real modal (Alert.prompt is not
   * available on Android). Resolves the entered password string, or null when
   * the user cancels.
   */
  const promptForPassword = (title, message) =>
    new Promise((resolve) => {
      reauthResolverRef.current = resolve;
      setReauthPassword('');
      setReauthModalTitle({ title, message });
      setReauthModalOpen(true);
    });

  const resolveReauth = (value) => {
    setReauthModalOpen(false);
    const resolver = reauthResolverRef.current;
    reauthResolverRef.current = null;
    if (resolver) resolver(value);
  };

  const handleDeleteAccount = () => {
    // Show confirmation dialog before deletion
    Alert.alert(
      getTranslation('deleteAccountConfirm', 'Delete Account'),
      getTranslation('deleteAccountWarning', 'This will permanently delete your account, all your posts, comments, and data. This action cannot be undone.'),
      [
        { text: getTranslation('cancel', 'Cancel'), style: 'cancel' },
        {
          text: getTranslation('delete', 'Delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              // Cancel all pending notifications before clearing data
              await cancelAllPrayerNotifications();

              // ---------------------------------------------------------
              // SAFETY MODEL (avoids orphaned accounts)
              // Deletion runs in two remote steps that must be ordered:
              //   A) wipe the backend record (posts/comments/devices/user)
              //   B) delete the Firebase Auth account
              // The backend wipe requires a verified ID token, so it can
              // only run while the auth user still exists — B cannot come
              // first. To avoid an orphaned account (backend data with no
              // living owner able to sign in and remove it), step B runs
              // ONLY after step A is CONFIRMED by the server. Any failure
              // in A aborts the flow with the Firebase account intact, so
              // the user can simply retry — nothing is half-deleted.
              // ---------------------------------------------------------

              // ---- Step 0: re-auth IMMEDIATELY before mutating anything --
              // Firebase requires a recent login for user.delete(); asking
              // here (right before execution, after the dialogs) keeps the
              // session maximally fresh. No mutation has happened yet, so
              // an abort at this point is always safe.
              if (isFirebaseConfigured()) {
                let reauth = { ok: false, reason: 'auth/missing-credentials' };
                if (isGoogleUser) {
                  // Google users: try silent re-auth first (refresh token)
                  reauth = await ensureFreshLogin({ isGoogleUser: true });
                  if (!reauth.ok) {
                    // Silent re-auth failed — prompt for Google sign-in again
                    try {
                      const { signInWithGoogle } = require('./googleAuth.js');
                      const googleResult = await signInWithGoogle(language);
                      if (googleResult.success) {
                        reauth = { ok: true };
                      }
                    } catch (googleError) {
                      console.warn('Google re-auth failed:', googleError?.message || googleError);
                    }
                  }
                } else {
                  // Email/password users: always prompt for password since we don't store it locally
                  const creds = await promptForPassword(
                    getTranslation('reauthPasswordTitle', 'Confirm your password'),
                    getTranslation('reauthPasswordMessage', 'Deleting your account is permanent. Please enter your password to continue.')
                  );
                  if (!creds) {
                    return; // user aborted — nothing has been mutated
                  }
                  reauth = await ensureFreshLogin({
                    isGoogleUser: false,
                    email: account.email,
                    password: creds,
                  });
                }
                if (!reauth.ok && !reauth.reason?.includes('no-current-user')) {
                  Alert.alert(
                    getTranslation('error', 'Error'),
                    friendlyFirebaseError({ code: reauth.reason }, language || 'tr')
                  );
                  return;
                }

                // -------------------------------------------------------
                // Step A: wipe backend data (STRICT — hard stop on failure)
                // Throws on network/server failure so we NEVER proceed to
                // deleting the auth account on a partial wipe. A 404 counts
                // as success (no backend record = nothing left to delete).
                // -------------------------------------------------------
                if (account?.email) {
                  try {
                    const wiped = await deleteServerUser(account.email, { strict: true });
                    if (!wiped) {
                      throw new Error('server did not confirm deletion');
                    }
                  } catch (serverError) {
                    // HARD STOP: Firebase account stays intact and signed in.
                    console.error('Backend wipe failed — aborting deletion:', serverError?.message || serverError);
                    Alert.alert(
                      getTranslation('error', 'Error'),
                      getTranslation(
                        'deleteServerWipeFailed',
                        'Your account data could not be deleted from the server. Your Firebase account was kept intact — please check your connection and try again.'
                      )
                    );
                    return;
                  }
                }

                // -------------------------------------------------------
                // Step B: delete the Firebase Auth account.
                // Step A is confirmed, so this cannot orphan backend data.
                // If B fails mid-transit the backend is already clean — the
                // leftover auth account has no data attached and the user is
                // told exactly what happened instead of a generic error.
                // -------------------------------------------------------
                try {
                  await firebaseDeleteAccount();
                } catch (authDeleteError) {
                  console.error('Firebase account deletion failed:', authDeleteError?.message || authDeleteError);
                  // Backend is clean; sign out and clear local data anyway.
                  await firebaseSignOut().catch(() => {});
                  await signOutGoogle().catch(() => {});
                  await clearAllData();
                  setSignedIn(false);
                  setAccount({ fullName: '', email: '', password: '' });
                  setProfilePicture('');
                  setIsGoogleUser(false);
                  Alert.alert(
                    getTranslation('accountDeleted', 'Account Deleted'),
                    getTranslation(
                      'deleteAuthOnlyFailed',
                      'Your account data was deleted. Only the sign-in record could not be removed — please contact support.'
                    )
                  );
                  return;
                }
              } else if (account?.email) {
                // Firebase unavailable — wipe the backend profile only.
                try {
                  const wiped = await deleteServerUser(account.email, { strict: true });
                  if (!wiped) throw new Error('server did not confirm deletion');
                } catch (serverError) {
                  console.error('Backend wipe failed:', serverError?.message || serverError);
                  Alert.alert(
                    getTranslation('error', 'Error'),
                    getTranslation(
                      'deleteServerWipeFailed',
                      'Your account data could not be deleted from the server. Please check your connection and try again.'
                    )
                  );
                  return;
                }
              }

              // Clear all local data
              await clearAllData();

              // Sign out from Firebase (no-op when already deleted)
              if (isFirebaseConfigured()) {
                await firebaseSignOut();
              }

              // Sign out from Google
              await signOutGoogle().catch(() => {});

              // Reset local state
              setSignedIn(false);
              setAccount({ fullName: '', email: '', password: '' });
              setProfilePicture('');
              setIsGoogleUser(false);

              Alert.alert(
                getTranslation('accountDeleted', 'Account Deleted'),
                getTranslation('accountDeletedMessage', 'Your account has been permanently deleted.')
              );
            } catch (error) {
              console.error('Account deletion failed:', error);
              Alert.alert(
                getTranslation('error', 'Error'),
                friendlyFirebaseError(error, language || 'tr')
              );
            }
          },
        },
      ]
    );
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

      {/* ---- Prayer Alarm Settings (visible timers) ---- */}
      <View style={styles.settingCard}>
        <View style={styles.settingHeader}>
          <Text style={styles.settingTitle}>{getTranslation('prayerAlarms', 'Prayer Alarms')}</Text>
          <Text style={styles.settingValue}>{getTranslation('alarmTimers', 'Alarm Timers')}</Text>
        </View>

        {(['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'].map((key) => {
          const entry = (prayerAlarms && prayerAlarms[key]) || null;
          const isSunrise = key === 'sunrise';
          const cfg = entry || { enabled: false, offsetMinutes: 0 };
          const prayerLabel = t && t[key] ? t[key] : key.charAt(0).toUpperCase() + key.slice(1);
          const displayTime = (times && Number.isFinite(times[key])) ? fmt(times[key]) : '--:--';

          return (
            <View key={key} style={styles.alarmRow}>
              <View style={styles.alarmInfo}>
                <Text style={styles.alarmPrayerName}>
                  {isSunrise ? (language === 'tr' ? 'Gün Doğumu' : 'Sunrise') : prayerLabel}
                </Text>
                <Text style={styles.alarmTime}>{displayTime}</Text>
              </View>
              {isSunrise ? (
                <Text style={styles.alarmDisabled}>{getTranslation('displayOnly', 'Display Only')}</Text>
              ) : (
                <View style={styles.alarmControls}>
                  <Switch
                    value={!!cfg.enabled}
                    onValueChange={(v) => setPrayerAlarms((prev) => ({
                      ...prev,
                      [key]: { ...(prev && prev[key]), enabled: v, offsetMinutes: (prev && prev[key] && prev[key].offsetMinutes) || 0 },
                    }))}
                  />
                  {cfg.enabled && (
                    <View style={styles.offsetSelector}>
                      {ALARM_OFFSET_OPTIONS.map((offset) => (
                        <Pressable
                          key={offset}
                          onPress={() => setPrayerAlarms((prev) => ({
                            ...prev,
                            [key]: { ...(prev && prev[key]), enabled: true, offsetMinutes: offset },
                          }))}
                          style={[
                            styles.offsetChip,
                            cfg.offsetMinutes === offset && styles.offsetChipActive,
                          ]}
                        >
                          <Text style={[
                            styles.offsetChipText,
                            cfg.offsetMinutes === offset && styles.offsetChipTextActive,
                          ]}>
                            {offset === 0
                              ? (language === 'tr' ? 'Vaktе' : 'At Time')
                              : offset === 5
                              ? (language === 'tr' ? '5 dk önce' : '5 min before')
                              : offset === 10
                              ? (language === 'tr' ? '10 dk önce' : '10 min before')
                              : offset === 15
                              ? (language === 'tr' ? '15 dk önce' : '15 min before')
                              : offset === 20
                              ? (language === 'tr' ? '20 dk önce' : '20 min before')
                              : offset === 30
                              ? (language === 'tr' ? '30 dk önce' : '30 min before')
                              : offset === 45
                              ? (language === 'tr' ? '45 dk önce' : '45 min before')
                              : (language === 'tr' ? '60 dk önce' : '60 min before')}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
              )}
            </View>
          );
        }))}
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
          <ScrollView style={styles.modalScrollView} contentContainerStyle={styles.modalScroll}>
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
          <ScrollView style={styles.modalScrollView} contentContainerStyle={styles.modalScroll}>
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
          <ScrollView style={styles.modalScrollView} contentContainerStyle={styles.modalScroll}>
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
          <ScrollView style={styles.modalScrollView} contentContainerStyle={styles.modalScroll}>
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

      {/* ---- Password re-auth modal (used by Delete Account) ---------------- */}
      <Modal
        visible={reauthModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => resolveReauth(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{reauthModalTitle.title}</Text>
            <Text style={styles.modalMessage}>{reauthModalTitle.message}</Text>
            <TextInput
              value={reauthPassword}
              onChangeText={setReauthPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={getTranslation('passwordLogin', 'Your password')}
              placeholderTextColor="#8ea4b3"
              style={styles.input}
            />
            <View style={styles.modalButtonRow}>
              <Pressable
                style={styles.modalCancelButton}
                onPress={() => resolveReauth(null)}
              >
                <Text style={styles.modalCancelButtonText}>
                  {getTranslation('cancel', 'Cancel')}
                </Text>
              </Pressable>
              <Pressable
                style={styles.modalButton}
                onPress={() => resolveReauth(reauthPassword || null)}
              >
                <Text style={styles.modalButtonText}>
                  {getTranslation('confirm', 'Confirm')}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

    </ScrollView>
  );
};

export default SettingsTab;
