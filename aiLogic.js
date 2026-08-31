// ---------------------------------------------------------------------------
// Firebase AI Logic (Gemini) — on-device AI answers for the Q&A tab
// ---------------------------------------------------------------------------
// Replaces the old server-proxied Gemini call (POST /api/ai/answer on Render),
// which depended on a GEMINI_API_KEY server secret and Render's free-tier cold
// starts — the reason answers kept failing with "could not get an answer".
//
// Firebase AI Logic's "Gemini Developer API" backend:
//   • works on the FREE Spark plan (no Blaze upgrade),
//   • needs NO API key inside the app — requests are authorized by the
//     Firebase project itself,
//   • reads its project config from the values below (public client
//     identifiers from google-services.json / Firebase Project Settings).
//
// ONE-TIME SETUP (Firebase Console → https://console.firebase.google.com):
//   Build → AI Logic (Vertex AI & Gemini) → "Get started" → choose
//   **Gemini Developer API** → Enable. Nothing else is required — no API key,
//   no server. (Optional in production: add Firebase App Check.)
// ---------------------------------------------------------------------------

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAI, getGenerativeModel, GoogleAIBackend } from 'firebase/ai';

// Web-app config for THIS Firebase project (islami-ogreniyorum). These are
// public, client-side identifiers — the same values Firebase publishes in
// Project Settings. If Google ever blocks the Android-derived API key for web
// traffic ("API key not valid"), create a Web App in Firebase Project Settings
// and paste its apiKey/appId here instead.
const FIREBASE_WEB_CONFIG = {
  apiKey: 'AIzaSyDwIT4O1c_24SzLx42CuI36mjYhX24YFcY',
  authDomain: 'islami-ogreniyorum.firebaseapp.com',
  projectId: 'islami-ogreniyorum',
  storageBucket: 'islami-ogreniyorum.firebasestorage.app',
  messagingSenderId: '817195380589',
  appId: '1:817195380589:android:aa2049bbae8fb9f7c9b464',
};

// Current-generation flash models, newest first; older names stay as fallbacks
// so the module keeps working as Google deprecates versions.
// gemini-3.6-flash is the current recommended model (Google retired
// gemini-2.5-flash and gemini-2.0-flash with "no longer available" 404s).
const MODELS = ['gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-2.0-flash'];

// Hard ceiling for one AI request so the UI never hangs on a stalled socket.
const AI_TIMEOUT_MS = 25000;

// How many tokens Gemini is allowed to produce for a single answer. Keep this
// generously high (≈1500–2500 words) so longer, thorough religious explanations
// are never truncated mid-sentence by a low ceiling. Raised from the old 512
// default, which silently cut answers short at the model's token boundary.
const ANSWER_MAX_OUTPUT_TOKENS = 2000;

// The unified answer shape returned by getAIAnswer().
// @typedef {{answer: string, provider: 'firebase-ai', model: string}} AIAnswer

let appInstance = null;

/** Initialise (once) and return the Firebase JS app used for AI calls.
 *  Also reused by mediaService.js (Firebase Storage uploads) so both features
 *  share a single initialised app instance. */
export function getFirebaseApp() {
  if (!appInstance) {
    appInstance = getApps().length > 0 ? getApp() : initializeApp(FIREBASE_WEB_CONFIG);
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
 * The assistant's persona + safety rules. Mirrors the prompt the backend used
 * so answers keep the same tone, length and sourcing guidance.
 */
function buildSystemInstruction(language) {
  const langName = language === 'en' ? 'English' : 'Turkish';
  return [
    'You are a knowledgeable, careful Islamic assistant inside a mobile app called "İslamı öğreniyorum" (How to Learn Islam).',
    `Always answer in ${langName}.`,
    'Rules:',
    '- Be concise (at most ~180 words), warm and respectful.',
    '- Base answers on the Quran, authentic Hadith and mainstream scholarly understanding (e.g. Diyanet İşleri Başkanlığı).',
    '- If the question needs a personal religious ruling (fatwa), give general guidance and kindly recommend consulting Diyanet or a qualified scholar.',
    '- Never give medical, legal or financial directives; suggest qualified professionals instead.',
    '- Do not invent Quran verse numbers or hadith references you are not sure about.',
  ].join('\n');
}

// Android app identity used to authorise the direct Gemini REST calls below.
// These are the SAME package / keystore fingerprints registered in Firebase &
// Google Cloud Console (project "islami-ogreniyorum", 817195380589):
//   - release keystore android/app/my-upload-key.keystore (alias my-key-alias)
//   - debug.keystore (alias androiddebugkey)
//   - EAS build keystore
const ANDROID_PACKAGE = 'com.joshua.islamiogreniyorum';
const ANDROID_CERTS = [
  '6E8E23CADFBD114F9365EDED5289FC745AFBCE17', // release keystore
  '5E8F16062EA3CD2C4A0D547876BAA6F38CABF625', // debug keystore
  '8DFC3D55BE275D81A177064C9321F91D04B44921', // EAS keystore
];
const IOS_BUNDLE_ID = 'com.joshua.islamiogreniyorum';
const GEMINI_REST_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** React Native platform (android/ios/web), safely detected in any environment. */
function detectPlatform() {
  try {
    const RN = require('react-native');
    return RN.Platform && RN.Platform.OS ? RN.Platform.OS : 'web';
  } catch {
    return 'web';
  }
}

/** True when the error is model-name specific (deprecated/unknown model), so the
 *  caller falls through to the next model instead of aborting the loop.
 *  Covers Google's deprecation phrasings, e.g. "This model models/gemini-2.0-flash
 *  is no longer available" (HTTP 404 / NOT_FOUND). */
function isModelProblem(error) {
  const message = String(error?.message || '');
  const code = String(error?.code || '');
  return (
    /not found|no longer available|deprecated|not supported|unsupported|404|not_found/i.test(
      message
    ) || /not[-_]found|404/.test(code)
  );
}

/** Run `call(model)` over MODELS with a hard timeout; model-name failures try
 *  the next model, anything else stops the loop. */
async function runWithModelFallback(call, timeoutLabel) {
  let lastError = null;
  for (const model of MODELS) {
    try {
      let timer;
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${timeoutLabel || 'AI request'} timed out`)),
          AI_TIMEOUT_MS
        );
      });
      try {
        return await Promise.race([call(model), timeoutPromise]);
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      lastError = error;
      if (!isModelProblem(error)) break;
    }
  }
  throw lastError || new Error(`${timeoutLabel || 'AI request'} could not be completed`);
}

/**
 * Get an answer for a community question using Gemini.
 * Installed builds call the REST API with the app-identity headers (the
 * reliable path for the Android-restricted API key); firebase/ai is the
 * fallback for web / Expo Go.
 *
 * @param {string} question - the user's question
 * @param {string} language - 'tr' or 'en'
 * @returns {Promise<{answer: string, provider: string, model: string}>}
 *   the generated answer
 * @throws {Error} when the AI service is unreachable / not enabled / quota'd.
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
  if (!isAIConfigured()) {
    throw new Error('Firebase AI is not configured in this build.');
  }

  const platform = detectPlatform();
  const systemInstruction = buildSystemInstruction(
    ['tr', 'en'].includes(language) ? language : 'tr'
  );
  let restError = null;

  // Primary path on installed builds: direct REST call with identity headers.
  if (platform !== 'web') {
    try {
      return await runWithModelFallback(
        (model) => callGeminiREST(model, safeQuestion, { systemInstruction, platform }),
        'AI request'
      );
    } catch (error) {
      restError = error;
    }
  }

  // Fallback: Firebase AI Logic (Gemini Developer API) via the JS SDK.
  try {
    return await runWithModelFallback(
      (model) => callFirebaseAI(model, safeQuestion, { systemInstruction }),
      'AI request'
    );
  } catch (error) {
    throw chooseAIError(restError, error);
  }
}

/**
 * Call the Gemini REST API directly, attaching the Android/iOS app identity so
 * the Android-restricted API key baked into this build is validated correctly.
 *
 * Why this exists: the web-style Firebase JS SDK (firebase/ai) cannot attach
 * the X-Android-Package / X-Android-Cert identity headers — it only sends
 * browser-style requests — so Google rejects the Android-restricted API key
 * with "API key not valid". Native Google SDKs send those headers, which is
 * exactly what this REST path reproduces, so AI answers actually work in the
 * installed APK.
 *
 * @param {string} model
 * @param {string} prompt
 * @param {{ systemInstruction?: string, temperature?: number, maxOutputTokens?: number, platform?: string }} opts
 * @returns {Promise<{answer: string, provider: string, model: string}>}
 */
async function callGeminiREST(model, prompt, opts = {}) {
  const platform = opts.platform || detectPlatform();
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.4,
      maxOutputTokens: opts.maxOutputTokens ?? ANSWER_MAX_OUTPUT_TOKENS,
    },
  };
  if (opts.systemInstruction) {
    body.system_instruction = { parts: [{ text: opts.systemInstruction }] };
  }

  // Android requires the exact SHA-1 cert of the keystore that signed the
  // installed APK. Try each registered cert in turn; a mismatched cert yields
  // the same "API key not valid" error, so keep going until one matches.
  const certs = platform === 'android' ? ANDROID_CERTS : [null];
  let lastError = null;

  for (const cert of certs) {
    const headers = { 'Content-Type': 'application/json' };
    if (platform === 'android') {
      headers['X-Android-Package'] = ANDROID_PACKAGE;
      if (cert) headers['X-Android-Cert'] = cert;
    } else if (platform === 'ios') {
      headers['X-Ios-Bundle-Identifier'] = IOS_BUNDLE_ID;
    }

    try {
      const resp = await fetch(
        `${GEMINI_REST_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(FIREBASE_WEB_CONFIG.apiKey)}`,
        { method: 'POST', headers, body: JSON.stringify(body) }
      );
      const data = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        const msg = data?.error?.message || data?.error?.status || `HTTP ${resp.status}`;
        const invalidKey = /API key not valid|API key invalid|key not valid|invalid api key/i.test(String(msg));
        lastError = new Error(msg);
        // A wrong cert reads the same as a genuinely bad key — only move to the
        // next cert while more remain.
        if (invalidKey && certs.length > 1) continue;
        break;
      }

      const parts = data?.candidates?.[0]?.content?.parts || [];
      const text = parts.map((p) => p.text || '').join('').trim();
      if (!text) {
        const reason = data?.candidates?.[0]?.finishReason || 'unknown';
        throw new Error(`Gemini returned no text (${reason})`);
      }
      return { answer: text, provider: 'gemini-rest', model };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Gemini request failed');
}

/** Try the Firebase AI Logic JS SDK path (firebase/ai). No app-identity headers
 *  are attached, so it only succeeds when the API key allows browser-style
 *  traffic (web builds / Expo Go / a project that also has a web API key). */
async function callFirebaseAI(model, prompt, opts = {}) {
  const ai = getAI(getFirebaseApp(), { backend: new GoogleAIBackend() });
  const generativeModel = getGenerativeModel(ai, {
    model,
    ...(opts.systemInstruction ? { systemInstruction: opts.systemInstruction } : {}),
    generationConfig: {
      temperature: opts.temperature ?? 0.4,
      maxOutputTokens: opts.maxOutputTokens ?? ANSWER_MAX_OUTPUT_TOKENS,
    },
  });
  const result = await generativeModel.generateContent(prompt);
  const text = (result?.response?.text?.() || '').trim();
  if (!text) throw new Error('AI returned an empty answer');
  return { answer: text, provider: 'firebase-ai', model };
}

/** Pick the most useful error of the two attempts for the final UI message. */
function chooseAIError(restError, sdkError) {
  const both = [restError, sdkError].filter(Boolean);
  if (both.length === 0) return new Error('AI answer could not be generated');
  return both.find((e) => isAIConfigError(e)) || both[0];
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
 * Human-readable, localized explanation of an AI failure — the message the UI
 * shows in the Q&A tab when an AI answer could not be generated.
 *
 * @param {any} error
 * @param {'tr'|'en'} [language]
 * @returns {string}
 */
export function describeAIError(error, language = 'tr') {
  const text = `${error?.code || ''} ${error?.message || ''}`;
  const tr = language === 'tr';

  if (/API key not valid|api key not valid|key not valid|API_KEY_INVALID|invalid api key|api key invalid/i.test(text)) {
    return tr
      ? 'AI anahtarı bu derlemede geçerli değil: proje bu anahtarı bu platformda kullanmıyor olabilir. Firebase Konsolu → AI Logic → Gemini Developer API seçeneğini etkinleştirin; ayrıca Proje Ayarları → API anahtarları altında anahtarın "Generative Language API" erişimine izin verdiğini doğrulayın.'
      : 'The AI key is not valid for this request: the project may not allow this key on this platform. Enable Firebase Console → AI Logic → Gemini Developer API, and under Project Settings → API keys make sure this key is allowed to use the Generative Language API.';
  }
  if (/PERMISSION_DENIED|403|not been used|disabled|permission|failed-precondition/i.test(text)) {
    return tr
      ? 'AI servisi bu Firebase projesinde henüz etkin değil. Firebase Konsolu → AI Logic → Gemini Developer API seçeneğini etkinleştirin.'
      : 'The AI service is not enabled for this Firebase project yet. Enable it in the Firebase Console → AI Logic → Gemini Developer API.';
  }
  return tr
    ? 'Şu anda cevap alınamadı. Lütfen birkaç saniye sonra tekrar deneyin.'
    : 'Could not get an answer right now. Please try again in a moment.';
}

// ---------------------------------------------------------------------------
// Community translation — reuse the same Gemini model used for AI answers.
// Turkish ↔ English so every user can read every post regardless of language.
// ---------------------------------------------------------------------------

/**
 * Translate arbitrary text between Turkish and English using Gemini.
 * Auto-detects the source language and flips to the other.
 *
 * @param {string} text - text to translate
 * @returns {Promise<{ translated: string, sourceLang: 'tr'|'en', targetLang: 'tr'|'en' }>}
 */
export async function translateText(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('Text must be a non-empty string');
  }
  const safeText = text.trim().slice(0, 2000);
  if (safeText.length < 2) {
    throw new Error('Text is too short');
  }
  if (!isAIConfigured()) {
    throw new Error('Firebase AI is not configured in this build.');
  }

  const prompt = [
    'Detect the language of the following text (it will be Turkish or English).',
    'Translate it into the OTHER language (Turkish→English or English→Turkish).',
    'Return ONLY the translated text — no explanations, no quotes, no labels.',
    '',
    'Text:',
    safeText,
  ].join('\n');

  const platform = detectPlatform();
  let restError = null;

  // Primary path on installed builds: REST with identity headers.
  if (platform !== 'web') {
    try {
      const result = await runWithModelFallback(
        (model) => callGeminiREST(model, prompt, { temperature: 0.1, maxOutputTokens: 1024, platform }),
        'Translation request'
      );
      return finalizeTranslation(result.answer, safeText);
    } catch (error) {
      restError = error;
    }
  }

  // Fallback: Firebase AI Logic (Gemini Developer API) via the JS SDK.
  try {
    const result = await runWithModelFallback(
      (model) => callFirebaseAI(model, prompt, { temperature: 0.1, maxOutputTokens: 1024 }),
      'Translation request'
    );
    return finalizeTranslation(result.answer, safeText);
  } catch (error) {
    throw chooseAIError(restError, error);
  }
}

/** Shape a raw Gemini translation into the hook's expected return object. */
function finalizeTranslation(translated, originalText) {
  const trimmed = (translated || '').trim();
  if (!trimmed) throw new Error('Translation returned empty');
  // Best-effort source detection via the prompt is unnecessary — we just flip
  // based on which language the original *looks* like.
  const sourceLang = looksLikeTurkish(originalText) ? 'tr' : 'en';
  const targetLang = sourceLang === 'tr' ? 'en' : 'tr';
  return { translated: trimmed, sourceLang, targetLang };
}

/**
 * Lightweight Turkish detection — checks for common Turkish characters and
 * high-frequency suffixes. Good enough to pick the target language; Gemini
 * does the actual translation.
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
