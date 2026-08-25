import React from 'react';
import { SafeAreaView, ScrollView, View, Text, Pressable } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { saveWelcomeShown } from './storage.js';

const WelcomeScreen = ({ styles, palette, t, now, account, setWelcomeScreenShown, theme }) => {
  const hour = now.getHours();
  let timeGreeting;
  if (t && t.goodMorning) { // Check if translations and the key are loaded
    if (hour < 12) timeGreeting = t.goodMorning;
    else if (hour < 18) timeGreeting = t.goodAfternoon;
    else timeGreeting = t.goodEvening;
  } else {
    timeGreeting = 'Welcome';
  }

  // Helper function to safely get translations with a fallback
  const getTranslation = (key, fallback = '') => (t && t[key] !== undefined ? t[key] : fallback);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.page }]}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <ScrollView contentContainerStyle={[styles.contentPadding, { justifyContent: 'center', flex: 1 }]}>
        <View style={styles.welcomeCard}>
          <Text style={styles.welcomeGreeting}>
            {getTranslation('greeting', 'Welcome')}
          </Text>
          <Text style={styles.welcomeTimeGreeting}>{timeGreeting}, {account.fullName || getTranslation('guest', 'Guest')}</Text>
          <Text style={styles.welcomeText}>
            {getTranslation('welcomeMessage', 'Welcome to the app!')}
          </Text>
          <View style={styles.featureHighlight}><Text style={styles.featureIcon}>🕌</Text><Text style={styles.featureText}>{getTranslation('featurePrayer', 'Prayer Times')}</Text></View>
          <View style={styles.featureHighlight}><Text style={styles.featureIcon}>🤝</Text><Text style={styles.featureText}>{getTranslation('featureQnA', 'Q&A Section')}</Text></View>
          <View style={styles.featureHighlight}><Text style={styles.featureIcon}>⚙️</Text><Text style={styles.featureText}>{getTranslation('featureSettings', 'Settings')}</Text></View>
          <Pressable style={[styles.primaryButton, { marginTop: 20 }]} onPress={() => { setWelcomeScreenShown(true); saveWelcomeShown(true); }}>
            <Text style={styles.primaryButtonText}>{getTranslation('continueToApp', 'Continue to App')}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

export default WelcomeScreen;