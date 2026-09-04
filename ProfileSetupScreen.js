import React from 'react';
import { ScrollView, View, Text, TextInput, Pressable, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';

const ProfileSetupScreen = ({ styles, palette, t, account, setAccount, occupation, setOccupation, address, setAddress, bio, setBio, handleProfileSetupComplete, theme, profilePicture, setProfilePicture, isGoogleUser }) => {
  // Helper function to safely get translations with a fallback
  const getTranslation = (key, fallback = '') => (t && t[key] !== undefined ? t[key] : fallback);

  // Pick a profile picture from the device gallery
  const pickProfilePicture = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      setProfilePicture(result.assets[0].uri);
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.page }]}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <ScrollView contentContainerStyle={[styles.contentPadding, { paddingBottom: 48 }]}>
        <View style={styles.setupCard}>
          <Text style={styles.mainTitle}>{getTranslation('completeYourProfile', 'Complete Your Profile')}</Text>
          <Text style={styles.subtitle}>{getTranslation('canChangeLater', 'You can change this information later in Settings.')}</Text>

          {/* Profile Picture */}
          <Pressable onPress={pickProfilePicture} style={styles.profilePictureButton}>
            {profilePicture ? (
              <Image source={{ uri: profilePicture }} style={styles.profilePicture} />
            ) : (
              <View style={styles.profilePicturePlaceholder}>
                <Text style={styles.profilePicturePlaceholderText}>📷</Text>
              </View>
            )}
          </Pressable>
          <Text style={styles.profilePictureHint}>
            {isGoogleUser
              ? (getTranslation('googleProfilePicture', 'Using your Google profile picture. Tap to change.'))
              : (getTranslation('tapToAddPicture', 'Tap to add a profile picture'))}
          </Text>

          <Text style={styles.label}>{getTranslation('fullName', 'Full Name')}</Text>
          <TextInput
            value={account.fullName}
            onChangeText={(text) => setAccount({ ...account, fullName: text })}
            placeholderTextColor={palette.muted}
            style={styles.input}
          />

          <Text style={styles.label}>{getTranslation('occupation', 'Occupation')}</Text>
          <TextInput
            value={occupation}
            onChangeText={setOccupation}
            placeholder={getTranslation('occupationPlaceholder', 'e.g., Student, Engineer')}
            placeholderTextColor={palette.muted}
            style={styles.input}
          />

          <Text style={styles.label}>{getTranslation('addressOptional', 'Address (Optional)')}</Text>
          <TextInput
            value={address}
            onChangeText={setAddress}
            placeholder={getTranslation('addressPlaceholder', 'City, Country')}
            placeholderTextColor={palette.muted}
            style={styles.input}
          />

          <Text style={styles.label}>{getTranslation('aboutMe', 'About Me')}</Text>
          <TextInput
            value={bio}
            onChangeText={setBio}
            placeholder={getTranslation('aboutMePlaceholder', 'Tell us about yourself...')}
            placeholderTextColor={palette.muted}
            style={[styles.input, styles.bioInput]}
            multiline
          />
        </View>

        <Pressable style={[styles.primaryButton, { marginTop: 10 }, !account.fullName.trim() && styles.disabledButton]} onPress={handleProfileSetupComplete} disabled={!account.fullName.trim()}>
          <Text style={styles.primaryButtonText}>{getTranslation('saveAndContinue', 'Save and Continue')}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
};

export default ProfileSetupScreen;