/**
 * AI Answer Module for "İslam nasıl öğrenilir" (How to Learn Islam)
 *
 * Single source: Google Gemini (free tier via Google AI Studio).
 *
 * Design decision: only Gemini auto-answers, so there is exactly ONE source of
 * truth for AI answers (consistent quality + tone, and no extra Google Cloud
 * project / Programmable-Search setup to maintain). When Gemini is unavailable
 * (no key, network down, quota), getAIAnswer() resolves to null and caller
 * surfaces a friendly "could not generate an answer right now" message rather
 * than a canned offline answer.
 *
 * ONE-TIME SETUP
 * 1. Get a free key: https://aistudio.google.com/apikey
 * 2. Add to the server's .env:
 *      GEMINI_API_KEY=your-key
 * 3. Restart/redeploy the server. No app rebuild is needed.
 */

/**
 * Unified answer shape returned by getAIAnswer().
 * @typedef {Object} AIAnswer
 * @property {string} answer
 * @property {'gemini'} provider
 */

/**
 * Get an answer for a community question using Gemini only.
 *
 * @param {string} question - the user's question
 * @param {string} language - 'tr' or 'en'
 * @returns {Promise<AIAnswer|null>} a Gemini answer, or null when no answer
 *   could be generated right now (offline / quota / no key configured).
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

  let geminiAnswer = null;
  try {
    geminiAnswer = await getGeminiAnswer(safeQuestion, lang);
  } catch (error) {
    console.error('[getAIAnswer] Gemini failed:', error.message);
  }

  if (geminiAnswer) {
    return { answer: geminiAnswer.answer, provider: 'gemini' };
  }

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

