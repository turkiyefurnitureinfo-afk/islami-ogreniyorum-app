/**
 * AI Answer Module for "İslam nasıl öğrenilir" (How to Learn Islam)
 *
 * Answer sources, in order:
 *   1. Hugging Face Serverless Inference (Qwen/Qwen2.5-7B-Instruct) — primary.
 *      Zero-cost, key-based (HF_TOKEN). Returns a real, conversational AI answer.
 *   2. Web-search fallback (see search-answer.js): Google Programmable
 *      Search when configured, else DuckDuckGo / Wikipedia — so users get a
 *      sourced answer even when HF has no credits / quota / outage.
 *
 * When BOTH sources are unavailable, getAIAnswer() resolves to null and the
 * caller surfaces a friendly "could not generate an answer right now" message.
 *
 * ONE-TIME SETUP
 * 1. Get a free Hugging Face token: https://huggingface.co/settings/tokens
 *    (a free "read" token is enough for the serverless Inference Router).
 * 2. Add to the server's .env:
 *      HF_TOKEN=your-token-here
 * 3. (Optional) Pin a different model:
 *      HF_MODEL=Qwen/Qwen2.5-7B-Instruct
 * 4. Restart/redeploy the server. No app rebuild is needed.
 */

/**
 * Unified answer shape returned by getAIAnswer().
 * @typedef {Object} AIAnswer
 * @property {string} answer
 * @property {'huggingface'|'google-search'} provider
 * @property {string} [model]
 * @property {Array<{title:string,url:string,source:string}>} [sources]
 */

const { getSearchAnswer } = require('./search-answer');

// Hugging Face Inference Router endpoint (OpenAI-compatible chat completions).
const HF_ROUTER_URL = 'https://router.huggingface.co/v1/chat/completions';
const HF_MODEL = process.env.HF_MODEL || 'Qwen/Qwen2.5-7B-Instruct';
const HF_TOKEN = (process.env.HF_TOKEN || '').trim();

// Hard ceiling for a single HF HTTP call (ms). The model can take a few seconds
// to first-token on the free tier; 25s balances responsiveness with reliability.
const HF_TIMEOUT_MS = Number(process.env.HF_TIMEOUT_MS || 25000);

/**
 * Localized system prompts — steer the model toward authentic, concise Islamic
 * guidance sourced from the Quran, authentic Hadith, and mainstream scholarship
 * (e.g. Diyanet İşleri Başkanlığı).
 */
const SYSTEM_PROMPTS = {
  tr: [
    'Sen "İslamı öğreniyorum" (İslam nasıl öğrenilir) adlı bir mobil uygulamanın bilgili, dikkatli İslam asistanısın.',
    'Kullanıcıın sorusuna Türkçe cevap ver.',
    'Kurallar:',
    '- Kısa ve öz ol (en fazla ~180 kelime), sıcak ve saygılı bir ton kullan.',
    '- Cevaplarını Kur\'an, sahih hadis ve ana akademik anlayışa (örn. Diyanet İşleri Başkanlığı) dayandır.',
    '- Kişisel dinî hüküm (fatura) gerektiren sorularda genel rehberlik ver ve Diyanet\'e veya nitelikli bir âlime danışılmasını öner.',
    '- Tıbbi, hukuki veya mali yöndemelerde bulunma; nitelikli profesyonellere başvurmasını öner.',
    '- Emin olmadığın Kur\'an ayet numaralarını veya hadis referansını uydurma.',
  ].join('\n'),
  en: [
    'You are a knowledgeable, careful Islamic assistant inside a mobile app called "İslamı öğreniyorum" (How to Learn Islam).',
    'Answer the user\'s question in English.',
    'Rules:',
    '- Be concise (at most ~180 words), warm and respectful.',
    '- Base answers on the Quran, authentic Hadith and mainstream scholarly understanding (e.g. Diyanet İşleri Başkanlığı).',
    '- If the question needs a personal religious ruling (fatwa), give general guidance and kindly recommend consulting Diyanet or a qualified scholar.',
    '- Never give medical, legal or financial directives; suggest qualified professionals instead.',
    '- Do not invent Quran verse numbers or hadith references you are not sure about.',
  ].join('\n'),
};

/**
 * Call the Hugging Face Inference Router for a chat-completions answer.
 * Returns the answer string, or null when the model is unavailable.
 * Throws { status: 503, isWarmingUp: true } when the model is warming up so the
 * caller can surface a specific "model warming up, retry" message.
 *
 * @param {string} question
 * @param {'tr'|'en'} language
 * @returns {Promise<string|null>}
 */
async function callHuggingFace(question, language) {
  if (!HF_TOKEN) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HF_TIMEOUT_MS);

  try {
    const res = await fetch(HF_ROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${HF_TOKEN}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: HF_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPTS[language] || SYSTEM_PROMPTS.tr },
          { role: 'user', content: question },
        ],
        max_tokens: 1024,
        temperature: 0.4,
      }),
    });

    // 503 = model is warming up (cold start on the free tier). Signal this
    // explicitly so the client can offer a retry instead of a generic error.
    if (res.status === 503) {
      const err = new Error('Model is warming up');
      err.status = 503;
      err.isWarmingUp = true;
      throw err;
    }

    if (!res.ok) {
      console.error(`[getAIAnswer] Hugging Face HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text || !String(text).trim()) return null;
    return String(text).trim();
  } catch (error) {
    if (error.isWarmingUp) throw error; // re-throw warming-up signal
    console.error('[getAIAnswer] Hugging Face failed:', error.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Get an answer for a community question (Hugging Face first, web-search fallback).
 *
 * @param {string} question - the user's question
 * @param {string} language - 'tr' or 'en'
 * @returns {Promise<AIAnswer|null>} an answer, or null when no answer could
 *   be generated right now (offline / quota / no key configured).
 * @throws {{isWarmingUp:boolean}} when the HF model is warming up (HTTP 503).
 */
async function getAIAnswer(question, language = 'tr') {
  if (!question || typeof question !== 'string') {
    throw new Error('Question must be a non-empty string');
  }

  const validLanguages = ['tr', 'en'];
  const lang = validLanguages.includes(language) ? language : 'tr';

  // Cap the payload the AI provider sees (cost + abuse protection).
  const safeQuestion = question.trim().slice(0, 1000);
  if (safeQuestion.length < 2) {
    throw new Error('Question is too short');
  }

  // ------------------------------------------------------------------
  // PRIMARY: Hugging Face serverless inference (Qwen). Zero-cost, real AI.
  // ------------------------------------------------------------------
  if (HF_TOKEN) {
    try {
      const hfAnswer = await callHuggingFace(safeQuestion, lang);
      if (hfAnswer) {
        return {
          answer: hfAnswer,
          provider: 'huggingface',
          model: HF_MODEL,
        };
      }
      console.warn('[getAIAnswer] Hugging Face returned empty');
    } catch (error) {
      // Surface the warming-up signal to the caller (don't swallow it).
      if (error.isWarmingUp) throw error;
      console.error('[getAIAnswer] Hugging Face failed:', error.message);
    }
  } else {
    console.warn('[getAIAnswer] HF_TOKEN not set — skipping Hugging Face tier');
  }

  // ------------------------------------------------------------------
  // FALLBACK: web-search pipeline (Google Programmable Search when configured,
  // else DuckDuckGo / Wikipedia). Useful when HF is unavailable.
  // ------------------------------------------------------------------
  try {
    const searchAnswer = await getSearchAnswer(safeQuestion, lang);
    if (searchAnswer) {
      return {
        answer: searchAnswer.answer,
        provider: searchAnswer.provider,
        sources: searchAnswer.sources,
      };
    }
  } catch (error) {
    console.error('[getAIAnswer] search fallback failed:', error.message);
  }

  // No answer could be generated right now.
  return null;
}

/**
 * Offline fallback hint, retained for backward-compat with any tooling that
 * imports it.
 */
function builtInAnswer(question, language) {
  return language === 'tr'
    ? 'Şu anda yanıt üretilemiyor. Lütfen daha sonra tekrar deneyin.'
    : 'An answer could not be generated right now. Please try again later.';
}

module.exports = { getAIAnswer, builtInAnswer };

