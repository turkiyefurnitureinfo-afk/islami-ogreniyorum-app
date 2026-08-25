import React, { useEffect, useMemo, useState } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  Pressable,
  Platform,
  Linking,
  Alert,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  CITIES,
  Q_AND_A,
  PROJECT_EVENTS,
  NEWS_ITEMS,
  SCHOLAR_VIDEOS_FALLBACK,
  SOUND_OPTIONS,
  COMMUNITY_POSTS,
} from './data.js';
import { translations } from './translations.js';
import { computeTimes, formatClock, timeAgo } from './utils.js';
import { getDeviceLocale, localeToLanguage } from './locale.js';
import { detectLocation, autoDetectLocation } from './locationService.js';
import { makeStyles } from './styles.js';
import {
  requestNotificationPermissions,
  cancelAllPrayerNotifications,
  schedulePrayerNotifications,
  setupNotificationChannel,
  registerPrayerAlarmCancellationHandler,
  sendImmediateNotification,
  scheduleEventNotification,
  registerDeviceWithBackend,
  unregisterDeviceFromBackend,
  notifyBackendNewQuestion,
  notifyBackendCommunityPost,
  notifyBackendCommunityComment,
  notifyBackendCommunityPostLike,
  notifyBackendCommunityCommentLike,
  sendContentReport,
} from './notifications.js';
import { signInWithGoogle } from './googleAuth.js';
import { API_URL } from './config.js';
import {
  saveAccount,
  loadAccount,
  clearAccount,
  saveProfile,
  loadProfile,
  saveSettings,
  loadSettings,
  saveWelcomeShown,
  loadWelcomeShown,
  saveQAndA,
  loadQAndA,
  saveCommunityPosts,
  loadCommunityPosts,
  clearAllData,
} from './storage.js';
import PrayerTab from './PrayerTab.js';
import QATab from './QATab.js';
import NewsTab from './NewsTab.js';
import CommunityTab from './CommunityTab.js';
import SettingsTab from './SettingsTab.js';
import AuthScreen from './AuthScreen.js';
import ProfileSetupScreen from './ProfileSetupScreen.js';
import WelcomeScreen from './WelcomeScreen.js';

export default function App() {
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

  // Q&A state
  const [qAndA, setQAndA] = useState(Q_AND_A.tr);
  const [newQuestion, setNewQuestion] = useState('');
  const [newAnswer, setNewAnswer] = useState({});
  const [answerFormOpen, setAnswerFormOpen] = useState({});

  // Community state
  const [communityPosts, setCommunityPosts] = useState(COMMUNITY_POSTS.tr);
  const [newPostText, setNewPostText] = useState('');
  const [newComment, setNewComment] = useState({});

  // Live news & events fetched from the backend news API
  const [liveNews, setLiveNews] = useState([]);
  // Live scholar videos (YouTube) fetched from the backend
  const [liveScholarVideos, setLiveScholarVideos] = useState([]);

  // Load persisted state on startup
  useEffect(() => {
    (async () => {
      const savedAccount = await loadAccount();
      if (savedAccount) {
        setAccount(savedAccount);
        setSignedIn(true);
      }

      const savedProfile = await loadProfile();
      if (savedProfile) {
        setOccupation(savedProfile.occupation || '');
        setAddress(savedProfile.address || '');
        setBio(savedProfile.bio || '');
        setProfilePicture(savedProfile.profilePicture || '');
        setProfileSetupComplete(true);
      }

      const savedSettings = await loadSettings();
      if (savedSettings) {
        if (savedSettings.theme) setTheme(savedSettings.theme);
        if (savedSettings.language) setLanguage(savedSettings.language);
        if (savedSettings.notificationsOn !== undefined) setNotificationsOn(savedSettings.notificationsOn);
        if (savedSettings.notificationSound) setNotificationSound(savedSettings.notificationSound);
        if (savedSettings.prayerMethod) setPrayerMethod(savedSettings.prayerMethod);
        if (Array.isArray(savedSettings.blockedUsers)) setBlockedUsers(savedSettings.blockedUsers);
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
      if (savedCommunity) setCommunityPosts(savedCommunity);

      // Initial load complete -- persistence effects may run from now on.
      setHydrated(true);
    })();
  }, []);

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
        const response = await fetch(`${API_URL}/api/news?lang=${language}`, { method: 'GET' });
        if (response.ok) {
          const data = await response.json();
          if (!cancelled && data && Array.isArray(data.items) && data.items.length > 0) {
            setLiveNews(data.items);
          }
        }
      } catch (error) {
        // Offline / backend unavailable -> fall back to static NEWS_ITEMS.
        console.warn('Live news unavailable, using static data:', error.message);
      }

      // Latest videos from verified Islamic scholar YouTube channels
      try {
        const response = await fetch(`${API_URL}/api/youtube/videos?lang=${language}`, { method: 'GET' });
        if (response.ok) {
          const data = await response.json();
          if (!cancelled && data && Array.isArray(data.items) && data.items.length > 0) {
            setLiveScholarVideos(data.items);
          }
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
    saveSettings({ theme, language, notificationsOn, notificationSound, customLocation, prayerMethod, blockedUsers });
  }, [hydrated, theme, language, notificationsOn, notificationSound, customLocation, prayerMethod, blockedUsers]);

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
  const t = translations[language];
  // Use live news from the backend when available, otherwise fall back to static data.
  const newsItems = (liveNews && liveNews.length > 0 ? liveNews : NEWS_ITEMS[language]);
  const scholarVideos = liveScholarVideos && liveScholarVideos.length > 0 ? liveScholarVideos : SCHOLAR_VIDEOS_FALLBACK;

  // Set up the Android notification channels once at startup
  useEffect(() => {
    setupNotificationChannel();
  }, []);

  // Prayer alarm: dismissing the alarm (tap or the ⏹ Kapat / Stop button)
  // cancels all remaining rings FOR THAT PRAYER -- silent until the next
  // prayer time. Other prayers are never affected. (Hard cap: rings also
  // stop by themselves after 30 minutes.)
  useEffect(() => {
    const subscription = registerPrayerAlarmCancellationHandler();
    return () => subscription.remove();
  }, []);

  // Unregister the device from the backend when the user signs out
  useEffect(() => {
    if (!signedIn && account.email) {
      unregisterDeviceFromBackend(account.email);
    }
  }, [signedIn]);

  // Schedule or cancel prayer notifications based on settings
  useEffect(() => {
    let isActive = true;

    async function syncNotifications() {
      // Only schedule after the user is signed in
      if (!signedIn || !notificationsOn) {
        await cancelAllPrayerNotifications();
        return;
      }

      const granted = await requestNotificationPermissions();
      if (!granted) {
        if (isActive) setNotificationsOn(false);
        return;
      }

      // Compute today's prayer times as a snapshot for scheduling.
      // Prefers the server-provided Diyanet-convention times; falls back to
      // the on-device astronomical calculation when offline.
      const today = new Date();
      const todayTimes = remoteTimes
        ? remoteTimes.timings
        : computeTimes(today, city.lat, city.lng, city.tz, prayerMethod);
      await schedulePrayerNotifications({
        times: todayTimes,
        language,
        sound: notificationSound,
        t,
      });

      // Schedule notifications for upcoming events
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
          sound: notificationSound === 'Sessiz' || notificationSound === 'Silent' ? null : 'default',
          eventDate,
        });
      }
    }

    syncNotifications();

    return () => {
      isActive = false;
    };
  }, [signedIn, notificationsOn, cityKey, customLocation, language, notificationSound, newsItems, remoteTimes, prayerMethod]);

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

  useEffect(() => {
    setQAndA(Q_AND_A[language]);
    setCommunityPosts(COMMUNITY_POSTS[language]);
    setExpandedQas({});
    setNewQuestion('');
    setNewAnswer({});
    setAnswerFormOpen({});
    setNewPostText('');
    setNewComment({});
  }, [language]);

  const styles = useMemo(() => makeStyles(palette), [palette]);

  const handleAuthAction = () => {
    if (authMode === 'signup') {
      setIsNewUser(true);
      if (!account.fullName.trim() || !account.email.trim() || !account.password.trim()) {
        return;
      }
    } else {
      setIsNewUser(false);
      if (!account.email.trim() || !account.password.trim()) {
        return;
      }
    }
    setSignedIn(true);
    saveAccount(account);

    // Register this device with the push notification backend
    registerDeviceWithBackend(account.email, account.fullName);
  };

  const handleGoogleSignIn = async () => {
    const result = await signInWithGoogle();
    if (!result.success) {
      console.log('Google sign-in failed:', result.error);
      return;
    }

    // Set the account from Google's profile
    setAccount({
      fullName: result.user.name,
      email: result.user.email,
      password: '',
    });

    // Use Google's profile picture
    setProfilePicture(result.user.picture);
    setIsGoogleUser(true);
    setSignedIn(true);
    setIsNewUser(false);
    saveAccount({ fullName: result.user.name, email: result.user.email, password: '' });

    // Register this device with the push notification backend
    registerDeviceWithBackend(result.user.email, result.user.name);
  };

  const handleProfileSetupComplete = () => {
    // Save the profile data (occupation, address, bio, profile picture)
    setProfileSetupComplete(true);
    saveProfile({ occupation, address, bio, profilePicture });
  };

  // ---------- Q&A Handlers ----------

  const handleAskQuestion = () => {
    if (newQuestion.trim()) {
      const newQ = {
        id: Date.now(),
        question: newQuestion,
        answer: '',
        source: '',
        href: '',
        likes: 0,
        likedByMe: false,
        ownerEmail: account.email || null,
        answers: [],
      };
      setQAndA(prev => [newQ, ...prev]);
      setNewQuestion('');

      // Notify the community about the new question
      if (notificationsOn) {
        sendImmediateNotification(
          language === 'tr' ? 'Yeni Soru' : 'New Question',
          language === 'tr'
            ? `Toplulukta yeni soru soruldu: "${newQuestion.slice(0, 60)}${newQuestion.length > 60 ? '...' : ''}"`
            : `A new question was asked: "${newQuestion.slice(0, 60)}${newQuestion.length > 60 ? '...' : ''}"`,
          notificationSound === 'Sessiz' || notificationSound === 'Silent' ? null : 'default'
        );
      }

      // Register the question with the backend so other users get a push,
      // then store the server-assigned ID on this question so later answers
      // and likes can be routed back to the right authors.
      notifyBackendNewQuestion(account.email || 'guest', newQuestion.trim(), account.fullName || null)
        .then((result) => {
          if (result && result.ok && result.postId) {
            setQAndA(prev => prev.map(q => (
              q.id === newQ.id ? { ...q, serverPostId: result.postId } : q
            )));
          }
        })
        .catch(() => {});
    }
  };

  const handleLikeQuestion = (questionId) => {
    setQAndA(prev => prev.map(q => {
      if (q.id === questionId) {
        return {
          ...q,
          likes: q.likedByMe ? q.likes - 1 : q.likes + 1,
          likedByMe: !q.likedByMe,
        };
      }
      return q;
    }));
  };

  const handleLikeAnswer = (questionId, answerId) => {
    // Read current state before toggling so we only notify on a fresh like.
    const likedQuestion = qAndA.find(x => x.id === questionId);
    const likedAnswer = likedQuestion?.answers.find(a => a.id === answerId);
    const willLike = !!likedAnswer && !likedAnswer.likedByMe;

    setQAndA(prev => prev.map(q => {
      if (q.id === questionId) {
        return {
          ...q,
          answers: q.answers.map(a => {
            if (a.id === answerId) {
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
      ).catch(() => {});
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

  // AI: generate an answer for a Q&A question via the backend
  const handleAIAnswer = async (questionId) => {
    const question = qAndA.find(q => q.id === questionId);
    if (!question || question.aiAnswerLoading) return;

    // Mark this question as loading
    setQAndA(prev => prev.map(q => q.id === questionId ? { ...q, aiAnswerLoading: true, aiError: undefined } : q));

    try {
      const response = await fetch(`${API_URL}/api/ai/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question.question, language }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'AI answer failed');
      }

      const aiAnswer = {
        id: Date.now(),
        user: {
          name: language === 'tr' ? 'İslamı öğreniyorum AI' : 'I am Learning Islam AI',
          avatar: '🤖',
        },
        text: data.answer,
        timestamp: language === 'tr' ? 'şimdi' : 'just now',
        likes: 0,
        likedByMe: false,
        isAI: true,
        aiProvider: data.provider || 'builtin',
      };

      setQAndA(prev => prev.map(q => {
        if (q.id === questionId) {
          return {
            ...q,
            aiAnswerLoading: false,
            aiAnswer: aiAnswer,
            answers: [...q.answers, aiAnswer],
          };
        }
        return q;
      }));
    } catch (error) {
      console.error('AI answer error:', error);
      setQAndA(prev => prev.map(q => q.id === questionId
        ? {
            ...q,
            aiAnswerLoading: false,
            aiError: language === 'tr' ? 'AI cevabı alınamadı.' : 'Could not get an AI answer.',
            aiFallbackUrl: `https://www.google.com/search?q=${encodeURIComponent(question.question)}`,
          }
        : q
      ));
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
        },
        text: answerText,
        timestamp: language === 'tr' ? 'şimdi' : 'just now',
        likes: 0,
        likedByMe: false,
        ownerEmail: account.email || null,
      };
      setQAndA(prev => prev.map(q => {
        if (q.id === questionId) {
          return { ...q, answers: [...q.answers, newAns] };
        }
        return q;
      }));
      setNewAnswer(prev => ({ ...prev, [questionId]: '' }));
      setAnswerFormOpen(prev => ({ ...prev, [questionId]: false }));

      // Notify the question's author via the backend. Only possible when this
      // question was registered server-side (it has a serverPostId).
      const answeredQuestion = qAndA.find(q => q.id === questionId);
      if (answeredQuestion?.serverPostId) {
        notifyBackendNewContribution(
          answeredQuestion.serverPostId,
          account.email || 'guest',
          answerText,
          account.fullName || null
        )
          .then((result) => {
            if (result && result.ok && result.contributionId) {
              // Remember the server contribution ID so later likes on this
              // answer can notify its author.
              setQAndA(prev => prev.map(q => (
                q.id === questionId
                  ? {
                      ...q,
                      answers: q.answers.map(a => (
                        a.id === newAns.id ? { ...a, serverContribId: result.contributionId } : a
                      )),
                    }
                  : q
              )));
            }
          })
          .catch(() => {});
      }

      // Notify about the new answer
      if (notificationsOn) {
        sendImmediateNotification(
          language === 'tr' ? 'Yeni Cevap' : 'New Answer',
          language === 'tr'
            ? `Sorunuzuna yeni cevap geldi: "${answerText.slice(0, 60)}${answerText.length > 60 ? '...' : ''}"`
            : `Your question got a new answer: "${answerText.slice(0, 60)}${answerText.length > 60 ? '...' : ''}"`,
          notificationSound === 'Sessiz' || notificationSound === 'Silent' ? null : 'default'
        );
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
      q.id === questionId && isOwnContent(q.ownerEmail)
        ? { ...q, question: text }
        : q
    )));
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
          onPress: () => setQAndA(prev => prev.filter(q => !(
            q.id === questionId && isOwnContent(q.ownerEmail)
          ))),
        },
      ]
    );
  };

  const handleEditAnswer = (questionId, answerId, newText) => {
    const text = (newText || '').trim();
    if (!text) return;
    setQAndA(prev => prev.map(q => (
      q.id === questionId
        ? {
            ...q,
            answers: q.answers.map(a => (
              a.id === answerId && isOwnContent(a.ownerEmail) ? { ...a, text } : a
            )),
          }
        : q
    )));
  };

  const handleDeleteAnswer = (questionId, answerId) => {
    Alert.alert(
      t.deleteAnswerConfirm || 'Delete this answer?',
      '',
      [
        { text: t.cancel || 'Cancel', style: 'cancel' },
        {
          text: t.delete || 'Delete',
          style: 'destructive',
          onPress: () => setQAndA(prev => prev.map(q => (
            q.id === questionId
              ? { ...q, answers: q.answers.filter(a => !(
                  a.id === answerId && isOwnContent(a.ownerEmail)
                )) }
              : q
          ))),
        },
      ]
    );
  };

  // --- Community ---
  const handleEditPost = (postId, newText) => {
    const text = (newText || '').trim();
    if (!text) return;
    setCommunityPosts(prev => prev.map(p => (
      p.id === postId && isOwnContent(p.ownerEmail) ? { ...p, text } : p
    )));
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
          onPress: () => setCommunityPosts(prev => prev.filter(p => !(
            p.id === postId && isOwnContent(p.ownerEmail)
          ))),
        },
      ]
    );
  };

  const handleEditComment = (postId, commentId, newText) => {
    const text = (newText || '').trim();
    if (!text) return;
    setCommunityPosts(prev => prev.map(p => (
      p.id === postId
        ? {
            ...p,
            comments: p.comments.map(c => (
              c.id === commentId && isOwnContent(c.commenterEmail) ? { ...c, text } : c
            )),
          }
        : p
    )));
  };

  const handleDeleteComment = (postId, commentId) => {
    Alert.alert(
      t.deleteCommentConfirm || 'Delete this comment?',
      '',
      [
        { text: t.cancel || 'Cancel', style: 'cancel' },
        {
          text: t.delete || 'Delete',
          style: 'destructive',
          onPress: () => setCommunityPosts(prev => prev.map(p => (
            p.id === postId
              ? { ...p, comments: p.comments.filter(c => !(
                  c.id === commentId && isOwnContent(c.commenterEmail)
                )) }
              : p
          ))),
        },
      ]
    );
  };

  // ---------- Shared feed sync ----------
  // Pulls everyone's questions/posts from the backend and merges them into
  // the local-first stores, so users actually see each other's content.
  // Offline / sleeping-server => silent no-op, local experience untouched.

  const lastFeedSyncRef = React.useRef(0);

  function normalizeServerQA(doc) {
    return {
      id: 'srv-' + doc.id,
      serverPostId: doc.id,
      question: doc.question || '',
      answer: '',
      source: '',
      href: '',
      likes: doc.likes || 0,
      likedByMe: false,
      ownerEmail: doc.ownerUserId || null,
      answers: (doc.contributions || []).map((c) => ({
        id: 'srv-' + doc.id + '-' + c.id,
        serverContribId: c.id,
        user: { name: c.authorName || '👤', avatar: '👤' },
        text: c.text || '',
        timestamp: timeAgo(c.createdAt, language),
        likes: c.likes || 0,
        likedByMe: false,
        ownerEmail: c.userId || null,
      })),
      timestamp: timeAgo(doc.createdAt, language),
    };
  }

  function normalizeServerCommunityPost(doc) {
    return {
      // Firestore doc id == the author's original local numeric post id, so
      // comment/like routing keeps working on other devices.
      id: doc.id,
      user: { name: doc.authorName || '👤', avatar: '👤' },
      ownerEmail: doc.ownerUserId || null,
      text: doc.text || '',
      timestamp: timeAgo(doc.createdAt, language),
      likes: doc.likes || 0,
      likedByMe: false,
      media:
        doc.mediaType && doc.mediaUri
          ? { type: doc.mediaType, uri: doc.mediaUri }
          : null,
      comments: (doc.comments || []).map((c) => ({
        id: 'srv-' + doc.id + '-' + c.id,
        user: { name: c.authorName || '👤', avatar: '👤' },
        commenterEmail: c.userId || null,
        text: c.text || '',
        timestamp: timeAgo(c.createdAt, language),
        likes: 0,
        likedByMe: false,
      })),
    };
  }

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
          const serverQ = data.items.map(normalizeServerQA);
          const serverById = new Map(serverQ.map((q) => [q.serverPostId, q]));
          setQAndA((prev) => {
            const out = [];
            for (const item of prev) {
              if (item.serverPostId && serverById.has(item.serverPostId)) {
                // Refresh our synced copy but keep identity & like state.
                const fresh = serverById.get(item.serverPostId);
                out.push({
                  ...fresh,
                  id: item.id,
                  likedByMe: item.likedByMe,
                  ownerEmail: item.ownerEmail || fresh.ownerEmail,
                });
                serverById.delete(item.serverPostId);
              } else if (!item.serverPostId && !item.ownerEmail) {
                // Seeded sample content: keep only while there's no real feed.
                if (serverQ.length === 0) out.push(item);
              } else {
                out.push(item); // my unsynced drafts or orphans
              }
            }
            for (const remaining of serverById.values()) out.push(remaining);
            return out;
          });
        }
      }

      if (commRes && commRes.ok) {
        const data = await commRes.json().catch(() => null);
        if (data && Array.isArray(data.items)) {
          const serverP = data.items.map(normalizeServerCommunityPost);
          const byRawId = new Map(serverP.map((p) => [String(p.id), p]));
          setCommunityPosts((prev) => {
            const out = [];
            const consumed = new Set();
            for (const post of prev) {
              const key = String(post.id);
              const match = byRawId.get(key);
              if (match) {
                consumed.add(key);
                out.push({
                  ...match,
                  id: post.id,
                  ownerEmail: post.ownerEmail || match.ownerEmail,
                  likedByMe: post.likedByMe,
                });
              } else {
                out.push(post);
              }
            }
            for (const p of serverP) {
              if (!consumed.has(String(p.id))) out.push(p);
            }
            return out;
          });
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

  // ---------- Moderation: report content / block authors ----------
  // Play requires a working report path for UGC. Reports are stored
  // server-side; blocking hides an author's content locally.

  const handleReportContent = ({ contentType, contentId, authorEmail }) => {
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

  // Hide blocked authors from both feeds (and their nested answers/comments).
  const visibleQAndA = useMemo(() => (
    qAndA
      .filter(q => !q.ownerEmail || !blockedUsers.includes(q.ownerEmail))
      .map(q => ({
        ...q,
        answers: (q.answers || []).filter(a => !a.ownerEmail || !blockedUsers.includes(a.ownerEmail)),
      }))
  ), [qAndA, blockedUsers]);

  const visibleCommunityPosts = useMemo(() => (
    communityPosts
      .filter(p => !p.ownerEmail || !blockedUsers.includes(p.ownerEmail))
      .map(p => ({
        ...p,
        comments: (p.comments || []).filter(c => !c.commenterEmail || !blockedUsers.includes(c.commenterEmail)),
      }))
  ), [communityPosts, blockedUsers]);

  // ---------- Community Handlers ----------

  const handleCreatePost = (media) => {
    if (newPostText.trim() || media) {
      const newPostId = Date.now();
      const newPost = {
        id: newPostId,
        user: {
          name: account.fullName || (language === 'tr' ? 'Misafir Kullanıcı' : 'Guest User'),
          avatar: '👤',
        },
        ownerEmail: account.email || null,
        text: newPostText,
        timestamp: language === 'tr' ? 'şimdi' : 'just now',
        likes: 0,
        likedByMe: false,
        media: media || null,
        comments: [],
      };
      setCommunityPosts(prevPosts => [newPost, ...prevPosts]);
      setNewPostText('');

      // Register this post with the backend so comments/likes from other
      // users can be routed back to you as push notifications.
      if (account.email) {
        notifyBackendCommunityPost(
          newPostId,
          account.email,
          account.fullName,
          newPostText,
          media?.type || null,
          media?.uri || null
        ).catch(() => {});
      }

      // Notify the community about the new post
      if (notificationsOn) {
        sendImmediateNotification(
          language === 'tr' ? 'Yeni Gönderi' : 'New Post',
          language === 'tr'
            ? `Toplulukta yeni gönderi paylaşıldı: "${newPostText.slice(0, 60)}${newPostText.length > 60 ? '...' : ''}"`
            : `A new post was shared: "${newPostText.slice(0, 60)}${newPostText.length > 60 ? '...' : ''}"`,
          notificationSound === 'Sessiz' || notificationSound === 'Silent' ? null : 'default'
        );
      }
    }
  };

  const handleLikePost = (postId) => {
    // Read current state before toggling so we only notify on a fresh like.
    const targetPost = communityPosts.find(p => p.id === postId);
    const willLike = !!targetPost && !targetPost.likedByMe;

    setCommunityPosts(prevPosts => prevPosts.map(p => {
      if (p.id === postId) {
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
        .catch(() => {});
    }
  };

  const handleLikeComment = (postId, commentId) => {
    // Read current state before toggling so we only notify on a fresh like.
    const parentPost = communityPosts.find(p => p.id === postId);
    const targetComment = parentPost?.comments.find(c => c.id === commentId);
    const willLike = !!targetComment && !targetComment.likedByMe;

    setCommunityPosts(prevPosts => prevPosts.map(p => {
      if (p.id === postId) {
        return {
          ...p,
          comments: p.comments.map(c => {
            if (c.id === commentId) {
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
        .catch(() => {});
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
        },
        commenterEmail: account.email || null,
        text: commentText,
        timestamp: language === 'tr' ? 'şimdi' : 'just now',
        likes: 0,
        likedByMe: false,
      };
      setCommunityPosts(prevPosts => prevPosts.map(p => {
        if (p.id === postId) {
          return { ...p, comments: [...p.comments, newCommentObj] };
        }
        return p;
      }));
      setNewComment(prev => ({ ...prev, [postId]: '' }));

      // Notify the post's author via the backend (only for posts by another
      // signed-in user; seeded demo posts have no owner to notify).
      const commentedPost = communityPosts.find(p => p.id === postId);
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
          account.fullName
        ).catch(() => {});
      }

      // Notify about the new comment
      if (notificationsOn) {
        sendImmediateNotification(
          language === 'tr' ? 'Yeni Yorum' : 'New Comment',
          language === 'tr'
            ? `Gönderinize yeni yorum geldi: "${commentText.slice(0, 60)}${commentText.length > 60 ? '...' : ''}"`
            : `Your post got a new comment: "${commentText.slice(0, 60)}${commentText.length > 60 ? '...' : ''}"`,
          notificationSound === 'Sessiz' || notificationSound === 'Silent' ? null : 'default'
        );
      }
    }
  };

  // --- Rendering Logic ---
  // Use a clear if/else if/else structure to prevent rendering nothing (white screen).
  if (!signedIn) { // 1. User is not signed in
    return <AuthScreen {...{ styles, t, authMode, setAuthMode, account, setAccount, handleAuthAction, handleGoogleSignIn, palette, theme }} />;
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
            <Text style={styles.smallLabel}>{t.muslimLife}</Text>
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
            { key: 'prayer', label: t.prayer },
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

        {activeTab === 'prayer' && <PrayerTab styles={styles} t={t} nextPrayer={nextPrayer} times={times} diffHours={diffHours} diffMinutes={diffMinutes} diffSeconds={diffSeconds} locationName={customLocation ? `${customLocation.name} 📍` : city.name} locating={locating} locationError={locationError} onDetectLocation={handleDetectLocation} sourceLabel={prayerSourceLabel} />}
        {activeTab === 'qa' && (
          <QATab
            styles={styles}
            palette={palette}
            t={t}
            qAndA={visibleQAndA}
            expandedQas={expandedQas}
            setExpandedQas={setExpandedQas}
            newQuestion={newQuestion}
            setNewQuestion={setNewQuestion}
            handleAskQuestion={handleAskQuestion}
            handleLikeQuestion={handleLikeQuestion}
            handleLikeAnswer={handleLikeAnswer}
            newAnswer={newAnswer}
            setNewAnswer={setNewAnswer}
            handleSubmitAnswer={handleSubmitAnswer}
            answerFormOpen={answerFormOpen}
            setAnswerFormOpen={setAnswerFormOpen}
            handleAIAnswer={handleAIAnswer}
            account={account}
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
            communityPosts={visibleCommunityPosts}
            newPostText={newPostText}
            setNewPostText={setNewPostText}
            handleCreatePost={handleCreatePost}
            handleLikePost={handleLikePost}
            handleLikeComment={handleLikeComment}
            newComment={newComment}
            setNewComment={setNewComment}
            handlePostComment={handlePostComment}
            account={account}
            handleEditPost={handleEditPost}
            handleDeletePost={handleDeletePost}
            handleEditComment={handleEditComment}
            handleDeleteComment={handleDeleteComment}
            onReport={handleReportContent}
          />
        )}
        {activeTab === 'settings' && <SettingsTab styles={styles} t={t} theme={theme} setTheme={setTheme} language={language} setLanguage={setLanguage} notificationsOn={notificationsOn} setNotificationsOn={setNotificationsOn} soundOptions={soundOptions} notificationSound={notificationSound} setNotificationSound={setNotificationSound} prayerMethod={prayerMethod} setPrayerMethod={setPrayerMethod} prayerSourceLabel={prayerSourceLabel} account={account} setAccount={setAccount} saveAccount={saveAccount} isGoogleUser={isGoogleUser} setSignedIn={setSignedIn} />}
      </View>
    </SafeAreaView>
  );
}