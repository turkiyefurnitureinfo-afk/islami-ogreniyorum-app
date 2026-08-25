import React from 'react';
import { SafeAreaView, View, Text, TextInput, Pressable, Image } from 'react-native';
import { StatusBar } from 'expo-status-bar';

const AuthScreen = ({ styles, t, authMode, setAuthMode, account, setAccount, handleAuthAction, handleGoogleSignIn }) => {
  // Helper function to safely get translations with a fallback
  const getTranslation = (key, fallback = '') => (t && t[key] !== undefined ? t[key] : fallback);

  return (
    <SafeAreaView style={styles.authScreen}>
      <StatusBar style="light" />
      <View style={styles.authCard}>
        <View style={styles.logoCircle}>
          <Image source={require('./assets/icon.png')} style={{ width: 56, height: 56, borderRadius: 28 }} />
        </View>
        
        <Text style={styles.welcomeLabel}>{getTranslation('welcome', 'Welcome')}</Text>
        <Text style={styles.appTitle}>İslamı öğreniyorum</Text>
        <Text style={styles.subtitle}>
          {authMode === 'signup' ? getTranslation('subtitleSignUp', 'Create your account') : getTranslation('subtitleLogin', 'Sign in to your account')}
        </Text>
        <Text style={styles.communityNote}>
          {getTranslation('communityNote', 'Join the community')}
        </Text>

        <View style={styles.authToggleRow}>
          <Pressable
            onPress={() => setAuthMode('signup')}
            style={[styles.authModeButton, authMode === 'signup' && styles.authModeButtonActive]}
          >
            <Text style={[styles.authModeText, authMode === 'signup' && styles.authModeTextActive]}>{getTranslation('signup', 'Sign Up')}</Text>
          </Pressable>
          <Pressable
            onPress={() => setAuthMode('login')}
            style={[styles.authModeButton, authMode === 'login' && styles.authModeButtonActive]}
          >
            <Text style={[styles.authModeText, authMode === 'login' && styles.authModeTextActive]}>{getTranslation('login', 'Login')}</Text>
          </Pressable>
        </View>

        <View style={styles.formBox}>
          {authMode === 'signup' && (
            <React.Fragment key="signup-fullname">
              <Text style={styles.label}>{getTranslation('fullName', 'Full Name')}</Text>
              <TextInput
                value={account.fullName}
                onChangeText={(text) => setAccount({ ...account, fullName: text })}
                placeholder={getTranslation('yourNamePlaceholder', 'Your name')}
                placeholderTextColor="#8ea4b3"
                style={styles.input}
              />
            </React.Fragment>
          )}

          <Text style={styles.label}>{getTranslation('email', 'Email')}</Text>
          <TextInput
            value={account.email}
            onChangeText={(text) => setAccount({ ...account, email: text })}
            keyboardType="email-address"
            placeholder={getTranslation('emailPlaceholder', 'example@email.com')}
            placeholderTextColor="#8ea4b3"
            style={styles.input}
          />

          <Text style={styles.label}>{getTranslation('password', 'Password')}</Text>
          <TextInput
            value={account.password}
            onChangeText={(text) => setAccount({ ...account, password: text })}
            secureTextEntry
            placeholder={authMode === 'signup' ? getTranslation('passwordSignUp', 'Create password') : getTranslation('passwordLogin', 'Your password')}
            placeholderTextColor="#8ea4b3"
            style={styles.input}
          />

          <View style={styles.securityRow}>
            <Text style={styles.securityIcon}>✓</Text>
            <Text style={styles.securityText}>
              {authMode === 'signup' ? getTranslation('securitySignUp', 'Secure account') : getTranslation('securityLogin', 'Secure access')}
            </Text>
          </View>

          <Pressable onPress={handleAuthAction} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>
              {authMode === 'signup' ? getTranslation('createAccount', 'Create Account') : getTranslation('doLogin', 'Login')}
            </Text>
          </Pressable>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>{getTranslation('or', 'or')}</Text>
            <View style={styles.dividerLine} />
          </View>

          <Pressable onPress={handleGoogleSignIn} style={styles.googleButton}>
            <Text style={styles.googleButtonText}>
              <Text style={styles.googleBlue}>G</Text><Text style={styles.googleRed}>o</Text><Text style={styles.googleYellow}>o</Text><Text style={styles.googleBlue}>g</Text><Text style={styles.googleGreen}>l</Text><Text style={styles.googleRed}>e</Text> 
              <Text style={styles.googleText}> {getTranslation('google', 'Sign in with Google').replace('Google', '')}</Text>
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
};

export default AuthScreen;