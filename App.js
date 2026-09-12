import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Platform,
  Linking,
  Alert,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  CITIES,
  Q_AND_A,
  PROJECT_EVENTS,
  NEWS_ITEMS,
  SCHOLAR_VIDEOS_FALLBACK,
  SOUND_OPTIONS,
} from './data.js';
import { translations } from './translations.js';
import { computeTimes, formatClock, fetchJsonWithRetry } from './utils.js';
import { sameId, hasRealContent, normalizeServerQA, normalizeServerCommunityPost, mergeQA, mergeCommunityPosts, onlyRealUserPosts } from './feedSync.js';
import { getDeviceLocale, localeToLanguage } from './locale.js';
import { detectLocation, autoDetectLocation } from './locationService.js';
import { makeStyles } from './styles.js';
import {
  requestNotificationPermissions,
  cancelAllPrayerNotifications,
  setupNotificationChannel,
  registerPrayerAlarmCancellationHandler,
  sendImmediateNotification,
  scheduleEventNotification,
  registerDeviceWithBackend,
  unregisterDeviceFromBackend,
  registerUserProfile,
  fetchServerUser,
  notifyBackendNewQuestion,
  notifyBackendNewContribution,
  notifyBackendLike,
  notifyBackendCommunityPost,
  notifyBackendCommunityComment,
  notifyBackendCommunityPostLike,
  notifyBackendCommunityCommentLike,
  deleteServerQuestion,
  deleteServerAnswer,
  deleteServerCommunityPost,
  deleteServerCommunityComment,
  sendContentReport,
  updateServerUser,
} from './notifications.js';
import {
  schedulePrayerAlarms,
  registerAlarmStopHandler,
  sanitizePrayerAlarms,
  defaultPrayerAlarms,
  ensureExactAlarmPermission,
} from './prayerAlarms.js';
import { signInWithGoogle } from './googleAuth.js';
import { getAIAnswer, describeAIError } from './aiLogic.js';
import { uploadCommunityMedia, uploadProfileImage } from './mediaService.js';
import { precacheAvatars, cleanupTempFiles } from './avatarCache.js';
import { API_URL } from './config.js';
import {
  clearAllData,
  saveSettings,
  loadSettings,
  saveWelcomeShown,
  loadWelcomeShown,
  saveQAndA,
  loadQAndA,
  saveCommunityPosts,
  loadCommunityPosts,
  saveDeletedItems,
  loadDeletedItems,
  loadProfileDirectory,
  saveProfileDirectory,
  saveAccountCache,
  loadAccountCache,
  clearAccountCache,
} from './storage.js';
import PrayerTab from './PrayerTab.js';
import QATab from './QATab.js';
import NewsTab from './NewsTab.js';
import CommunityTab from './CommunityTab.js';
import SettingsTab from './SettingsTab.js';
import AuthScreen from './AuthScreen.js';
import ProfileSetupScreen from './ProfileSetupScreen.js';
import WelcomeScreen from './WelcomeScreen.js';
import {
  isFirebaseConfigured,
  firebaseSignUp,
  firebaseSignIn,
  firebaseSignOut,
  firebaseSendPasswordReset,
  friendlyFirebaseError,
  sendSignInLink,
  signInWithEmailLink,
  isEmailSignInLink,
  getCurrentFirebaseUser,
} from './firebaseAuth.js';
import { cloudSaveProfile, cloudFetchProfile, cloudUpdateQuestion, cloudUpdateAnswer, cloudUpdatePost, cloudUpdateComment } from './cloudSync.js';

/** Resolve the promise unless it takes longer than `ms`, in which case resolve
 *  with `fallback`. Keeps button spinners from hanging on a stalled socket.
 *  Fixed: uses a settled flag to prevent race conditions where both the timer
 *  and the promise could resolve. */
function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(fallback);
      }
    }, ms);
    promise.then(
      (v) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(v);
        }
      },
      () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(fallback);
        }
      }
    );
  });
}

function AppInner() {
  const [theme, setTheme] = useState('dark');
  const [language, setLanguage] = useState('tr');
  const [activeTab, setActiveTab] = useState('prayer');
  const [cityKey, setCityKey] = useState('istanbul');
  // GPS-detected location (takes priority over the city list when present)
  const [customLocation, setCustomLocation] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  // True when GPS permission was refused (so we can offer manual detection).
  const [locationDenied, setLocationDenied] = useState(false);
  // True once persisted data has been loaded from AsyncStorage. Persistence
  // effects below wait for this so they never overwrite stored values with
  // initial defaults during startup.
  const [hydrated, setHydrated] = useState(false);
  const [notificationSound, setNotificationSound] = useState('Sistem Varsayılanı');
  // Prayer-time calculation convention (diyanet | mwl | isna | egypt | makkah | karachi)
  const [prayerMethod, setPrayerMethod] = useState('diyanet');
  // Server-provided times (Diyanet criteria via the backend). Null = offline,
  // in which case the on-device astronomical computation is used.
  const [remoteTimes, setRemoteTimes] = useState(null);
  // Authors the user blocked (emails). Their content is hidden locally.
  const [blockedUsers, setBlockedUsers] = useState([]);
const [prayerAlarms, setPrayerAlarms] = useState(() => defaultPrayerAlarms());
const [profileDirectory, setProfileDirectory] = useState({});
  const [notificationsOn, setNotificationsOn] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [authMode, setAuthMode] = useState('signup');
  const [account, setAccount] = useState({ fullName: '', email: '', password: '' });
  const [expandedQas, setExpandedQas] = useState({});
  const [now, setNow] = useState(new Date());
  const [isNewUser, setIsNewUser] = useState(false);
  const [profileSetupComplete, setProfileSetupComplete] = useState(false);
  const [occupation, setOccupation] = useState('');
  const [address, setAddress] = useState('');
  const [bio, setBio] = useState('');
  const [welcomeScreenShown, setWelcomeScreenShown] = useState(false);
  const [profilePicture, setProfilePicture] = useState('');
  const [isGoogleUser, setIsGoogleUser] = useState(false);
  // Email-link flow state
  const [emailLinkSent, setEmailLinkSent] = useState(false);
  const [emailLinkPending, setEmailLinkPending] = useState(false);

  // Async-action busy flags — drive the loading spinners on the auth / ask /
  // share buttons so the user always sees that their tap is being processed.
  const [authBusy, setAuthBusy] = useState(false);
  const [postingQuestion, setPostingQuestion] = useState(false);
  const [sharingPost, setSharingPost] = useState(false);

  // Server-post IDs the user deleted (see deletedServerIdsRef below).
  // (sameId, hasRealContent and the feed normalizers are imported from
  // './feedSync.js' so the merge logic is unit-testable.)
  const deletedServerIdsRef = React.useRef(new Set());

  // Question IDs with an AI answer request currently in flight (dedupe guard).
  const aiInFlightRef = React.useRef(new Set());

  // Q&A state
  const [qAndA, setQAndA] = useState(Q_AND_A.tr);
  const [newQuestion, setNewQuestion] = useState('');
  const [newAnswer, setNewAnswer] = useState({});
  const [answerFormOpen, setAnswerFormOpen] = useState({});

  // Community state — starts EMPTY (no bundled demo posts / fake profiles).
  const [communityPosts, setCommunityPosts] = useState([]);
  const [newPostText, setNewPostText] = useState('');
  const [newComment, setNewComment] = useState({});

  // Live news & events fetched from the backend news API
  const [liveNews, setLiveNews] = useState([]);
  // Live scholar videos (YouTube) fetched from the backend
  const [liveScholarVideos, setLiveScholarVideos] = useState([]);

  // Load persisted state on startup
  useEffect(() => {
    (async () => {
      const user = getCurrentFirebaseUser();
      if (user) {
        // User is already authenticated with Firebase, fetch account from cloud
        setSignedIn(true);
        try {
          const serverUser = await fetchServerUser(user.email);
          const merged = {
            email: user.email?.toLowerCase() || '',
            fullName: serverUser?.fullName || user.displayName || '',
            password: '',
            profilePicture: serverUser?.profilePicture || user.photoURL || '',
            uid: user.uid,
            authProvider: 'firebase',
          };
          setAccount(merged);
          // Save to local cache for fast startup on next launch
          saveAccountCache(merged);

          if (serverUser) {
            setProfilePicture(serverUser.profilePicture || '');
            setOccupation(serverUser.occupation || '');
            setAddress(serverUser.address || '');
            setBio(serverUser.bio || '');
            setProfileSetupComplete(true);
            precacheAvatars([serverUser.profilePicture]);
          }
        } catch (_e) {
          // Offline - set basic account from Firebase user
          const offlineAccount = {
            email: user.email?.toLowerCase() || '',
            fullName: user.displayName || '',
            password: '',
            profilePicture: user.photoURL || '',
            uid: user.uid,
            authProvider: 'firebase',
          };
          setAccount(offlineAccount);
          // Save to local cache for fast startup on next launch
          saveAccountCache(offlineAccount);
        }
      }
      // Try to load cached account data for faster startup (offline fallback)
      const cachedAccount = await loadAccountCache();
      if (cachedAccount && !signedIn) {
        // Use cached data for immediate UI render, but wait for Firebase to confirm
        setAccount(cachedAccount);
      }

      // No local account loading - everything comes from cloud

      const savedSettings = await loadSettings();
      if (savedSettings) {
        if (savedSettings.theme) setTheme(savedSettings.theme);
        if (savedSettings.language) setLanguage(savedSettings.language);
        if (savedSettings.notificationsOn !== undefined) setNotificationsOn(savedSettings.notificationsOn);
        if (savedSettings.notificationSound) setNotificationSound(savedSettings.notificationSound);
        if (savedSettings.prayerMethod) setPrayerMethod(savedSettings.prayerMethod);
        if (Array.isArray(savedSettings.blockedUsers)) setBlockedUsers(savedSettings.blockedUsers);
        // Per-prayer alarm config (clock-app style); falls back to defaults.
        if (savedSettings.prayerAlarms) {
          setPrayerAlarms(sanitizePrayerAlarms(savedSettings.prayerAlarms));
        }
        if (savedSettings.customLocation) {
          setCustomLocation(savedSettings.customLocation);
        } else {
          // First launch (nothing saved yet): auto-detect the app language
          // from the device locale (Turkish device -> 'tr', otherwise 'en').
          setLanguage(localeToLanguage(getDeviceLocale()));
        }
      }

      const welcomeShown = await loadWelcomeShown();
      setWelcomeScreenShown(welcomeShown);

      const savedQAndA = await loadQAndA();
      if (savedQAndA) setQAndA(savedQAndA);

      const savedCommunity = await loadCommunityPosts();
      // Keep ONLY posts that belong to a real, signed-in user. Demo/fake posts
      // saved by older builds carry no owner email, so this migration purges
      // them for good — the community feed shows real users only.
      if (savedCommunity) setCommunityPosts(onlyRealUserPosts(savedCommunity));
      // Warm the avatar cache for saved content (pictures then work offline).
      precacheAvatars((savedCommunity || []).flatMap((p) => [
        p.user && p.user.avatarUrl,
        ...((p.comments || []).map((c) => c.user && c.user.avatarUrl)),
      ]));

      // Clean up any leftover .temp files from previous sessions
      cleanupTempFiles();

      // Load deleted items so deletions survive app restarts
      const savedDeletedItems = await loadDeletedItems();
      if (savedDeletedItems.size > 0) {
        deletedServerIdsRef.current = savedDeletedItems;
        // Filter out any deleted items from the loaded data
        if (savedQAndA) {
          setQAndA(prev => prev.filter(q => !deletedServerIdsRef.current.has(`qa:${q.serverPostId}`)));
        }
        if (savedCommunity) {
          setCommunityPosts(prev => prev.filter(p => !deletedServerIdsRef.current.has(`post:${p.serverId}`)));
        }
      }

      // Profile directory: best-known picture/name per email, so feed avatars
      // render immediately (and offline) even before any server refresh.
      const savedDirectory = await loadProfileDirectory();
      if (savedDirectory && Object.keys(savedDirectory).length > 0) {
        setProfileDirectory(savedDirectory);
      }

      // Initial load complete -- persistence effects may run from now on.
      setHydrated(true);
    })();
    }, []);

  // --- Passwordless email-link deep link handling ---
  // When the user taps the magic link in their email, the app opens via
  // deep link (com.joshua.islamiogreniyorum://email-link?...). We detect it on
  // cold start (getInitialURL) and in the foreground (addEventListener).
  const processEmailLink = (url) => {
    if (!url) return;
    try {
      // Manual query parsing — Hermes' `URL` support for custom schemes is
      // unreliable. Firebase links arrive either directly on the app scheme
      // (...://?mode=signIn&oobCode=...) or wrapped in a `link=` parameter
      // (...://?link=https%3A%2F%2F...%3Fmode%3DsignIn...).
      const qIndex = url.indexOf('?');
      const params = {};
      if (qIndex >= 0) {
        url.slice(qIndex + 1).split('&').forEach((pair) => {
          if (!pair) return;
          const eq = pair.indexOf('=');
          const key = eq >= 0 ? pair.slice(0, eq) : pair;
          let val = eq >= 0 ? pair.slice(eq + 1) : '';
          try { val = decodeURIComponent(val.replace(/\+/g, ' ')); } catch (_e) { /* keep raw */ }
          params[key] = val;
        });
      }
      const innerLink = params.link || url;
      // A genuine sign-in link: explicit mode=signIn, or the official SDK
      // check (it may throw when Firebase isn't configured — caught below).
      const looksLikeSignIn =
        url.includes('mode=signIn') ||
        innerLink.includes('mode=signIn') ||
        isEmailSignInLink(innerLink) ||
        isEmailSignInLink(url);
      if (looksLikeSignIn && !signedIn) {
        setEmailLinkPending(true);
        handleEmailLink(innerLink).catch((error) => {
          // Unauthenticated sign-in failed (e.g. Firebase not configured, bad
          // link, no matching email). The user should still be able to use the
          // app as a guest — never let this reject into an unhandled promise.
          console.warn('handleEmailLink failed:', error?.message || error);
          setEmailLinkPending(false);
        });
      }
    } catch (_e) {
      // Not a sign-in link (or Firebase unconfigured) — ignore.
    }
  };

  useEffect(() => {
    let mounted = true;
    // Cold start: check if the app was launched from a link.
    // getInitialURL() can reject on some Android intent configurations, so
    // we must catch to avoid an unhandled promise rejection that crashes the
    // React Native bridge on startup.
    Linking.getInitialURL()
      .then((url) => {
        if (mounted) processEmailLink(url);
      })
      .catch((error) => {
        console.warn('getInitialURL failed:', error?.message || error);
      });
    // Foreground / background -> foreground
    const sub = Linking.addEventListener('url', (event) => {
      try {
        processEmailLink(event.url);
      } catch (error) {
        console.warn('Deep link processing failed:', error?.message || error);
      }
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  // Translation table for the current language. Declared before the effects
  // below so their dependency arrays never reference it ahead of definition.
  const t = translations[language];

  // Auto-detect the user's REAL location anywhere in the world so prayer times
  // and event times match where they are (not just the preset cities). Runs
  // once the user is signed in; gracefully falls back to a default city when
  // permission is denied or GPS is unavailable.
  const autoDetectRanRef = React.useRef(false);
  useEffect(() => {
    if (!signedIn || autoDetectRanRef.current) return;
    autoDetectRanRef.current = true;
    (async () => {
      const { location, denied } = await autoDetectLocation();
      if (denied) {
        setLocationDenied(true);
        setLocationError(
          language === 'tr' ? 'Konum izni verilmedi.' : 'Location permission was denied.'
        );
      } else if (location) {
        setCustomLocation(location);
        setLocationDenied(false);
        setLocationError('');
      } else {
        // Couldn't get a fix without an explicit refusal — keep default city.
        setLocationDenied(false);
      }
    })();
  }, [signedIn, language, t]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
// Fetch live news & events from the backend news API (fall back to static data)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchJsonWithRetry(`${API_URL}/api/news?lang=${language}`, { method: 'GET' });
        if (!cancelled && data && Array.isArray(data.items) && data.items.length > 0) {
          setLiveNews(data.items);
        }
      } catch (error) {
        // Offline / backend unavailable -> fall back to static NEWS_ITEMS.
        console.warn('Live news unavailable, using static data:', error.message);
      }

      // Latest videos from verified Islamic scholar YouTube channels
      try {
        const data = await fetchJsonWithRetry(`${API_URL}/api/youtube/videos?lang=${language}`, { method: 'GET' });
        if (!cancelled && data && Array.isArray(data.items) && data.items.length > 0) {
          setLiveScholarVideos(data.items);
        }
      } catch (error) {
        // Offline / backend unavailable -> fall back to SCHOLAR_VIDEOS_FALLBACK.
        console.warn('Scholar videos unavailable, using static list:', error.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [language]);

  // Persist settings when they change (only after initial load)
  useEffect(() => {
    if (!hydrated) return;
    saveSettings({ theme, language, notificationsOn, notificationSound, customLocation, prayerMethod, blockedUsers, prayerAlarms });
  }, [hydrated, theme, language, notificationsOn, notificationSound, customLocation, prayerMethod, blockedUsers, prayerAlarms]);

  // Persist the profile directory whenever it changes (offline-first avatars).
  useEffect(() => {
    if (!hydrated) return;
    saveProfileDirectory(profileDirectory);
  }, [hydrated, profileDirectory]);

  // Persist Q&A and community data when they change (only after initial load)
  useEffect(() => {
    if (!hydrated) return;
    saveQAndA(qAndA);
  }, [hydrated, qAndA]);

  useEffect(() => {
    if (!hydrated) return;
    saveCommunityPosts(communityPosts);
  }, [hydrated, communityPosts]);

  const city = customLocation || CITIES[cityKey];
  // Use live news from the backend when available, otherwise fall back to static data.
  const newsItems = (liveNews && liveNews.length > 0 ? liveNews : NEWS_ITEMS[language]);
  const scholarVideos = liveScholarVideos && liveScholarVideos.length > 0 ? liveScholarVideos : SCHOLAR_VIDEOS_FALLBACK;

  // Set up the Android notification channels once at startup
  useEffect(() => {
    setupNotificationChannel();
  }, []);

  // Alarm-clock stop handler: dismissing any prayer alarm (tap or ⏹ Kapat /
  // Stop button) cancels that alarm. Other prayers are never affected.
  useEffect(() => {
    const subscription = registerAlarmStopHandler();
    return () => subscription.remove();
  }, []);

  // Keep a ref to the signed-in user's email so we can unregister the device
  // on sign-out even after account.email is cleared (React batches the
  // setAccount + setSignedIn updates, so account.email is already '' when the
  // sign-out effect runs).
  const userEmailRef = React.useRef('');
  useEffect(() => {
    if (signedIn && account.email) {
      userEmailRef.current = account.email;
    }
  }, [signedIn, account?.email]);

  // Unregister the device from the backend when the user signs out
  useEffect(() => {
    if (!signedIn && userEmailRef.current) {
      unregisterDeviceFromBackend(userEmailRef.current);
    }
    // Reset the registration flag on sign-out so the device is re-registered
    // when the user signs back in (otherwise the ref stays true and the
    // registration effect returns early, leaving the device unregistered).
    if (!signedIn) {
      deviceRegRanRef.current = false;
    }
  }, [signedIn]);

  // Re-register this device's push token with the backend whenever the user is
  // signed in and the app finishes hydrating. Device tokens must be re-sent on
  // every launch (fresh install, token rotation) or cross-user notifications
  // (comments / likes / answers) can never reach this device.
  //
  // Registration is retried a few times with backoff: on a cold launch the
  // network may not be ready and the first attempt fails silently. Without a
  // retry that device would be missing from the registry for the whole
  // session and never receive cross-user notifications.
  const deviceRegRanRef = React.useRef(false);
  useEffect(() => {
    if (!hydrated || !signedIn || !account?.email) return;
    if (deviceRegRanRef.current) return;
    deviceRegRanRef.current = true;

    // Ask for the POST_NOTIFICATIONS runtime permission (Android 13+) as soon
    // as a user signs in. This must be granted for community/Q&A push to show
    // even when the prayer-alarm toggle is intentionally OFF (previously the
    // permission was only requested inside the prayer-alarm scheduler).
    requestNotificationPermissions().catch(() => {});
    ensureExactAlarmPermission().catch(() => {});

    const attemptRegistration = (attempt) => {
      registerDeviceWithBackend(account.email, account.email, account.fullName)
        .then((ok) => {
          // Retry up to 3 times with backoff on failure (network blips at launch).
          if (!ok && attempt < 3) {
            setTimeout(() => attemptRegistration(attempt + 1), 3000 * attempt);
          } else if (!ok) {
            console.warn('Push device registration failed after retries.');
          }
        })
        .catch(() => {
          if (attempt < 3) {
            setTimeout(() => attemptRegistration(attempt + 1), 3000 * attempt);
          }
        });
    };
    attemptRegistration(1);
  }, [hydrated, signedIn, account?.email, account?.fullName]);

  // Schedule or cancel prayer notifications based on settings
  useEffect(() => {
    let isActive = true;
    async function syncNotifications() {
      // Only schedule after the user is signed in
      if (!signedIn || !notificationsOn) {
        await cancelAllPrayerNotifications();
        return;
      }

      // Request notification permission before scheduling
      const granted = await requestNotificationPermissions();
      if (!granted) {
        if (isActive) setNotificationsOn(false);
        return;
      }

      // Request SCHEDULE_EXACT_ALARM / USE_EXACT_ALARM on Android 12+ so that
      // prayer alarms fire precisely on time, even in Doze mode or when the app
      // is closed. Without this, exact alarms are deferred by the OS.
      await ensureExactAlarmPermission();

      // Compute today's prayer times as a snapshot for scheduling.
      // Prefers the server-provided Diyanet-convention times; falls back to
      // the on-device astronomical calculation when offline.
      const today = new Date();
      const todayTimes = remoteTimes
        ? remoteTimes.timings
        : computeTimes(today, city.lat, city.lng, city.tz, prayerMethod);

      // Alarm-clock style: each prayer has its own on/off + "minutes before"
      // entry. The scheduler uses the user's sound preference to determine
      // whether to use the high alarm sound or system default. The scheduler
      // wipes all previously scheduled prayers and re-creates them from this config.
      await schedulePrayerAlarms({
        alarms: prayerAlarms,
        prayerTimes: todayTimes,
        language,
        t,
        notificationSound,
      });

      // Legacy event reminders (upcoming events) still use the standard
      // notification channel and are unaffected by the alarm redesign.
      const monthMap = {
        // Turkish month names (used by the live news feed & static data)
        'Ocak': 0, 'Şubat': 1, 'Subat': 1, 'Mart': 2, 'Nisan': 3,
        'Mayıs': 4, 'Mayis': 4, 'Haziran': 5, 'Temmuz': 6, 'Ağustos': 7,
        'Agustos': 7, 'Eylül': 8, 'Eylul': 8, 'Ekim': 9, 'Kasım': 10,
        'Kasim': 10, 'Aralık': 11, 'Aralik': 11,
        // English month names
        'January': 0, 'February': 1, 'March': 2, 'April': 3, 'May': 4,
        'June': 5, 'July': 6, 'August': 7, 'September': 8, 'October': 9,
        'November': 10, 'December': 11,
      };

      for (const item of newsItems) {
        if (item.isPast) continue;

        // Parse date strings like "20 Ağustos 2026" or "August 20, 2026"
        // Note: the class includes ı/İ so Turkish months like "Mayıs"/"Kasım" match.
        const dateMatch = item.meta.match(/(\d{1,2})\s+([A-Za-zğüşöçıİĞÜŞÖÇ]+)\s+(\d{4})/) ||
                          item.meta.match(/([A-Za-zğüşöçıİĞÜŞÖÇ]+)\s+(\d{1,2}),\s+(\d{4})/);

        if (!dateMatch) continue;

        let day, monthName, year;
        if (dateMatch[1] && /^\d+$/.test(dateMatch[1])) {
          day = parseInt(dateMatch[1], 10);
          monthName = dateMatch[2];
          year = parseInt(dateMatch[3], 10);
        } else {
          monthName = dateMatch[1];
          day = parseInt(dateMatch[2], 10);
          year = parseInt(dateMatch[3], 10);
        }

        const month = monthMap[monthName];
        if (month === undefined) continue;

        const eventDate = new Date(year, month, day);
        await scheduleEventNotification({
          title: language === 'tr' ? 'Yaklaşan Etkinlik' : 'Upcoming Event',
          body: `${item.title} — ${item.place}`,
                    sound: notificationSound === 'Sessiz' || notificationSound === 'Silent' ? null : undefined,
          eventDate,
        });
      }
    }

    syncNotifications();

    return () => {
      isActive = false;
    };
  }, [signedIn, notificationsOn, cityKey, customLocation, language, notificationSound, newsItems, remoteTimes, prayerMethod, prayerAlarms]);

  // Fetch trusted prayer times from the backend (AlAdhan method 13 = Diyanet).
  // Silent-fail: when unreachable the device computation below takes over.
  useEffect(() => {
    let cancelled = false;
    async function loadRemoteTimes() {
      try {
        const url =
          `${API_URL}/api/prayer-times?lat=${encodeURIComponent(city.lat)}` +
          `&lng=${encodeURIComponent(city.lng)}&tz=${encodeURIComponent(city.tz)}` +
          `&method=${encodeURIComponent(prayerMethod)}`;
        const res = await fetch(url, { method: 'GET' });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = await res.json();
        if (!cancelled && data && data.success && data.timings) {
          setRemoteTimes({ timings: data.timings, method: data.method });
        } else if (!cancelled) {
          setRemoteTimes(null);
        }
      } catch (e) {
        if (!cancelled) setRemoteTimes(null);
      }
    }
    loadRemoteTimes();
    return () => { cancelled = true; };
  }, [city.lat, city.lng, city.tz, prayerMethod]);

  const computedTimes = useMemo(
    () => computeTimes(now, city.lat, city.lng, city.tz, prayerMethod),
    [now, city, prayerMethod]
  );
  // Server (Diyanet-convention) times win when available; device math otherwise.
  const times = remoteTimes ? remoteTimes.timings : computedTimes;
  const prayerSourceLabel = remoteTimes
    ? t?.sourceDiyanetOnline || 'Diyanet criteria (online)'
    : t?.sourceDevice || 'Computed on device';
  const nowMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;

  const nextPrayer = useMemo(() => {
    const order = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
    for (const key of order) {
      if (times[key] > nowMinutes) {
        return { key, time: times[key] };
      }
    }
    return { key: 'fajr', time: times.fajr + 1440 };
  }, [times, nowMinutes]);

  const remaining = Math.max(0, nextPrayer.time - nowMinutes);
  const diffHours = Math.floor(remaining / 60);
  const diffMinutes = Math.floor(remaining % 60);
  const diffSeconds = Math.floor((remaining * 60) % 60);

  const palette =
    theme === 'dark'
      ? {
          page: '#060b12',
          panel: '#0e1f2c',
          card: '#142d3c',
          cardSoft: '#16364a',
          text: '#edf4f6',
          muted: '#9bb1bf',
          primary: '#d8b56a',
          accent: '#6bbf92',
          border: 'rgba(255,255,255,0.08)',
          shell: '#081420',
          header: '#102a39',
          soft: '#112f3e',
        }
      : {
          page: '#eef5f3',
          panel: '#ffffff',
          card: '#f5f7f5',
          cardSoft: '#edf6f0',
          text: '#17272d',
          muted: '#586d75',
          primary: '#c8942d',
          accent: '#2d9a72',
          border: 'rgba(17, 31, 39, 0.08)',
          shell: '#f7f5ef',
          header: '#edf6f5',
          soft: '#e2f0eb',
        };

  const projectEvents = PROJECT_EVENTS[language];
  const soundOptions = SOUND_OPTIONS[language];

  // True when a list holds any real user/community content (an owned item or a
  // server-synced item). Used to decide whether a language change should drop
  // back to bundled sample data or preserve the user's feed.
  // (hasRealContent is imported from './feedSync.js'.)

  useEffect(() => {
    // Only reset transient UI state on a language change; NEVER clobber the
    // user's real + synced content with the bundled sample data (that caused
    // silent data loss every time the language was toggled).
    setExpandedQas({});
    setNewQuestion('');
    setNewAnswer({});
    setAnswerFormOpen({});
    setNewPostText('');
    setNewComment({});
  }, [language]);

  // Seed the QA list with the language-appropriate sample content ONLY when the
  // user has no real content yet (fresh install / no saved posts). The
  // community feed deliberately stays EMPTY — it is filled exclusively by real
  // user posts (local or synced from /api/community/feed).
  useEffect(() => {
    if (qAndA.length === 0 && !hasRealContent(qAndA)) {
      setQAndA(Q_AND_A[language]);
    }
  }, [language]);
  const styles = useMemo(() => makeStyles(palette), [palette]);

    const runAuthAction = async () => {
    if (!isFirebaseConfigured()) {
      Alert.alert(
        t.invalidLogin || 'Auth not configured',
        language === 'tr'
          ? 'Firebase kimlik doğrulama bu derlemede etkin değil. google-services.json dosyasını depo köküne ekleyip EAS ile yeniden derleyin.'
          : 'Firebase auth is not enabled in this build. Add google-services.json to the repo root and rebuild with EAS.'
      );
      return;
    }

    if (authMode === 'signup') {
      setIsNewUser(true);
      if (!account.fullName.trim() || !account.email.trim() || !account.password.trim()) {
        return;
      }
      const email = account.email.trim().toLowerCase();
      try {
        // Block duplicate sign-ups BEFORE creating the account: if the
        // credentials already sign in, this email is registered. (Firebase's
        // createUser error codes are unreliable across native/JS stacks, so we
        // probe with a real sign-in instead — decisive in every case.)
        try {
          await firebaseSignIn(email, account.password);
          // Sign-in succeeded -> the account already exists. Undo the probe's
          // session and stop here.
          try { await firebaseSignOut(); } catch {}
          Alert.alert(
            t.invalidLogin || 'Account already exists',
            language === 'tr'
              ? 'Bu e-posta ile bir hesap zaten kayıtlı. Lütfen giriş yapın.'
              : 'An account with this email already exists. Please log in instead.'
          );
          setAuthMode('login');
          return;
        } catch (probeError) {
          // Probe outcome:
          //  - sign-in OK            -> account exists (handled above)
          //  - wrong-password        -> account exists with ANOTHER password:
          //                             block here with a friendly message.
          //  - user-not-found        -> no account yet: safe to create.
          //  - invalid-credential    -> ambiguous (projects with email-
          //                             enumeration protection return this for
          //                             BOTH wrong password and unknown email):
          //                             fall through and let createUser be the
          //                             authority — it throws
          //                             email-already-in-use when taken.
          const code = String(probeError?.code || probeError?.message || '');
          if (/wrong-password/i.test(code)) {
            Alert.alert(
              t.invalidLogin || 'Account already exists',
              language === 'tr'
                ? 'Bu e-posta ile bir hesap zaten kayıtlı. Lütfen giriş yapın.'
                : 'An account with this email already exists. Please log in instead.'
            );
            setAuthMode('login');
            return;
          }

          // Create the account with Firebase (email + password).
          const firebaseUser = await firebaseSignUp(email, account.password);
          const accountToSave = {
            ...account,
            fullName: account.fullName.trim(),
            email,
            // Firebase owns the password; keep the field empty locally.
            password: '',
            uid: firebaseUser.uid,
            authProvider: 'firebase',
          };
          setAccount(accountToSave);
          setSignedIn(true);
          // Save to local cache for fast startup on next launch
          saveAccountCache(accountToSave);

          // Mirror the account on the backend so it survives reinstalls.
          registerUserProfile(accountToSave.email, accountToSave.fullName, null, accountToSave.profilePicture || null);

          // CLOUD: write the full profile to the backend so it survives logout / uninstall.
          cloudSaveProfile(accountToSave.email, accountToSave.fullName, accountToSave.profilePicture, {
            occupation: '',
            address: '',
            bio: '',
          }).catch(() => {});

          // Register this device with the push notification backend
          registerDeviceWithBackend(accountToSave.email, accountToSave.email, accountToSave.fullName);
        }
      } catch (error) {
        // Belt-and-braces: some stacks do surface email-already-in-use.
        if (/email-already-in-use/i.test(String(error?.code || error?.message || ''))) {
          Alert.alert(
            t.invalidLogin || 'Account already exists',
            language === 'tr'
              ? 'Bu e-posta ile bir hesap zaten kayıtlı. Lütfen giriş yapın.'
              : 'An account with this email already exists. Please log in instead.'
          );
          setAuthMode('login');
          return;
        }
        Alert.alert(t.invalidLogin || 'Sign up failed', friendlyFirebaseError(error, language));
        return;
      }
    } else {
      setIsNewUser(false);
      if (!account.email.trim() || !account.password.trim()) {
        return;
      }
      try {
        // Sign in with Firebase (email + password).
        const firebaseUser = await firebaseSignIn(account.email.trim(), account.password);

        // Fetch account data from cloud server first
        const serverUser = await fetchServerUser((firebaseUser.email || account.email).toLowerCase());
        
        const merged = {
          email: (firebaseUser.email || account.email).toLowerCase(),
          fullName: serverUser?.fullName || firebaseUser.displayName || account.fullName || '',
          password: '',
          profilePicture: serverUser?.profilePicture || firebaseUser.photoURL || '',
          uid: firebaseUser.uid,
          authProvider: 'firebase',
        };
        setAccount(merged);
        setSignedIn(true);
        // Save to local cache for fast startup on next launch
        saveAccountCache(merged);
        
        // Set profile data from cloud
        if (serverUser) {
          setProfilePicture(serverUser.profilePicture || '');
          setOccupation(serverUser.occupation || '');
          setAddress(serverUser.address || '');
          setBio(serverUser.bio || '');
          setProfileSetupComplete(true);
        }

        // CLOUD: ensure the profile is written to the backend on every login
        cloudSaveProfile(merged.email, merged.fullName, merged.profilePicture, {
          occupation: '',
          address: '',
          bio: '',
        }).catch(() => {});
        registerDeviceWithBackend(merged.email, merged.fullName);
      } catch (error) {
        Alert.alert(
          t.invalidLogin || 'Login failed',
          friendlyFirebaseError(error, language)
        );
      }
    }
  };

  const handleAuthAction = async () => {
    setAuthBusy(true);
    try {
      await runAuthAction();
    } finally {
      setAuthBusy(false);
    }
  };

// Send a Firebase password-reset email to the address in the form.
  const handleForgotPassword = async () => {
    const email = (account.email || '').trim();
    if (!email || !email.includes('@')) {
      Alert.alert(
        t.invalidLogin || 'Email required',
        language === 'tr'
          ? 'Lütfen geçerli bir e-posta adresi girin.'
          : 'Please enter a valid email address.'
      );
      return;
    }
    if (!isFirebaseConfigured()) {
      Alert.alert(
        t.invalidLogin || 'Auth not configured',
        language === 'tr'
          ? 'Firebase kimlik doğrulama bu derlemede etkin değil. google-services.json dosyasını depo köküne ekleyip EAS ile yeniden derleyin.'
          : 'Firebase auth is not enabled in this build. Add google-services.json to the repo root and rebuild with EAS.'
      );
      return;
    }
    try {
      await firebaseSendPasswordReset(email);
      Alert.alert(
        language === 'tr' ? 'E-posta gönderildi' : 'Email sent',
        language === 'tr'
          ? `Şifre sıfırlama bağlantısını ${email} adresine gönderdik.`
          : `We sent a password reset link to ${email}.`
      );
    } catch (error) {
      Alert.alert(t.invalidLogin || 'Request failed', friendlyFirebaseError(error, language));
    }
  };

  const runGoogleSignIn = async () => {
    const result = await signInWithGoogle(language);
    if (!result.success) {
      console.log('Google sign-in failed:', result.error);
      Alert.alert(
        language === 'tr' ? 'Google Girişi' : 'Google Sign-In',
        result.error ||
          (language === 'tr'
            ? 'Google ile giriş başarısız oldu.'
            : 'Google sign-in failed.')
      );
      return;
    }

    // The native flow signs the user into FIREBASE. The Firebase session is
    // the source of truth (it carries verified email, UID and photoURL), so
    // hydrate the account from it and fall back to Google's profile payload.
    const fbUser = getCurrentFirebaseUser();
    const email = (fbUser?.email || result.user.email || '').toLowerCase();
    const googleAccount = {
      fullName: fbUser?.displayName || result.user.name || '',
      email,
      password: '',
      profilePicture: fbUser?.photoURL || result.user.picture || '',
      uid: fbUser?.uid || undefined,
      authProvider: 'google',
    };
    setAccount(googleAccount);
    // Save to local cache for fast startup on next launch
    saveAccountCache(googleAccount);

    // Use the profile picture (Google photo now lives on the Firebase user).
    setProfilePicture(googleAccount.profilePicture);
    setIsGoogleUser(true);
    setSignedIn(true);
    setIsNewUser(false);
    setProfileSetupComplete(true);

    // Mirror the Google account on the backend (best-effort). The Firebase ID
    // token is attached automatically by the register/verify layer, so the
    // server stores this profile against a VERIFIED identity now.
    registerUserProfile(googleAccount.email, googleAccount.fullName, null, googleAccount.profilePicture || null);

    // CLOUD: write the full profile so it survives logout / uninstall.
    cloudSaveProfile(googleAccount.email, googleAccount.fullName, googleAccount.profilePicture || null, {
      occupation: '',
      address: '',
      bio: '',
    }).catch(() => {});

    // Register this device with the push notification backend (now works —
    // the user has a real Firebase session).
    registerDeviceWithBackend(googleAccount.email, googleAccount.email, googleAccount.fullName);
  };

  const handleGoogleSignIn = async () => {
    setAuthBusy(true);
    try {
      await runGoogleSignIn();
    } catch (error) {
      console.warn('Google sign-in error:', error?.message || error);
      Alert.alert(
        language === 'tr' ? 'Google Girişi' : 'Google Sign-In',
        (error && error.message) ||
          (language === 'tr'
            ? 'Google ile giriş başarısız oldu.'
            : 'Google sign-in failed.')
      );
        } finally {
      setAuthBusy(false);
    }
  };

  // --- Passwordless email-link sign-in ---
  //
  // Flow: user taps "Sign in with email link" on AuthScreen → enters email →
  // we call sendSignInLink() → Firebase emails a magic link → user taps the
  // link in their email → the app opens via deep link → handleEmailLink()
  // completes the sign-in. State is persisted so the link can be processed
  // even if the app was cold-started from the email tap.

    const handleSendEmailLink = async () => {
    const email = (account.email || '').trim();
    // Use a regex for proper email validation instead of just checking for '@'
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      Alert.alert(
        t.invalidLogin || 'Email required',
        language === 'tr' ? 'Lütfen geçerli bir e-posta girin.' : 'Please enter a valid email.'
      );
      return;
    }
    if (!isFirebaseConfigured()) {
      Alert.alert(
        t.invalidLogin || 'Auth not configured',
        language === 'tr' ? 'Firebase kimlik doğrulama bu derlemede etkin değil.' : 'Firebase auth is not enabled in this build.'
      );
      return;
    }
    setAuthBusy(true);
    try {
      await sendSignInLink(email, language);
      setEmailLinkSent(true);
      // Do NOT save account locally - email will be retrieved from Firebase when link is opened
      Alert.alert(
        language === 'tr' ? 'E-posta gönderildi' : 'Email sent',
        language === 'tr'
          ? 'Giriş bağlantınızı açmak için e-postanıza gönderilen bağlantıya tıklayın.'
          : 'Check your email and tap the link to complete sign-in.'
      );
    } catch (error) {
      console.warn('Email link send error:', error?.message || error);
      Alert.alert(
        t.invalidLogin || 'Error',
        friendlyFirebaseError(error, language)
      );
    } finally {
      setAuthBusy(false);
    }
  };

  // Called either from a deep link (cold start / foreground) or during
  // initial app load to replay a pending link from storage.
  const handleEmailLink = async (link) => {
    // Check link FIRST — without a link we cannot do anything regardless of email.
    if (!link) return false;
    let email = (account.email || '').trim();
    // Since we don't store account locally, if email is not in state,
    // we cannot proceed with email link sign-in.
    if (!email) {
      Alert.alert(
        t.invalidLogin || 'Sign-in link',
        language === 'tr'
          ? 'Lütfen uygulamada aynı e-posta adresini girin ve yeni bir bağlantı isteyin.'
          : 'Please enter the same email in the app and request a new link.'
      );
      setEmailLinkPending(false);
      return false;
    }
    try {
      const user = await signInWithEmailLink(email, link);
      const serverUser = await fetchServerUser(user.email || email).catch(() => null);
      const emailLinkAccount = {
        fullName: serverUser?.fullName || user.displayName || account.fullName,
        email: user.email || email,
        password: '',
        profilePicture: serverUser?.profilePicture || user.photoURL || profilePicture || '',
      };
      setAccount(emailLinkAccount);
      // Save to local cache for fast startup on next launch
      saveAccountCache(emailLinkAccount);
      setProfilePicture(serverUser?.profilePicture || user.photoURL || profilePicture);
      setSignedIn(true);
      setIsNewUser(false);
      setProfileSetupComplete(true);
      setIsGoogleUser(false);
      
      // Set profile data from cloud
      if (serverUser) {
        setOccupation(serverUser.occupation || '');
        setAddress(serverUser.address || '');
        setBio(serverUser.bio || '');
      }
      
      registerUserProfile(user.email || email, serverUser?.fullName || user.displayName || account.fullName, null, serverUser?.profilePicture || user.photoURL || profilePicture || null);
      // CLOUD: write the full profile so it survives logout / uninstall.
      cloudSaveProfile(user.email || email, serverUser?.fullName || user.displayName || account.fullName, serverUser?.profilePicture || user.photoURL || profilePicture || null, {
        occupation: '',
        address: '',
        bio: '',
      }).catch(() => {});
      registerDeviceWithBackend(user.email || email, user.email || email, user.displayName || account.fullName);
      setEmailLinkPending(false);
      setEmailLinkSent(false);
      return true;
    } catch (error) {
      console.warn('Email link sign-in error:', error?.message || error);
      Alert.alert(
        t.invalidLogin || 'Error',
        friendlyFirebaseError(error, language)
      );
      return false;
    } finally {
      setEmailLinkPending(false);
    }
  };

  // --- Profile setup (new email sign-ups) ---
  // Persists occupation/address/bio/picture after the ProfileSetupScreen. A
  // device-local picture is mirrored to Firebase Storage first (best-effort,
  // time-bounded) so the stored value is a permanent https:// URL that renders
  // on every device — the same strategy used for community post media. When
  // offline or Storage is unavailable, keep the local file: the avatar cache
  // keeps it rendering on this device and the next successful save upgrades it.
  const handleProfileSetupComplete = async () => {
    let finalPicture = profilePicture;
    if (finalPicture && /^file:/i.test(finalPicture)) {
      try {
        const uploaded = await withTimeout(uploadProfileImage(finalPicture), 20000, null);
        if (uploaded) finalPicture = uploaded;
      } catch (_e) {
        // Offline / Storage not set up — keep the device-local file.
      }
    }
    setProfilePicture(finalPicture);
    // Profile data is stored in the cloud, no need to save locally
    const updatedAccount = { ...account, profilePicture: finalPicture || '' };
    setAccount(updatedAccount);
    setIsNewUser(false);
    setProfileSetupComplete(true);
    if (account.email) {
      const prof = {
        occupation,
        address,
        bio,
        fullName: account.fullName || account.email.split('@')[0],
        profilePicture: finalPicture || '',
      };
      // CLOUD: always write the full profile to the backend so it survives
      // logout / uninstall. This is the authoritative copy now.
      cloudSaveProfile(account.email, prof.fullName, prof.profilePicture, {
        occupation: prof.occupation,
        address: prof.address,
        bio: prof.bio,
      }).catch(() => {});
    }
  };

  // ---------- Q&A Handlers ----------

    const handleAskQuestion = async () => {
    const trimmed = newQuestion.trim();
    if (!trimmed) return;

    const questionId = Date.now();
        const askedText = trimmed;
    const newQ = {
      id: questionId,
      question: askedText,
      answer: '',
      source: '',
      href: '',
      likes: 0,
      likedByMe: false,
      ownerEmail: account.email || null,
      answers: [],
      // The AI starts working the moment the question is posted.
      aiAnswerLoading: true,
    };
    setQAndA(prev => [newQ, ...prev]);
    setNewQuestion('');

    // Open this question's card so the user immediately sees "AI is thinking..."
    setExpandedQas(prev => ({ ...prev, [questionId]: true }));
    setPostingQuestion(true);

    // Register the question with the backend so other users get a push,
    // then store the server-assigned ID on this question so later answers
    // and likes can be routed back to the right authors.
    //
    // IMPORTANT: this runs in the BACKGROUND (fire-and-forget). Previously it
    // was `await`ed FIRST, so the AI answer below did not even START until the
    // backend POST resolved — or worse, timed out after up to 12 seconds on a
    // slow backend. That delay made answers feel broken. Now the question posts
    // optimistically and the AI answer begins immediately; the server ID is
    // attached when the response arrives.
    const resultPromise = notifyBackendNewQuestion(
      account.email || 'guest',
      askedText,
      account.fullName || null,
      profilePicture || null
    );
    withTimeout(resultPromise, 12000, { ok: false, postId: null })
      .then((result) => {
        if (result && result.ok && result.postId) {
          setQAndA(prev => prev.map(q => (
            sameId(q.id, questionId) ? { ...q, serverPostId: result.postId } : q
          )));
        }
      })
      .catch(() => {});
    setPostingQuestion(false);

    // Automatically generate an AI answer for the freshly asked question.
    // Started IMMEDIATELY (before the backend registration above resolves) so
    // the user sees the answer as quickly as the internet allows.
    handleAIAnswer(questionId, askedText);
  };

  const handleLikeQuestion = (questionId) => {
    // Capture previous state for rollback on failure
    const prevQuestion = qAndA.find(q => sameId(q.id, questionId));
    if (!prevQuestion) return;

    // Optimistic update
    setQAndA(prev => prev.map(q => {
      if (sameId(q.id, questionId)) {
        return {
          ...q,
          likes: q.likedByMe ? q.likes - 1 : q.likes + 1,
          likedByMe: !q.likedByMe,
        };
      }
      return q;
    }));

    // Notify backend if this is a server-synced question and we're liking (not unliking)
    if (!prevQuestion.likedByMe && prevQuestion.serverPostId && account.email) {
      notifyBackendLike(prevQuestion.serverPostId, null, account.email).catch(() => {
        // Rollback on failure
        setQAndA(prev => prev.map(q => {
          if (sameId(q.id, questionId)) {
            return {
              ...q,
              likes: q.likedByMe ? q.likes - 1 : q.likes + 1,
              likedByMe: !q.likedByMe,
            };
          }
          return q;
        }));
      });
    }
  };

  const handleLikeAnswer = (questionId, answerId) => {
    // Read current state before toggling so we only notify on a fresh like.
    const likedQuestion = qAndA.find(x => sameId(x.id, questionId));
    const likedAnswer = likedQuestion?.answers.find(a => sameId(a.id, answerId));
    const willLike = !!likedAnswer && !likedAnswer.likedByMe;

    // Optimistic update
    setQAndA(prev => prev.map(q => {
      if (sameId(q.id, questionId)) {
        return {
          ...q,
          answers: q.answers.map(a => {
            if (sameId(a.id, answerId)) {
              return {
                ...a,
                likes: a.likedByMe ? a.likes - 1 : a.likes + 1,
                likedByMe: !a.likedByMe,
              };
            }
            return a;
          }),
        };
      }
      return q;
    }));

    // Notify the answer's author via the backend (only when this thread and
    // answer are registered server-side, i.e. they carry server IDs).
    if (willLike && likedQuestion?.serverPostId && likedAnswer?.serverContribId) {
      notifyBackendLike(
        likedQuestion.serverPostId,
        likedAnswer.serverContribId,
        account.email || 'guest'
      ).catch(() => {
        // Rollback optimistic update on failure
        setQAndA(prev => prev.map(q => {
          if (sameId(q.id, questionId)) {
            return {
              ...q,
              answers: q.answers.map(a => {
                if (sameId(a.id, answerId)) {
                  return {
                    ...a,
                    likes: a.likedByMe ? a.likes - 1 : a.likes + 1,
                    likedByMe: !a.likedByMe,
                  };
                }
                return a;
              }),
            };
          }
          return q;
        }));
      });
    }
  };

  // Location: get a GPS fix and use it for prayer times
  const handleDetectLocation = async () => {
    if (locating) return;
    setLocating(true);
    setLocationError('');
    try {
      const loc = await detectLocation();
      setCustomLocation(loc);
      setLocationDenied(false);
    } catch (e) {
      setLocationError(
        e && e.code === 'PERMISSION_DENIED' ? t.locationDenied : t.locationFailed
      );
      setLocationDenied(true);
    } finally {
      setLocating(false);
    }
  };

  // AI: generate an answer for a Q&A question. SERVER-FIRST: the backend's
  // Serper.dev (Google) + Groq synthesis pipeline is the primary source —
  // the on-device Wikipedia/DuckDuckGo fallback in aiLogic.js runs only when
  // the server is unreachable. This is why old builds showed
  // "I could not find a matching wikipedia article" — they never reached
  // the server pipeline. Always rebuild + reinstall after changing this.
  // questionTextOverride lets the auto-answer flow pass the freshly typed
  // question (state has not re-rendered yet when posting).
  const handleAIAnswer = async (questionId, questionTextOverride) => {
    const stored = qAndA.find(q => sameId(q.id, questionId));
    const localQuestion = stored?.question || questionTextOverride;
    if (!localQuestion) return;
    // Guard against firing twice for the same question (double-tap etc.)
    if (aiInFlightRef.current.has(String(questionId))) return;

    aiInFlightRef.current.add(String(questionId));
    // Mark this question as loading
    setQAndA(prev => prev.map(q => sameId(q.id, questionId) ? { ...q, aiAnswerLoading: true, aiError: undefined } : q));

    try {
      // Server-first: Serper + Groq synthesis via /api/ai/chat, then legacy
      // /api/ai/answer, and only then the on-device keyless fallback.
      const data = await getAIAnswer(localQuestion, language);

      const aiAnswer = {
        id: Date.now(),
        user: {
          name:
            (data.provider === 'google-search' || data.provider === 'serper')
              ? language === 'tr'
                ? 'İslamı öğreniyorum Web Arama'
                : 'I am Learning Islam Web Search'
              : language === 'tr'
                ? 'İslamı öğreniyorum AI'
                : 'I am Learning Islam AI',
          avatar: (data.provider === 'google-search' || data.provider === 'serper') ? '🔎' : '🤖',
        },
        text: data.answer,
        // Structured links shown under the answer (web-search fallback only).
        sources: Array.isArray(data.sources) ? data.sources : [],
        timestamp: language === 'tr' ? 'şimdi' : 'just now',
        likes: 0,
        likedByMe: false,
        isAI: true,
        aiProvider: data.provider || 'firebase-ai',
      };

      setQAndA(prev => prev.map(q => {
        if (sameId(q.id, questionId)) {
          return {
            ...q,
            aiAnswerLoading: false,
            aiAnswer: aiAnswer,
            answers: [...(q.answers || []), aiAnswer],
          };
        }
        return q;
      }));

      // NOTE: the AI answer is intentionally NOT persisted to the server. The
      // shared feed is public, so storing the answer there would expose it (and
      // its support links) to every other user on every device. The AI answer
      // stays private to the asking user: it lives only on this device via the
      // question's `aiAnswer` field, and mergeQA() already preserves locally
      // generated AI answers across server refreshes.
    } catch (error) {
      console.warn('AI answer error:', error?.message || error);
      setQAndA(prev => prev.map(q => sameId(q.id, questionId)
        ? {
            ...q,
            aiAnswerLoading: false,
            aiError: describeAIError(error, language),
            aiFallbackUrl: `https://www.google.com/search?q=${encodeURIComponent(localQuestion)}`,
          }
        : q
      ));
    } finally {
      aiInFlightRef.current.delete(String(questionId));
    }
  };

  const handleSubmitAnswer = (questionId) => {
    const answerText = newAnswer[questionId]?.trim();
    if (answerText) {
      const newAns = {
        id: Date.now(),
        user: {
          name: account.fullName || (language === 'tr' ? 'Misafir Kullanıcı' : 'Guest User'),
          avatar: '👤',
          avatarUrl: profilePicture || null,
        },
        text: answerText,
        timestamp: language === 'tr' ? 'şimdi' : 'just now',
        likes: 0,
        likedByMe: false,
        ownerEmail: account.email || null,
      };
      setQAndA(prev => prev.map(q => {
        if (sameId(q.id, questionId)) {
          return { ...q, answers: [...q.answers, newAns] };
        }
        return q;
      }));
      setNewAnswer(prev => ({ ...prev, [questionId]: '' }));
      setAnswerFormOpen(prev => ({ ...prev, [questionId]: false }));

      // Notify the question's author via the backend. Only possible when this
      // question was registered server-side (it has a serverPostId).
      const answeredQuestion = qAndA.find(q => sameId(q.id, questionId));
      if (answeredQuestion?.serverPostId) {
        notifyBackendNewContribution(
          answeredQuestion.serverPostId,
          account.email || 'guest',
          answerText,
          account.fullName || null,
          profilePicture || null
        )
          .then((result) => {
            if (result && result.ok && result.contributionId) {
              // Remember the server contribution ID so later likes on this
              // answer can notify its author.
              setQAndA(prev => prev.map(q => (
                sameId(q.id, questionId)
                  ? {
                      ...q,
                      answers: q.answers.map(a => (
                        sameId(a.id, newAns.id) ? { ...a, serverContribId: result.contributionId } : a
                      )),
                    }
                  : q
              )));
            }
          })
          .catch(() => {});
      }

    }
  };

  // ---------- Edit / Delete own content ----------
  // A user may only modify content they created themselves (matched by the
  // account e-mail stored on the item at creation time).

  const isOwnContent = (ownerEmail) =>
    !!ownerEmail && !!account.email && ownerEmail === account.email;

  // --- Q&A ---
    const handleEditQuestion = (questionId, newText) => {
    const text = (newText || '').trim();
    if (!text) return;
    setQAndA(prev => prev.map(q => (
      sameId(q.id, questionId) && isOwnContent(q.ownerEmail)
        ? { ...q, question: text }
        : q
    )));
    // Sync the edit to the backend (best-effort). Only server-synced questions
    // can be edited on the server; local-only edits stay local.
    const target = qAndA.find(q => sameId(q.id, questionId) && isOwnContent(q.ownerEmail));
    if (target && target.serverPostId && account.email) {
      cloudUpdateQuestion(target.serverPostId, target.ownerEmail, text).catch(() => {});
    }
  };

  const handleDeleteQuestion = (questionId) => {
    Alert.alert(
      t.deleteQuestionConfirm || 'Delete this question?',
      '',
      [
        { text: t.cancel || 'Cancel', style: 'cancel' },
        {
          text: t.delete || 'Delete',
          style: 'destructive',
          onPress: () => {
            // Remember server-synced questions I delete so a refresh won't
            // bring them back.
            const target = qAndA.find(q => sameId(q.id, questionId) && isOwnContent(q.ownerEmail));
            if (target && target.serverPostId) {
              deletedServerIdsRef.current.add(`qa:${target.serverPostId}`);
              saveDeletedItems(deletedServerIdsRef.current);
              // Permanently remove it from the shared feed so it disappears for
              // everyone (best-effort — local delete still happens below).
              deleteServerQuestion(target.serverPostId, account.email || 'guest').catch(() => {});
            }
            setQAndA(prev => prev.filter(q => !(
              sameId(q.id, questionId) && isOwnContent(q.ownerEmail)
            )));
          },
        },
      ]
    );
  };

    const handleEditAnswer = (questionId, answerId, newText) => {
    const text = (newText || '').trim();
    if (!text) return;
    const question = qAndA.find(q => sameId(q.id, questionId));
    const answer = question?.answers.find(a => sameId(a.id, answerId));
    setQAndA(prev => prev.map(q => (
      sameId(q.id, questionId)
        ? {
            ...q,
            answers: q.answers.map(a => (
              sameId(a.id, answerId) && isOwnContent(a.ownerEmail) ? { ...a, text } : a
            )),
          }
        : q
    )));
    // Sync the edit to the backend (best-effort).
    if (answer && answer.serverContribId && question?.serverPostId && account.email) {
      cloudUpdateAnswer(
        question.serverPostId,
        answer.serverContribId,
        answer.ownerEmail,
        text
      ).catch(() => {});
    }
  };

  // Answers delete immediately (no confirmation) but permanently: server-synced
  // answers are tombstoned so a feed refresh never brings them back.
  const handleDeleteAnswer = (questionId, answerId) => {
    const target = qAndA.find(q => sameId(q.id, questionId));
    const answer = target?.answers.find(a => sameId(a.id, answerId));
    if (answer && isOwnContent(answer.ownerEmail) && answer.serverContribId) {
      deletedServerIdsRef.current.add(`answer:${answer.serverContribId}`);
      saveDeletedItems(deletedServerIdsRef.current);
      // Permanently remove the answer from the shared feed (best-effort).
      if (target?.serverPostId) {
        deleteServerAnswer(target.serverPostId, answer.serverContribId, account.email || 'guest').catch(() => {});
      }
    }
    setQAndA(prev => prev.map(q => (
      sameId(q.id, questionId)
        ? { ...q, answers: q.answers.filter(a => !(
            sameId(a.id, answerId) && isOwnContent(a.ownerEmail)
          )) }
        : q
    )));
  };

    // --- Community ---
  const handleEditPost = (postId, newText) => {
    const text = (newText || '').trim();
    if (!text) return;
    const post = communityPosts.find(p => sameId(p.id, postId) && isOwnContent(p.ownerEmail));
    setCommunityPosts(prev => prev.map(p => (
      sameId(p.id, postId) && isOwnContent(p.ownerEmail) ? { ...p, text } : p
    )));
    // Sync the edit to the backend (best-effort).
    if (post && post.serverId && post.ownerEmail && account.email) {
      cloudUpdatePost(post.serverId, post.ownerEmail, text).catch(() => {});
    }
  };

  const handleDeletePost = (postId) => {
    Alert.alert(
      t.deletePostConfirm || 'Delete this post?',
      '',
      [
        { text: t.cancel || 'Cancel', style: 'cancel' },
        {
          text: t.delete || 'Delete',
          style: 'destructive',
          onPress: () => {
            // If it's a server-synced post I own, remember it as deleted so a
            // future feed refresh never resurrects it, AND permanently remove it
            // from the shared feed for everyone (best-effort).
            const target = communityPosts.find(p => sameId(p.id, postId) && isOwnContent(p.ownerEmail));
            if (target && target.serverId) {
              deletedServerIdsRef.current.add(`post:${target.serverId}`);
              saveDeletedItems(deletedServerIdsRef.current);
              deleteServerCommunityPost(target.serverId, account.email || 'guest').catch(() => {});
            }
            setCommunityPosts(prev => prev.filter(p => !(
              sameId(p.id, postId) && isOwnContent(p.ownerEmail)
            )));
          },
        },
      ]
    );
  };

    const handleEditComment = (postId, commentId, newText) => {
    const text = (newText || '').trim();
    if (!text) return;
    const post = communityPosts.find(p => sameId(p.id, postId));
    const comment = post?.comments.find(c => sameId(c.id, commentId) && isOwnContent(c.commenterEmail));
    setCommunityPosts(prev => prev.map(p => (
      sameId(p.id, postId)
        ? {
            ...p,
            comments: p.comments.map(c => (
              sameId(c.id, commentId) && isOwnContent(c.commenterEmail) ? { ...c, text } : c
            )),
          }
        : p
    )));
    // Sync the edit to the backend (best-effort).
    if (comment && post?.serverId && comment.serverId && comment.commenterEmail && account.email) {
      cloudUpdateComment(post.serverId, comment.serverId, comment.commenterEmail, text).catch(() => {});
    }
  };

  // Comments delete immediately (no confirmation) but permanently: server-synced
  // comments are tombstoned so a feed refresh never brings them back.
  const handleDeleteComment = (postId, commentId) => {
    const target = communityPosts.find(p => sameId(p.id, postId));
    const comment = target?.comments.find(c => sameId(c.id, commentId));
    if (comment && isOwnContent(comment.commenterEmail) && comment.id) {
      deletedServerIdsRef.current.add(`comment:${comment.id}`);
      saveDeletedItems(deletedServerIdsRef.current);
      // Permanently remove the comment from the shared feed (best-effort).
      if (target?.serverId && comment.serverId) {
        deleteServerCommunityComment(target.serverId, comment.serverId, account.email || 'guest').catch(() => {});
      }
    }
    setCommunityPosts(prev => prev.map(p => (
      sameId(p.id, postId)
        ? { ...p, comments: p.comments.filter(c => !(
            sameId(c.id, commentId) && isOwnContent(c.commenterEmail)
          )) }
        : p
    )));
  };

  // ---------- Shared feed sync ----------
  // Pulls everyone's questions/posts from the backend and merges them into
  // the local-first stores, so users actually see each other's content.
  // Offline / sleeping-server => silent no-op, local experience untouched.

  const lastFeedSyncRef = React.useRef(0);

  // normalizeServerQA / normalizeServerCommunityPost are imported from
  // './feedSync.js' (pure, unit-testable). The merge helpers mergeQA /
  // mergeCommunityPosts are used inside syncFeeds below.

  // ---- Profile directory ---------------------------------------------------
  // Feed items embed the poster's avatar AS IT WAS AT POST TIME. To show each
  // user's CURRENT picture and name everywhere (even after they update their
  // profile), we keep a local directory { email -> { fullName, profilePicture }
  // } and refresh it from the backend after every feed sync. The signed-in
  // user's own entry always comes live from account state (see resolveProfile),
  // so their own edits apply instantly without any server round-trip.
  const dirRefreshBusyRef = React.useRef(false);
  const refreshProfileDirectory = async (serverItems) => {
    const emails = new Set();
    for (const it of serverItems || []) {
      if (!it) continue;
      const owner = it.ownerUserId;
      if (owner && !String(owner).startsWith('ai@')) emails.add(String(owner).trim().toLowerCase());
      for (const c of it.contributions || []) {
        if (c && c.userId && !String(c.userId).startsWith('ai@')) emails.add(String(c.userId).trim().toLowerCase());
      }
      for (const cm of it.comments || []) {
        if (cm && cm.userId && !String(cm.userId).startsWith('ai@')) emails.add(String(cm.userId).trim().toLowerCase());
      }
    }
    if (emails.size === 0 || dirRefreshBusyRef.current) return;
    dirRefreshBusyRef.current = true;
    try {
      const lookups = await Promise.all(
        [...emails].slice(0, 25).map(async (email) => {
          try {
            const u = await fetchServerUser(email);
            return u
              ? [email, { fullName: u.fullName || '', profilePicture: u.profilePicture || '', fetchedAt: new Date().toISOString() }]
              : null;
          } catch (_e) {
            return null;
          }
        })
      );
      const fresh = {};
      const pics = [];
      for (const pair of lookups) {
        if (pair) {
          fresh[pair[0]] = pair[1];
          if (pair[1].profilePicture) pics.push(pair[1].profilePicture);
        }
      }
      if (Object.keys(fresh).length > 0) {
        setProfileDirectory((prev) => ({ ...prev, ...fresh }));
        // Warm the on-disk avatar cache while online so the fresh pictures
        // also render offline.
        precacheAvatars(pics);
      }
    } finally {
      dirRefreshBusyRef.current = false;
    }
  };

  const syncFeeds = async (force = false) => {
    if (!signedIn) return;
    const stamp = Date.now();
    if (!force && stamp - lastFeedSyncRef.current < 60000) return;
    lastFeedSyncRef.current = stamp;

    try {
      const [qaRes, commRes] = await Promise.all([
        fetch(`${API_URL}/api/qa/feed`).catch(() => null),
        fetch(`${API_URL}/api/community/feed`).catch(() => null),
      ]);

      if (qaRes && qaRes.ok) {
        const data = await qaRes.json().catch(() => null);
        if (data && Array.isArray(data.items)) {
          const serverQ = data.items.map((d) => normalizeServerQA(d, language));
          // Warm the on-disk avatar cache while online so pictures survive offline.
          precacheAvatars(serverQ.flatMap((q) => (q.answers || []).map((a) => a.user && a.user.avatarUrl)));
          setQAndA((prev) => mergeQA(prev, serverQ, deletedServerIdsRef.current));
          // Refresh the per-email profile directory (name + picture) so other
          // users' edits propagate to this device.
          refreshProfileDirectory(data.items);
        }
      }

      if (commRes && commRes.ok) {
        const data = await commRes.json().catch(() => null);
        if (data && Array.isArray(data.items)) {
          const serverP = onlyRealUserPosts(
            data.items
              // BUG FIX: normalize relative media URLs BEFORE
              // normalizeServerCommunityPost validates them. Previously this
              // conversion ran AFTER the normalizer, which had already set
              // media: null for any non-https URL — making this dead code and
              // silently stripping media from posts stored by older app
              // versions (which saved relative /uploads/<name> paths).
              .map((d) => {
                if (
                  d.mediaUri &&
                  typeof d.mediaUri === 'string' &&
                  !/^https?:\/\//i.test(d.mediaUri.trim())
                ) {
                  return {
                    ...d,
                    mediaUri: d.mediaUri.trim().startsWith('/')
                      ? `${API_URL}${d.mediaUri.trim()}`
                      : d.mediaUri.trim(),
                  };
                }
                return d;
              })
              .map((d) => normalizeServerCommunityPost(d, language))
          );
          // Warm the on-disk avatar cache while online so pictures survive offline.
          precacheAvatars([
            ...serverP.map((p) => p.user && p.user.avatarUrl),
            ...serverP.flatMap((p) => (p.comments || []).map((c) => c.user && c.user.avatarUrl)),
          ]);
          setCommunityPosts((prev) => mergeCommunityPosts(prev, serverP, deletedServerIdsRef.current));
          // Community posts also carry owner emails — refresh the directory
          // here too (QA feed covers answers; this covers post authors).
          refreshProfileDirectory(data.items);
        }
      }
    } catch (e) {
      // Network/server unavailable — keep local-first data as-is.
    }
  };

  useEffect(() => {
    if (signedIn) syncFeeds(true);
  }, [signedIn]);

  useEffect(() => {
    if ((activeTab === 'qa' || activeTab === 'community') && signedIn) {
      syncFeeds(false);
    }
  }, [activeTab, signedIn]);

  // Near-real-time feed sync: poll every 10s while on a feed tab so that posts
  // other users delete or edit vanish/appear without a manual pull-to-refresh.
  // We reset the 60s throttle each tick so the poll actually hits the server.
  const syncFeedsRef = React.useRef(syncFeeds);
  syncFeedsRef.current = syncFeeds; // always point at the latest closure
  useEffect(() => {
    if (!signedIn) return;
    if (activeTab !== 'qa' && activeTab !== 'community') return;
    const id = setInterval(() => {
      lastFeedSyncRef.current = 0; // reset throttle so the next call actually runs
      syncFeedsRef.current(false);
    }, 10000);
    return () => clearInterval(id);
  }, [signedIn, activeTab]);

  // ---------- Moderation: report content / block authors ----------
  // Play requires a working report path for UGC. Reports are stored
  // server-side; blocking hides an author's content locally.

  const handleReportContent = ({ contentType, contentId, authorEmail }) => {
    /** @type {import('react-native').AlertButton[]} */
  const actions = [
      {
        text: t.blockUser || 'Block user',
        style: 'destructive',
        onPress: () => {
          if (!authorEmail) return;
          setBlockedUsers(prev => (
            prev.includes(authorEmail) ? prev : [...prev, authorEmail]
          ));
          Alert.alert(t.blockedToast || 'User blocked.');
        },
      },
      {
        text: t.report || 'Report',
        style: 'destructive',
        onPress: async () => {
          const ok = await sendContentReport({
            contentType,
            contentId,
            reporterId: account.email || 'guest',
          });
          Alert.alert(
            ok ? (t.reportedThanks || 'Report received. Thank you.')
               : (t.reportFailed || 'Could not send the report right now.')
          );
        },
      },
      { text: t.cancel || 'Cancel', style: 'cancel' },
    ];
    Alert.alert(t.reportContentTitle || 'Report this content?', '', actions, { cancelable: true });
  };

  // ---------- Avatar resolution (current pictures, offline-safe) ----------
  // Feed items store a snapshot of the author's profile at post time. To show
  // each user's CURRENT picture (and to keep pictures offline), every author
  // identity is resolved through:
  //   1. the signed-in user's live account (edits apply instantly), then
  //   2. the persisted profile directory (server-fetched, per email), then
  //   3. the snapshot stored on the item itself.
  // The avatarCache serves cached pictures with zero network, so avatars keep
  // rendering while offline.
  const resolveProfile = useMemo(() => {
    const selfEmail = String(account?.email || '').trim().toLowerCase();
    return (email, snapshotUser) => {
      if (selfEmail && email && String(email).trim().toLowerCase() === selfEmail) {
        return {
          name: account.fullName || (snapshotUser && snapshotUser.name) || '👤',
          avatarUrl: profilePicture || (snapshotUser && snapshotUser.avatarUrl) || null,
        };
      }
      const dirEntry = email ? profileDirectory[String(email).trim().toLowerCase()] : null;
      return {
        name: (dirEntry && dirEntry.fullName) || (snapshotUser && snapshotUser.name) || '👤',
        avatarUrl:
          (dirEntry && dirEntry.profilePicture) ||
          (snapshotUser && snapshotUser.avatarUrl) ||
          null,
      };
    };
  }, [account?.email, account?.fullName, profilePicture, profileDirectory]);

  // Stamp the freshest avatar/name onto every feed item (memoized: only
  // recomputes when the feeds, the directory or the own account change).
  const applyProfiles = (items, getEmail, getUser) =>
    items.map((item) => {
      const email = getEmail(item);
      const prof = resolveProfile(email, getUser(item));
      return { ...item, user: { ...(getUser(item) || {}), name: prof.name, avatarUrl: prof.avatarUrl } };
    });

  const visibleQAndA = useMemo(
    () =>
      applyProfiles(
        qAndA
          .filter(q => !q.ownerEmail || !blockedUsers.includes(q.ownerEmail))
          .map(q => ({
            ...q,
            answers: (q.answers || [])
              .filter(a => !a.ownerEmail || !blockedUsers.includes(a.ownerEmail))
              .map(a => {
                const aProf = resolveProfile(a.ownerEmail, a.user);
                return { ...a, user: { ...(a.user || {}), name: aProf.name, avatarUrl: aProf.avatarUrl } };
              }),
          })),
        (q) => q.ownerEmail,
        (q) => q.user
      ),
    [qAndA, blockedUsers, resolveProfile]
  );

  const visibleCommunityPosts = useMemo(
    () =>
      applyProfiles(
        communityPosts
          .filter(p => !p.ownerEmail || !blockedUsers.includes(p.ownerEmail))
          .map(p => ({
            ...p,
            comments: (p.comments || [])
              .filter(c => !c.commenterEmail || !blockedUsers.includes(c.commenterEmail))
              .map(c => {
                const cProf = resolveProfile(c.commenterEmail, c.user);
                return { ...c, user: { ...(c.user || {}), name: cProf.name, avatarUrl: cProf.avatarUrl } };
              }),
          })),
        (p) => p.ownerEmail,
        (p) => p.user
      ),
    [communityPosts, blockedUsers, resolveProfile]
  );

  // ---------- Refresh handler (pull-to-refresh) ----------
  // Forces an immediate re-sync of both QA and community feeds. Used by the
  // pull-to-refresh gesture on CommunityTab so users can always force the
  // latest server state even when auto-polling is throttled.
  const handleManualRefresh = React.useCallback(async () => {
    if (!signedIn) return;
    try {
      await syncFeeds(true);
    } catch {
      // Best-effort; ignore failures.
    }
  }, [signedIn, syncFeeds]);

  // ---------- Community Handlers ----------

  const handleCreatePost = async (media) => {
    if (!(newPostText.trim() || media)) return;
    setSharingPost(true);
    try {
      const newPostId = Date.now();

      // Upload the picked image/video to Firebase Storage FIRST so every
      // device receives a permanent https:// URL. Storing the device-local
      // path (file:///data/...) instead would make the media invisible to
      // everyone else and break for the author too once Android clears the
      // picker's cache directory.
      let permanentMedia = null;
      let mediaFailed = false;
      if (media?.uri) {
        try {
          const url = await withTimeout(
            uploadCommunityMedia(media.uri, media.type),
            20000,
            null
          );
          if (url) {
            permanentMedia = { type: media.type, uri: url };
          } else {
            throw new Error('timed out');
          }
        } catch (error) {
          mediaFailed = true;
          console.warn(
            'Media upload failed — post will be shared without media:',
            error?.message || error
          );
          // Do NOT keep the local file:// path: it is invisible to every other
          // user and breaks for the author too once Android clears the picker
          // cache. The post goes out text-only instead (see below).
          permanentMedia = null;
        }
      }

      // Media-only post whose upload failed -> sharing an empty post would be
      // confusing junk. Abort instead so the user can retry. Runs before any
      // state change; setSharingPost(false) happens in the finally block.
      if (mediaFailed && !newPostText.trim()) {
        Alert.alert(
          language === 'tr' ? 'Medya yüklenemedi' : 'Media upload failed',
          language === 'tr'
            ? 'Medya yüklenemediği için gönderi paylaşılamadı. Lütfen tekrar deneyin.'
            : 'Your media could not be uploaded, so the post was not shared. Please try again.',
          [{ text: language === 'tr' ? 'Tamam' : 'OK' }]
        );
        return;
      }

      const newPost = {
        id: newPostId,
        user: {
          name: account.fullName || (language === 'tr' ? 'Misafir Kullanıcı' : 'Guest User'),
          avatar: '👤',
          avatarUrl: profilePicture || null,
        },
        ownerEmail: account.email || null,
        text: newPostText,
        createdAt: new Date(newPostId).toISOString(),
        timestamp: language === 'tr' ? 'şimdi' : 'just now',
        likes: 0,
        likedByMe: false,
        media: permanentMedia,
        comments: [],
      };
      setCommunityPosts(prevPosts => [newPost, ...prevPosts]);
      setNewPostText('');

      // Register this post with the backend so comments/likes from other
      // users can be routed back to you as push notifications. Awaited so the
      // Share button's spinner stays visible until the post is registered,
      // bounded to 15s so a stalled server can't keep the spinner up forever.
      if (account.email) {
        await withTimeout(
          notifyBackendCommunityPost(
            newPostId,
            account.email,
            account.fullName,
            newPostText,
            permanentMedia?.type || null,
            permanentMedia?.uri || null,
            profilePicture || null
          ),
          15000,
          false
        );
      }

    } finally {
      setSharingPost(false);
    }
  };

    const handleLikePost = (postId) => {
    // Read current state before toggling so we only notify on a fresh like.
    const targetPost = communityPosts.find(p => sameId(p.id, postId));
    const willLike = !!targetPost && !targetPost.likedByMe;

    // Optimistic update
    setCommunityPosts(prevPosts => prevPosts.map(p => {
      if (sameId(p.id, postId)) {
        return {
          ...p,
          likes: p.likedByMe ? p.likes - 1 : p.likes + 1,
          likedByMe: !p.likedByMe,
        };
      }
      return p;
    }));

    // Notify the post's author (only for posts by another signed-in user).
    if (
      willLike &&
      targetPost?.ownerEmail &&
      account.email &&
      targetPost.ownerEmail !== account.email
    ) {
      notifyBackendCommunityPostLike(postId, account.email, account.fullName)
        .catch(() => {
          // Rollback optimistic update on failure
          setCommunityPosts(prevPosts => prevPosts.map(p => {
            if (sameId(p.id, postId)) {
              return {
                ...p,
                likes: p.likedByMe ? p.likes - 1 : p.likes + 1,
                likedByMe: !p.likedByMe,
              };
            }
            return p;
          }));
        });
    }
  };

    const handleLikeComment = (postId, commentId) => {
    // Read current state before toggling so we only notify on a fresh like.
    const parentPost = communityPosts.find(p => sameId(p.id, postId));
    const targetComment = parentPost?.comments.find(c => sameId(c.id, commentId));
    const willLike = !!targetComment && !targetComment.likedByMe;

    // Optimistic update
    setCommunityPosts(prevPosts => prevPosts.map(p => {
      if (sameId(p.id, postId)) {
        return {
          ...p,
          comments: p.comments.map(c => {
            if (sameId(c.id, commentId)) {
              return {
                ...c,
                likes: c.likedByMe ? c.likes - 1 : c.likes + 1,
                likedByMe: !c.likedByMe,
              };
            }
            return c;
          }),
        };
      }
      return p;
    }));

    // Notify the comment's author (only for comments by another signed-in user).
    if (
      willLike &&
      targetComment?.commenterEmail &&
      account.email &&
      targetComment.commenterEmail !== account.email
    ) {
      notifyBackendCommunityCommentLike(postId, commentId, account.email, account.fullName)
        .catch(() => {
          // Rollback optimistic update on failure
          setCommunityPosts(prevPosts => prevPosts.map(p => {
            if (sameId(p.id, postId)) {
              return {
                ...p,
                comments: p.comments.map(c => {
                  if (sameId(c.id, commentId)) {
                    return {
                      ...c,
                      likes: c.likedByMe ? c.likes - 1 : c.likes + 1,
                      likedByMe: !c.likedByMe,
                    };
                  }
                  return c;
                }),
              };
            }
            return p;
          }));
        });
    }
  };

  const handlePostComment = (postId) => {
    const commentText = newComment[postId]?.trim();
    if (commentText) {
      const newCommentId = Date.now();
      const newCommentObj = {
        id: newCommentId,
        user: {
          name: account.fullName || (language === 'tr' ? 'Misafir Kullanıcı' : 'Guest User'),
          avatar: '👤',
          avatarUrl: profilePicture || null,
        },
        commenterEmail: account.email || null,
        text: commentText,
        timestamp: language === 'tr' ? 'şimdi' : 'just now',
        likes: 0,
        likedByMe: false,
      };
      setCommunityPosts(prevPosts => prevPosts.map(p => {
        if (sameId(p.id, postId)) {
          return { ...p, comments: [...p.comments, newCommentObj] };
        }
        return p;
      }));
      setNewComment(prev => ({ ...prev, [postId]: '' }));

      // Notify the post's author via the backend (only for posts by another
      // signed-in user; seeded demo posts have no owner to notify).
      const commentedPost = communityPosts.find(p => sameId(p.id, postId));
      if (
        commentedPost?.ownerEmail &&
        account.email &&
        commentedPost.ownerEmail !== account.email
      ) {
        notifyBackendCommunityComment(
          postId,
          newCommentId,
          account.email,
          commentText,
          account.fullName,
          profilePicture || null
        ).catch(() => {});
      }

    }
  };

  // --- Rendering Logic ---
  // Use a clear if/else if/else structure to prevent rendering nothing (white screen).
  if (!signedIn) { // 1. User is not signed in
        return <AuthScreen {...{ styles, t, authMode, setAuthMode, account, setAccount, handleAuthAction, handleForgotPassword, handleGoogleSignIn, handleSendEmailLink, emailLinkSent, palette, theme, authBusy }} />;
  } else if (isNewUser && !profileSetupComplete) { // 2. New user needs to set up their profile
    return <ProfileSetupScreen {...{ styles, palette, t, account, setAccount, occupation, setOccupation, address, setAddress, bio, setBio, handleProfileSetupComplete, theme, profilePicture, setProfilePicture, isGoogleUser }} />;
  } else if (!welcomeScreenShown) { // 3. Any signed-in user who hasn't seen the welcome screen yet
    return <WelcomeScreen {...{ styles, palette, t, now, account, setWelcomeScreenShown, theme }} />;
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.page }]}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={[styles.container, { backgroundColor: palette.shell }]}>
        <View style={styles.topSection}>
          <View>
            <Text style={styles.smallLabel}>{t?.muslimLife || 'Muslim Life'}</Text>
            <Text style={styles.mainTitle}>İslamı öğreniyorum</Text>
          </View>

          <Pressable style={styles.themeButton} onPress={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            <Text style={styles.themeButtonText}>{theme === 'dark' ? '☀️' : '🌙'}</Text>
          </Pressable>
        </View>

        <View style={styles.cityRow}>
          <Text style={styles.cityText}>{city.name}</Text>
          <Text style={styles.timeText}>{formatClock(now)}</Text>
        </View>

        <View style={styles.tabRow}>
          {[
            { key: 'prayer', label: t?.prayer || 'Prayer' },
            { key: 'qa', label: t?.qna || 'Q&A' },
            { key: 'news', label: t?.news || 'News' },
            { key: 'community', label: t?.community || 'Community' },
            { key: 'settings', label: t?.settings || 'Settings' },
          ].map((tab) => (
            <Pressable
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            >
              <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>{tab.label}</Text>
            </Pressable>
          ))}
        </View>

        {activeTab === 'prayer' && <PrayerTab styles={styles} t={t} nextPrayer={nextPrayer} times={times} diffHours={diffHours} diffMinutes={diffMinutes} diffSeconds={diffSeconds} locationName={customLocation ? `${customLocation.name} 📍` : city.name} locating={locating} locationError={locationError} onDetectLocation={handleDetectLocation} sourceLabel={prayerSourceLabel} language={language} palette={palette} prayerAlarms={prayerAlarms} setPrayerAlarms={setPrayerAlarms} notificationsOn={notificationsOn} />}
        {activeTab === 'qa' && (
          <QATab
            styles={styles}
            palette={palette}
            t={t}
            language={language}
            qAndA={visibleQAndA}
            expandedQas={expandedQas}
            setExpandedQas={setExpandedQas}
            newQuestion={newQuestion}
            setNewQuestion={setNewQuestion}
            handleAskQuestion={handleAskQuestion}
            postingQuestion={postingQuestion}
            handleLikeQuestion={handleLikeQuestion}
            handleLikeAnswer={handleLikeAnswer}
            newAnswer={newAnswer}
            setNewAnswer={setNewAnswer}
            handleSubmitAnswer={handleSubmitAnswer}
            answerFormOpen={answerFormOpen}
            setAnswerFormOpen={setAnswerFormOpen}
            handleAIAnswer={handleAIAnswer}
            account={account}
            profilePicture={profilePicture}
            handleEditQuestion={handleEditQuestion}
            handleDeleteQuestion={handleDeleteQuestion}
            handleEditAnswer={handleEditAnswer}
            handleDeleteAnswer={handleDeleteAnswer}
            onReport={handleReportContent}
          />
        )}
        {activeTab === 'news' && <NewsTab styles={styles} projectEvents={projectEvents} t={t} newsItems={newsItems} scholarVideos={scholarVideos} />}
        {activeTab === 'community' && (
          <CommunityTab
            styles={styles}
            palette={palette}
            t={t}
            language={language}
            communityPosts={visibleCommunityPosts}
            newPostText={newPostText}
            setNewPostText={setNewPostText}
            handleCreatePost={handleCreatePost}
            sharingPost={sharingPost}
            handleLikePost={handleLikePost}
            handleLikeComment={handleLikeComment}
            newComment={newComment}
            setNewComment={setNewComment}
            handlePostComment={handlePostComment}
            account={account}
            profilePicture={profilePicture}
            handleEditPost={handleEditPost}
            handleDeletePost={handleDeletePost}
            handleEditComment={handleEditComment}
            handleDeleteComment={handleDeleteComment}
            onReport={handleReportContent}
            onRefresh={handleManualRefresh}
          />
        )}
        {activeTab === 'settings' && <SettingsTab styles={styles} t={t} theme={theme} setTheme={setTheme} language={language} setLanguage={setLanguage} notificationsOn={notificationsOn} setNotificationsOn={setNotificationsOn} soundOptions={soundOptions} notificationSound={notificationSound} setNotificationSound={setNotificationSound} prayerMethod={prayerMethod} setPrayerMethod={setPrayerMethod} prayerSourceLabel={prayerSourceLabel} account={account} setAccount={setAccount} isGoogleUser={isGoogleUser} setIsGoogleUser={setIsGoogleUser} setSignedIn={setSignedIn} profilePicture={profilePicture} setProfilePicture={setProfilePicture} setOccupation={setOccupation} setAddress={setAddress} setBio={setBio} prayerAlarms={prayerAlarms} setPrayerAlarms={setPrayerAlarms} times={times} />}
      </View>
    </SafeAreaView>
  );
}

// Root wrapper: SafeAreaProvider must sit above every SafeAreaView so the
// real system-bar insets (status bar / gesture nav bar under Android 15
// edge-to-edge) are measured once and applied everywhere.
export default function App() {
  return (
    <SafeAreaProvider>
      <AppInner />
    </SafeAreaProvider>
  );
}