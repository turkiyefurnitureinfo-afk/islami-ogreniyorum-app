// ---------------------------------------------------------------------------
// Question answering — free, keyless web search (Wikipedia + DuckDuckGo).
// ---------------------------------------------------------------------------
// Answers are produced WITHOUT any generative-AI provider. The previous
// Gemini-backed pipeline was retired when its free-tier quota ran out; the
// replacement queries real, no-cost search APIs directly from the app:
//
//   1. Wikipedia search API (tr + en) — keyless, always up, curated
//   2. DuckDuckGo Instant Answer API — keyless, needs no setup
//
// No API keys, no server, no credits required. Works on all platforms —
// RN's fetch has no CORS restrictions on native, and both providers send
// permissive CORS headers for web builds.
// ---------------------------------------------------------------------------

const WEB_SEARCH_TIMEOUT_MS = 10000;

function stripHtml(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    signal: AbortSignal.timeout(WEB_SEARCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  }
  return res.json();
}

// --- 1. Wikipedia search API (keyless, most reliable fallback) --------------
async function searchWikipedia(query, language) {
  const langs = language === 'en' ? ['en'] : ['tr', 'en'];
  for (const lang of langs) {
    try {
      const params = new URLSearchParams({
        action: 'query',
        list: 'search',
        srsearch: query,
        format: 'json',
        srlimit: '3',
        utf8: '1',
        origin: '*',
      });
      const data = await fetchJson(`https://${lang}.wikipedia.org/w/api.php?${params}`);
      const hits = (data && data.query && data.query.search) || [];
      if (hits.length === 0) continue;
      return hits.map((h) => ({
        title: h.title,
        snippet: stripHtml(h.snippet),
        url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(h.title).replace(/ /g, '_'))}`,
        source: `${lang}.wikipedia.org`,
      }));
    } catch (error) {
      // Try the next language / provider.
    }
  }
  return null;
}

// --- Keyword extraction for better search results ---------------------------
function extractKeywords(question, language) {
  const tr = language === 'tr';
  const stopWords = tr
    ? ['nasıl', 'nedir', 'ne', 'için', 'ile', 'bir', 'bu', 'şu', 'mi', 'mı', 'mu', 'mü', 'da', 'de', 'ki', 'ama', 'çok', 'gibi', 'var', 'yok', 'kim', 'nerede', 'zaman', 'hangi', 'hangisi', 'neden', 'niçin', 'nasıl', 'yapılır', 'alınır', 'kılınır', 'edilir', 'verilir', 'bulunur', 'söylenir', 'bilinir', 'görülür', 'yapılır', 'edilir']
    : ['how', 'to', 'what', 'is', 'the', 'a', 'an', 'in', 'on', 'at', 'for', 'with', 'and', 'or', 'but', 'not', 'this', 'that', 'it', 'its', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'shall', 'pray', 'prayer', 'islam', 'muslim', 'islamic'];
  
  // Normalize Turkish characters so "nasil" matches "nasıl" in stop words
  const normalizeTr = (w) => w.replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ö/g, 'o').replace(/ü/g, 'u');
  const normalizedStopWords = stopWords.map(normalizeTr);
  const words = question.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !normalizedStopWords.includes(normalizeTr(w)));
  return words.slice(0, 4).join(' ');
}

// --- 2. DuckDuckGo Instant Answer API ---------------------------------------
async function searchDuckDuckGo(query) {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    no_html: '1',
    skip_disambig: '1',
  });
  const data = await fetchJson(`https://api.duckduckgo.com/?${params}`);
  const results = [];

  const push = (text, url) => {
    const clean = stripHtml(text);
    if (clean && url && results.length < 4) {
      results.push({
        title: domainOf(url),
        snippet: clean.slice(0, 260),
        url,
        source: domainOf(url),
      });
    }
  };

  if (data.Abstract && data.AbstractURL) {
    push(data.Abstract, data.AbstractURL);
  }
  if (data.Answer) {
    push(data.Answer, data.AbstractURL || `https://duckduckgo.com/?q=${encodeURIComponent(query)}`);
  }

  const walk = (topics) => {
    if (!Array.isArray(topics)) return;
    for (const t of topics) {
      if (t.FirstURL && t.Text) {
        push(t.Text, t.FirstURL);
      }
      if (t.Topics) walk(t.Topics);
      if (results.length >= 4) return;
    }
  };
  walk(data.RelatedTopics);

  return results.length > 0 ? results : null;
}

/**
 * Build the user-facing answer text from search results.
 *
 * Formatted conversationally so the reply reads like a chatbot answer rather
 * than a raw list of links: a short lead-in, the most relevant summary as
 * flowing prose, then compact sourced references and a religious-guidance
 * disclaimer.
 *
 * @param {Array<{title:string,snippet:string,url:string,source:string}>} results
 * @param {'tr'|'en'} language
 */
function buildSearchAnswerText(results, language) {
  const tr = language === 'tr';
  const top = results.slice(0, 3);
  if (top.length === 0) return '';

  const lines = [];

  // Conversational lead-in.
  lines.push(
    tr
      ? 'İşte sorunuz hakkında güvenilir kaynaklardan derlediğim bilgi:'
      : 'Here is what I found for your question from trusted sources:'
  );
  lines.push('');

  // Main body: the most relevant snippet as flowing prose (2–4 sentences).
  const primary = top[0];
  const lead = String(primary.snippet || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (lead) {
    lines.push(lead.charAt(0).toUpperCase() + lead.slice(1));
  }

  // Supporting context from the remaining results, kept short.
  const extras = top
    .slice(1)
    .map((r) => String(r.snippet || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  for (const extra of extras) {
    lines.push('');
    lines.push(extra.charAt(0).toUpperCase() + extra.slice(1));
  }

  // Sources footer.
  lines.push('');
  lines.push(tr ? '📚 Kaynaklar:' : '📚 Sources:');
  for (const r of top) {
    lines.push(`• ${r.title} (${r.source})`);
  }

  lines.push(
    '',
    tr
      ? 'Not: Bu cevap, güvenilir kaynaklardaki bilgilerin özetidir. Dinî hükümler için Diyanet İşleri Başkanlığı veya bir âlimine danışın.'
      : 'Note: this answer summarises information from trusted sources. For religious rulings please consult Diyanet or a qualified scholar.'
  );
  return lines.join('\n');
}

/**
 * Friendly fallback shown when BOTH search providers (Wikipedia and
 * DuckDuckGo) come back empty — common for conversational questions that
 * have no exact encyclopedic match. Formatted like a normal chatbot reply
 * (never a blank bubble), points the user at a manual search, and repeats
 * the Diyanet guidance disclaimer.
 *
 * @param {string} question
 * @param {'tr'|'en'} language
 * @returns {{answer:string, provider:string, sources:Array, noResults:boolean}}
 */
function buildNoResultsText(question, language) {
  const tr = language === 'tr';
  const lines = [];

  lines.push(
    tr
      ? 'Bu soru için güvenilir kaynaklarda hazır bir özet bulamadım. 🙏'
      : 'I could not find a ready-made summary for this question in trusted sources. 🙏'
  );
  lines.push('');
  lines.push(
    tr
      ? 'Sorunuzu daha kısa anahtar kelimelerle yeniden deneyebilirsiniz — örneğin "abdest nasıl alınır" veya "teravih kaç rekattır" gibi. Aşağıdaki bağlantıdan da arama yapabilirsiniz:'
      : 'Try rephrasing your question with shorter keywords — for example "how is ablution performed" or "how many rakats is tarawih". You can also search manually here:'
  );
  lines.push('');
  lines.push(
    `https://www.google.com/search?q=${encodeURIComponent(question)}`
  );
  lines.push('');
  lines.push(
    tr
      ? 'Not: Dinî hükümler için Diyanet İşleri Başkanlığı\'nın resmî sitesini (diyanet.gov.tr) veya bir âlimine danışmak en doğrusudur.'
      : 'Note: for religious rulings it is best to consult the official Diyanet website (diyanet.gov.tr) or a qualified scholar.'
  );

  return {
    answer: lines.join('\n'),
    provider: 'web-search',
    sources: [],
    noResults: true,
  };
}

/**
 * Try to answer a question from web-search results (no generative AI).
 *
 * Provider order per query: Wikipedia (tr→en) then DuckDuckGo Instant
 * Answer. GUARANTEES a usable reply object for every well-formed question:
 * when every provider returns an empty result set, a formatted
 * "no results" fallback (with the Diyanet disclaimer) is returned instead
 * of null, so the chat UI never renders a broken or blank AI bubble.
 *
 * @param {string} question
 * @param {'tr'|'en'} language
 * @returns {Promise<{answer:string, provider:'web-search', sources:Array, noResults?:boolean}|null>}
 *   null only for invalid/too-short input (callers treat that as an error).
 */
export async function getWebSearchAnswer(question, language = 'tr') {
  if (!question || typeof question !== 'string') return null;
  const safeQuestion = question.trim().slice(0, 1000);
  if (safeQuestion.length < 2) return null;

  // Try the full question first, then fall back to extracted keywords.
  const queries = [safeQuestion, extractKeywords(safeQuestion, language)].filter(Boolean);

  for (const q of queries) {
    const providers = [
      ['wikipedia', () => searchWikipedia(q, language)],
      ['duckduckgo', () => searchDuckDuckGo(q)],
    ];

    for (const [name, fn] of providers) {
      try {
        const results = await fn();
        if (results && results.length > 0) {
          return {
            answer: buildSearchAnswerText(results, language),
            provider: 'web-search',
            sources: results
              .slice(0, 3)
              .map((r) => ({ title: r.title, url: r.url, source: r.source })),
          };
        }
      } catch (error) {
        console.error(`[getWebSearchAnswer] ${name} failed:`, error.message);
      }
    }
  }

  // Every provider came back empty (or failed) for every query variant.
  // Return the friendly, formatted fallback rather than null so the chat
  // always shows something coherent.
  return buildNoResultsText(safeQuestion, language);
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
 * Get an answer for a community question.
 *
 * Answers are sourced from free, keyless web search (Wikipedia + DuckDuckGo)
 * with the backend's own search pipeline as a secondary path. The previous
 * Gemini-backed pipeline was retired when its free-tier quota ran out.
 *
 * @param {string} question - the user's question
 * @param {string} language - 'tr' or 'en'
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
  // PRIMARY SOURCE: free keyless web search (Wikipedia + DuckDuckGo).
  // The Gemini free tier has been exhausted, so answers are now produced
  // entirely from public, no-cost search APIs — no quota, no key, no
  // server dependency. Runs on every platform.
  // ---------------------------------------------------------------------
  try {
    const webAnswer = await getWebSearchAnswer(safeQuestion, language);
    if (webAnswer) return webAnswer;
  } catch (error) {
    console.warn('Web-search answer failed:', error?.message || error);
  }

  // Secondary: the backend's own search pipeline (Google Programmable
  // Search when configured, else DuckDuckGo / Wikipedia). Useful when the
  // on-device network path is restricted but the server can reach out.
  try {
    const serverAnswer = await fetchServerAIAnswer(safeQuestion, language);
    if (serverAnswer) return serverAnswer;
  } catch (error) {
    console.warn('Backend AI fallback failed:', error?.message || error);
  }

  // Nothing worked — surface a friendly, actionable message.
  throw new Error(
    language === 'tr'
      ? 'Şu anda cevap üretilemedi. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.'
      : 'Could not generate an answer right now. Please check your connection and try again.'
  );
}

/**
 * Backend AI fallback: ask our own server (Render) for an answer. The server
 * answers from web-search results (Google Programmable Search when configured,
 * else DuckDuckGo / Wikipedia). Used as a secondary path when the on-device
 * search cannot reach the internet but the server can.
 *
 * @param {string} question
 * @param {'tr'|'en'} language
 * @returns {Promise<{answer:string, provider:string, model?:string}|null>}
 *   null when the server has no answer (non-OK / offline / timeout).
 */
async function fetchServerAIAnswer(question, language) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const resp = await fetch(`${API_URL}/api/ai/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, language }),
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const data = await resp.json().catch(() => null);
    if (!data || !data.success || !data.answer) return null;
    return {
      answer: String(data.answer),
      provider: data.provider || 'google-search',
      ...(data.model ? { model: data.model } : {}),
    };
  } catch (error) {
    console.warn('Server AI fallback unavailable:', error?.message || error);
    return null;
  } finally {
    clearTimeout(timer);
  }
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

  // Network-level failures (offline, timeout, DNS) — the most common cause
  // now that answers come from Wikipedia / DuckDuckGo.
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
 */
export async function translateText(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('Text must be a non-empty string');
  }
  const safeText = text.trim().slice(0, 500);
  if (safeText.length < 2) {
    throw new Error('Text is too short');
  }

  const sourceLang = looksLikeTurkish(safeText) ? 'tr' : 'en';
  const targetLang = sourceLang === 'tr' ? 'en' : 'tr';

  // --- 1. MyMemory (free, keyless translation API) ------------------------
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

  // --- 2. Offline glossary fallback ---------------------------------------
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
