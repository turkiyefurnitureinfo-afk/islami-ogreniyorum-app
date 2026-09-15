// ---------------------------------------------------------------------------
// Question answering — SERVER-ONLY (Serper.dev Google search + Groq synthesis).
// ---------------------------------------------------------------------------
// getAIAnswer() flow:
//   1. AsyncStorage cache — repeated questions answer instantly (no server quota).
//   2. Backend /api/ai/chat — Serper.dev Google results synthesized by Groq
//      (concise, sourced, conversational Islamic assistant).
//   3. Backend /api/ai/answer — legacy search pipeline (same server keys).
//      Fallback if /api/ai/chat is unavailable.
//   4. Friendly fallback text — formatted chatbot-style when the server can't
//      answer (no on-device provider — DuckDuckGo/Wikipedia removed).
//
// No client-side API keys required.

// Per-request timeout guarding stalled sockets so answers stay immediate.
const WEB_SEARCH_TIMEOUT_MS = 10000;





/** Safe AbortSignal.timeout with fallback for older RN runtimes. */
function timeoutSignal(ms) {
  try {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      return AbortSignal.timeout(ms);
    }
  } catch { /* fall through to manual controller */ }
  try {
    const controller = new AbortController();
    setTimeout(() => { try { controller.abort(); } catch {} }, ms);
    return controller.signal;
  } catch {
    return undefined;
  }
}

async function fetchJson(url, opts = {}) {
  let res;
  try {
    res = await fetch(url, {
      ...opts,
      signal: opts.signal || timeoutSignal(WEB_SEARCH_TIMEOUT_MS),
    });
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      throw Object.assign(new Error('Request timed out'), { status: 408, timeout: true });
    }
    throw error instanceof Error ? error : new Error(String(error));
  }
  if (!res.ok) {
    throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error('Failed to parse JSON response');
  }
  if (data == null || typeof data !== 'object') {
    throw new Error('Unexpected empty JSON response');
  }
  return data;
}











// ---------------------------------------------------------------------------
// ASYNCSTORAGE PERSISTENCE for AI answers
// ---------------------------------------------------------------------------
// Auto-generated search answers are kept LOCAL to the user's device so search
// limits aren't burned by other users, and so answers survive app restarts.
// Stored under @app/qanda as a JSON map of question -> answer.
// ---------------------------------------------------------------------------

/**
 * Load the persisted AI answers map from AsyncStorage.
 * @returns {Promise<Record<string, {answer:string, provider:string, sources?:Array, savedAt:number}>>}
 */
export async function loadPersistedAIAnswers() {
  try {
    const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
    const raw = await AsyncStorage.getItem('@app/qanda_ai_answers');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.warn('[AI] Failed to load persisted answers:', error?.message || error);
    return {};
  }
}

/**
 * Save a single AI answer to AsyncStorage, keyed by the normalized question.
 * Caps the cache at 200 entries (oldest by savedAt evicted).
 * @param {string} question
 * @param {{answer:string, provider:string, sources?:Array}} answer
 */
export async function persistAIAnswer(question, answer) {
  if (!question || !answer) return;
  try {
    const store = await loadPersistedAIAnswers();
    const key = question.trim().slice(0, 200);
    store[key] = { ...answer, savedAt: Date.now() };
    // Evict oldest entries if cache exceeds 200.
    const entries = Object.entries(store).sort((a, b) => (b[1].savedAt || 0) - (a[1].savedAt || 0));
    if (entries.length > 200) {
      const trimmed = entries.slice(0, 200);
      const trimmedStore = {};
      for (const [k, v] of trimmed) trimmedStore[k] = v;
      const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
      await AsyncStorage.setItem('@app/qanda_ai_answers', JSON.stringify(trimmedStore));
      return;
    }
    const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
    await AsyncStorage.setItem('@app/qanda_ai_answers', JSON.stringify(store));
  } catch (error) {
    console.warn('[AI] Failed to persist answer:', error?.message || error);
  }
}

/**
 * Look up a previously-generated answer for a question (cache hit avoids a
 * network round-trip). Returns null on cache miss.
 * @param {string} question
 * @returns {Promise<{answer:string, provider:string, sources?:Array}|null>}
 */
export async function getPersistedAIAnswer(question) {
  if (!question) return null;
  const store = await loadPersistedAIAnswers();
  const key = question.trim().slice(0, 200);
  const entry = store[key];
  if (!entry) return null;
  // Return without the internal savedAt field.
  const { savedAt, ...answer } = entry;
  return answer;
}

// Lazy import for the Firebase Web SDK app — reused by mediaService.js
// (Firebase Storage) so both features share a single initialised app instance.
let _firebaseApp = null;

async function getFirebaseAppModules() {
  if (!_firebaseApp) {
    _firebaseApp = await import('firebase/app');
  }
  return _firebaseApp;
}

import Constants from 'expo-constants';
import { API_URL } from './config.js';

// Web-app config for THIS Firebase project (islami-ogreniyorum). These are
// public, client-side identifiers — the same values Firebase publishes in
// Project Settings. Read from expo-constants (configured in app.json) so they
// can be changed without modifying source code. Falls back to the values
// from app.json for development.
const FIREBASE_WEB_CONFIG = {
  apiKey: Constants?.expoConfig?.extra?.firebaseWebConfig?.apiKey || 'AIzaSyDwIT4O1c_24SzLx42CuI36mjYhX24YFcY',
  authDomain: Constants?.expoConfig?.extra?.firebaseWebConfig?.authDomain || 'islami-ogreniyorum.firebaseapp.com',
  projectId: Constants?.expoConfig?.extra?.firebaseWebConfig?.projectId || 'islami-ogreniyorum',
  storageBucket: Constants?.expoConfig?.extra?.firebaseWebConfig?.storageBucket || 'islami-ogreniyorum.firebasestorage.app',
  messagingSenderId: Constants?.expoConfig?.extra?.firebaseWebConfig?.messagingSenderId || '817195380589',
  appId: Constants?.expoConfig?.extra?.firebaseWebConfig?.appId || '1:817195380589:android:aa2049bbae8fb9f7c9b464',
};

// Hard ceiling for one search/AI request so the UI never hangs on a stalled
// socket.
const AI_TIMEOUT_MS = 25000;

// The unified answer shape returned by getAIAnswer().
// @typedef {{answer: string, provider: string, sources?: Array}} AIAnswer

let appInstance = null;

/** Initialise (once) and return the Firebase JS app used for AI calls.
 *  Also reused by mediaService.js (Firebase Storage uploads) so both features
 *  share a single initialised app instance. */
export async function getFirebaseApp() {
  if (!appInstance) {
    const firebaseApp = await getFirebaseAppModules();
    appInstance = firebaseApp.getApps().length > 0 
      ? firebaseApp.getApp() 
      : firebaseApp.initializeApp(FIREBASE_WEB_CONFIG);
  }
  return appInstance;
}

/** True when the embedded Firebase config is present (always true in builds). */
export function isAIConfigured() {
  return Boolean(
    FIREBASE_WEB_CONFIG.apiKey &&
      FIREBASE_WEB_CONFIG.projectId &&
      FIREBASE_WEB_CONFIG.appId
  );
}

/**
 * Get an answer for a community question — EXCLUSIVELY from the backend
 * Serper.dev (Google) + Groq synthesis pipeline:
 *
 *   Tier 1 (primary): backend /api/ai/chat — Serper.dev Google results
 *     synthesized by Groq into a concise sourced answer.
 *   Tier 2: backend /api/ai/answer — legacy search pipeline (same server
 *     keys). Fallback if /api/ai/chat is unavailable.
 *
 * Answers are cached locally in AsyncStorage so repeated questions resolve
 * instantly and server quota isn't wasted.
 *
 * @param {string} question - the user's question
 * @param {'tr'|'en'} language - 'tr' or 'en'
 * @returns {Promise<{answer: string, provider: string, sources?: Array}>}
 *   the generated answer
 * @throws {Error} when no provider can produce an answer (offline etc.).
 */
export async function getAIAnswer(question, language = 'tr') {
  if (!question || typeof question !== 'string') {
    throw new Error('Question must be a non-empty string');
  }
  // Cap the payload the model sees (cost + abuse protection).
  const safeQuestion = question.trim().slice(0, 1000);
  if (safeQuestion.length < 2) {
    throw new Error('Question is too short');
  }

  // ---------------------------------------------------------------------
  // CACHE CHECK: return a previously-generated answer immediately so we
  // don't burn server quota on repeated questions.
  // ---------------------------------------------------------------------
  try {
    const cached = await getPersistedAIAnswer(safeQuestion);
    if (cached) {
      console.log('[AI] Cache hit for:', safeQuestion);
      return cached;
    }
  } catch (error) {
    console.warn('[AI] Cache read failed:', error?.message || error);
  }

  // ---------------------------------------------------------------------
  // PRIMARY SOURCE: backend Serper.dev (Google) + Groq synthesis pipeline.
  // The server holds SERPER_API_KEY + GROQ_API_KEY, so answers are real,
  // sourced Google results synthesized by Groq.
  // ---------------------------------------------------------------------
  console.log('[AI] Attempting server answer (Serper+Groq) for:', safeQuestion);
  try {
    const serverAnswer = await fetchServerAIAnswer(safeQuestion, language);
    if (serverAnswer) {
      console.log('[AI] Server answer succeeded, provider:', serverAnswer.provider);
      // Persist the answer locally (fire-and-forget — never block the UI).
      persistAIAnswer(safeQuestion, serverAnswer).catch(() => {});
      return serverAnswer;
    }
    console.warn('[AI] Server answer returned null/empty — returning safe guidance');
  } catch (error) {
    // Surface the warming-up signal to the caller (don't swallow it).
    if (error.isWarmingUp) throw error;
    console.warn('[AI] Server answer failed, returning safe guidance:', error?.message || error);
  }
  // Nothing worked — surface a friendly, actionable message.
  console.error('[AI] All providers failed for question:', safeQuestion);
  const tr = language === 'tr';
  throw new Error(
    tr
      ? 'Sorunuzu şu an cevaplayamıyorum. Lütfen internet bağlantınızı kontrol edin veya sorunuzu farklı kelimelerle yeniden sorun. Dinî hükümler için Diyanet İşleri Başkanlığı\'nın resmî sitesine (diyanet.gov.tr) bakabilirsiniz.'
      : 'I cannot answer your question right now. Please check your internet connection or try rephrasing your question. For religious rulings, please refer to the official Diyanet website (diyanet.gov.tr).'
  );
}

/**
 * PRIMARY answer source: ask our own server (Render) for an answer via the
 * Serper.dev (Google) + Groq synthesis pipeline: POST /api/ai/chat first,
 * then legacy POST /api/ai/answer. Returns null only when the server is
 * unreachable or returns no answer.
 *
 * @param {string} question
 * @param {'tr'|'en'} language
 * @returns {Promise<{answer:string, provider:string, model?:string}|null>}
 *   null when the server has no answer (non-OK / offline / timeout).
 * @throws {{isWarmingUp:boolean}} when the HF model is warming up (HTTP 503).
 */
async function fetchServerAIAnswer(question, language) {
  for (const endpoint of ['/api/ai/chat', '/api/ai/answer']) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    try {
      const resp = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, language }),
        signal: controller.signal,
      });
      // Hugging Face 503 = model warming up. Surface this so the UI can retry.
      if (resp.status === 503) {
        const data = await resp.json().catch(() => ({}));
        if (data && data.isWarmingUp) {
          const err = new Error(data.error || 'Model warming up');
          err.isWarmingUp = true;
          throw err;
        }
      }
      if (!resp.ok) continue; // try next endpoint
      const data = await resp.json().catch(() => null);
      if (!data || !data.success || !data.answer) continue;
      return {
        answer: String(data.answer),
        provider: data.provider || 'groq',
        ...(data.model ? { model: data.model } : {}),
        ...(Array.isArray(data.sources) && data.sources.length > 0
          ? { sources: data.sources }
          : {}),
      };
    } catch (error) {
      if (error.isWarmingUp) throw error; // re-throw warming-up signal
      // Return null only when we've exhausted all endpoints
      if (endpoint === '/api/ai/answer') {
        console.warn('Server AI unavailable:', error?.message || error);
        return null;
      }
      // First endpoint failed (offline / timeout / Render sleeping) — try legacy.
      console.warn(`Server ${endpoint} failed, trying fallback:`, error?.message || error);
    } finally {
      clearTimeout(timer);
    }
  }
  // Explicitly return null if loop completes without finding an answer
  return null;
}

/**
 * Detect configuration-level failures (service not enabled in the Firebase
 * project, blocked API key, permission denied) so the UI can show a hint that
 * actually helps instead of a generic retry message.
 *
 * @param {any} error
 * @returns {boolean}
 */
export function isAIConfigError(error) {
  const text = `${error?.code || ''} ${error?.message || ''}`;
  return /PERMISSION_DENIED|403|api key|API key|api_key|not been used|disabled|permission|failed-precondition|generativelanguage|not allowed|restricted/i.test(
    text
  );
}

/**
 * Human-readable, localized explanation of an answer failure — the message the
 * UI shows in the Q&A tab when an answer could not be generated.
 *
 * @param {any} error
 * @param {'tr'|'en'} [language]
 * @returns {string}
 */
export function describeAIError(error, language = 'tr') {
  const text = `${error?.code || ''} ${error?.message || ''}`;
  const tr = language === 'tr';

  // Hugging Face model warming up (cold start on the free tier) — the most
  // actionable error: tell the user to retry in a few seconds.
  if (error?.isWarmingUp || /warming up|model is warming/i.test(text)) {
    return tr
      ? 'AI modeli şu an ısınıyor (ücretsiz katman). Lütfen 10-15 saniye sonra tekrar deneyin.'
      : 'The AI model is warming up (free tier). Please try again in 10-15 seconds.';
  }

  // Network-level failures (offline, timeout, DNS, HTTP 4xx/5xx) — the most
  // common failure mode for server-sourced answers.
  if (
    /network|timeout|timed out|abort|offline|fetch failed|http 5\d\d|http 4\d\d/i.test(
      text
    )
  ) {
    return tr
      ? 'Cevap üretilirken bir bağlantı sorunu oluştu. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.'
      : 'A connection problem occurred while generating the answer. Please check your internet connection and try again.';
  }
  return tr
    ? 'Şu anda cevap alınamadı. Lütfen birkaç saniye sonra tekrar deneyin.'
    : 'Could not get an answer right now. Please try again in a moment.';
}

// ---------------------------------------------------------------------------
// Community translation — keyless, search-based (no Gemini dependency).
// Turkish ↔ English so every user can read every post regardless of language.
// ---------------------------------------------------------------------------

/**
 * Translate arbitrary text between Turkish and English.
 *
 * The previous implementation called Gemini, whose free-tier quota has been
 * exhausted. It is now a KEYLESS two-stage pipeline that works everywhere:
 *   1. MyMemory translation API (free, no key, ~5000 chars/day per IP).
 *   2. A built-in offline Turkish↔English glossary for common community
 *      words, used when the network path is unavailable.
 *
 * @param {string} text - text to translate
 * @returns {Promise<{ translated: string, sourceLang: 'tr'|'en', targetLang: 'tr'|'en' }>}
 *   Falls back through server → MyMemory → glossary → throws.
 */
export async function translateText(text, opts = {}) {
  if (!text || typeof text !== 'string') {
    throw new Error('Text must be a non-empty string');
  }
  const safeText = text.trim().slice(0, 500);
  if (safeText.length < 2) {
    throw new Error('Text is too short');
  }

  const sourceLang = looksLikeTurkish(safeText) ? 'tr' : 'en';
  const targetLang = sourceLang === 'tr' ? 'en' : 'tr';

  // --- 1. Server-side Groq translation (highest quality, same free tier the
  //     server already pays for; no extra cost). Falls back to MyMemory/glossary
  //     when the server is unreachable or GROQ_API_KEY is not configured. -------
  if (!opts.skipServer) {
    try {
      const result = await fetchFromServerTranslate(safeText, sourceLang, targetLang);
      if (result) {
        return { translated: result, sourceLang, targetLang };
      }
    } catch (error) {
      // Server unreachable / misconfigured — fall through to keyless providers.
      console.warn('[translateText] Server translation skipped:', error?.message || error);
    }
  }

  // --- 2. MyMemory (free, keyless translation API) ------------------------
  try {
    const params = new URLSearchParams({
      q: safeText,
      langpair: `${sourceLang}|${targetLang}`,
      mt: '1',
    });
    const data = await fetchJson(
      `https://api.mymemory.translated.net/get?${params}`
    );
    const translated =
      data && data.responseData && data.responseData.translatedText
        ? String(data.responseData.translatedText).trim()
        : '';
    if (translated && !/^MYMEMORY WARNING/i.test(translated)) {
      return { translated, sourceLang, targetLang };
    }
  } catch (error) {
    console.warn('MyMemory translate failed:', error?.message || error);
  }

  // --- 3. Offline glossary fallback ---------------------------------------
  const glossary = glossaryTranslate(safeText, sourceLang);
  if (glossary) {
    return { translated: glossary, sourceLang, targetLang };
  }

  throw new Error(
    sourceLang === 'tr'
      ? 'Çeviri şu anda kullanılamıyor. Lütfen tekrar deneyin.'
      : 'Translation is unavailable right now. Please try again.'
  );
}

/**
 * Call the app's own backend to translate via Groq (free — same API key the
 * server already uses for AI answers). Returns the translated string, or null
 * when the server is unreachable / not configured (caller falls back).
 */
async function fetchFromServerTranslate(text, sourceLang, targetLang) {
  const url = `${API_URL}/api/ai/translate`;
  const body = { text, sourceLang, targetLang };
  const data = await fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  }).catch(() => null);
  if (!data || !data.success || typeof data.translated !== 'string') {
    return null;
  }
  return data.translated.trim() || null;
}

/**
 * Tiny offline Turkish↔English glossary used as the final translation
 * fallback when no network translation provider is reachable. Covers the
 * short community phrases that appear in posts; returns null when nothing
 * matches (the caller then surfaces a friendly "unavailable" message).
 * @param {string} text
 * @param {'tr'|'en'} sourceLang
 * @returns {string|null}
 */
function glossaryTranslate(text, sourceLang) {
  const GLOSSARY = {
    tr: {
      merhaba: 'hello', selam: 'hi', teşekkür: 'thanks', teşekkürler: 'thanks',
      lütfen: 'please', evet: 'yes', hayır: 'no', nasılsın: 'how are you',
      iyiyim: 'i am fine', abdest: 'ablution', namaz: 'prayer', dua: 'prayer',
      oruç: 'fasting', ramazan: 'ramadan', bayram: 'eid', cami: 'mosque',
      kurban: 'sacrifice', zekat: 'zakat', hac: 'hajj', umre: 'umrah',
      sabah: 'morning', öğle: 'noon', ikindi: 'afternoon', akşam: 'evening',
      yatsı: 'night', cemaat: 'congregation', imam: 'imam', kuran: 'quran',
      peygamber: 'prophet', allah: 'god', inşallah: 'god willing',
      maşallah: 'god bless', günaydın: 'good morning',
      iyiakşamlar: 'good evening', hoşçakal: 'goodbye', görüşürüz: 'see you',
    },
    en: {
      hello: 'merhaba', hi: 'selam', thanks: 'teşekkürler', please: 'lütfen',
      yes: 'evet', no: 'hayır', prayer: 'namaz', fasting: 'oruç',
      ramadan: 'ramazan', eid: 'bayram', mosque: 'cami', quran: 'kuran',
      prophet: 'peygamber', god: 'allah', hajj: 'hac', zakat: 'zekat',
      ablution: 'abdest', 'good morning': 'günaydın',
      'good evening': 'iyi akşamlar', goodbye: 'hoşça kal',
      'see you': 'görüşürüz', 'how are you': 'nasılsın',
    },
  };
  const map = GLOSSARY[sourceLang] || GLOSSARY.tr;
  const lower = text.toLowerCase();
  const exact = map[lower];
  if (exact) return exact;
  let replaced = text;
  let hit = false;
  for (const [from, to] of Object.entries(map)) {
    const re = new RegExp(`\\b${from}\\b`, 'gi');
    if (re.test(replaced)) {
      replaced = replaced.replace(re, to);
      hit = true;
    }
  }
  return hit ? replaced : null;
}

/**
 * Lightweight Turkish detection — checks for common Turkish characters and
 * high-frequency suffixes. Good enough to pick the translation direction.
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeTurkish(text) {
  const turkishChars = /[çğıöşüÇĞİÖŞÜ]/;
  if (turkishChars.test(text)) return true;
  const lower = text.toLowerCase();
  const turkishWords = /\b(ve|bir|bu|için|ile|dır|dir|mi|mı|mu|mü|de|da|ki|ama|çok|gibi|var|yok|ne|kim|nasıl|neden|nerede|zaman)\b/;
  return turkishWords.test(lower);
}
