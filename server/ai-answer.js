/**
 * AI Answer Module for "İslam nasıl öğrenilir" (How to Learn Islam)
 *
 * Answer sources, in order:
 *   1. Google Gemini (free tier via Google AI Studio) — best quality.
 *   2. Web-search fallback (see search-answer.js): Google Programmable
 *      Search when configured, else DuckDuckGo / Wikipedia — so users get a
 *      sourced answer even when Gemini has no credits / quota / outage.
 *
 * When BOTH sources are unavailable, getAIAnswer() resolves to null and the
 * caller surfaces a friendly "could not generate an answer right now" message.
 *
 * ONE-TIME SETUP
 * 1. Get a free Gemini key: https://aistudio.google.com/apikey
 * 2. Add to the server's .env:
 *      GEMINI_API_KEY=your-key
 * 3. (Optional, enables real Google results) Create a Programmable Search
 *    Engine at https://programmablesearchengine.google.com (search the whole
 *    web) and an API key in Google Cloud Console with "Custom Search API"
 *    enabled, then set:
 *      GOOGLE_SEARCH_API_KEY=...
 *      GOOGLE_SEARCH_CX=...
 * 4. Restart/redeploy the server. No app rebuild is needed.
 */

/**
 * Unified answer shape returned by getAIAnswer().
 * @typedef {Object} AIAnswer
 * @property {string} answer
 * @property {'gemini'|'google-search'} provider
 * @property {string} [model]
 * @property {Array<{title:string,url:string,source:string}>} [sources]
 */

const { getGeminiAnswer } = require('./gemini-answer');
const { getSearchAnswer } = require('./search-answer');

/**
 * Get an answer for a community question (Gemini first, web-search fallback).
 *
 * @param {string} question - the user's question
 * @param {string} language - 'tr' or 'en'
 * @returns {Promise<AIAnswer|null>} an answer, or null when no answer could
 *   be generated right now (offline / quota / no key configured).
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

  // Run Gemini and web-search in PARALLEL so a slow/unavailable Gemini
  // never blocks the search fallback from returning in time.
  // "firstValid" returns the FIRST non-null result — so a 3s Wikipedia
  // answer wins immediately, even if an upstream-hung Gemini would have
  // taken 60s to time out.
  const firstValid = (promises) => new Promise((resolve) => {
    let pending = promises.length;
    for (const p of promises) {
      p.then((result) => {
        if (result) {
          resolve(result);
        } else {
          pending -= 1;
          if (pending === 0) resolve(null);
        }
      }).catch(() => {
        pending -= 1;
        if (pending === 0) resolve(null);
      });
    }
  });

  const geminiPromise = (async () => {
    try {
      const geminiAnswer = await getGeminiAnswer(safeQuestion, lang);
      if (geminiAnswer) {
        return {
          answer: geminiAnswer.answer,
          provider: 'gemini',
          model: geminiAnswer.model,
        };
      }
    } catch (error) {
      console.error('[getAIAnswer] Gemini failed:', error.message);
    }
    return null;
  })();

  const searchPromise = (async () => {
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
    return null;
  })();

  const result = await firstValid([geminiPromise, searchPromise]);

  // Gemini is higher quality, so prefer it when it wins the race.
  if (result && result.provider === 'gemini') return result;
  if (result) return result;

  // No answer could be generated right now.
  return null;
}

/**
 * Offline fallback hint, retained for backward-compat with any tooling that
 * imports it. With the Gemini-only design there is no standalone knowledge
 * engine; this returns a short, honest message instead of a stale canned answer.
 */
function builtInAnswer(question, language) {
  return language === 'tr'
    ? 'Şu anda yanıt üretilemiyor. Lütfen daha sonra tekrar deneyin.'
    : 'An answer could not be generated right now. Please try again later.';
}

module.exports = { getAIAnswer, builtInAnswer };

