/**
 * AI Answer Module for "İslam nasıl öğrenilir" (How to Learn Islam)
 *
 * Answer source: web-search pipeline (see search-answer.js) + Groq synthesis
 * (see services/chatPipeline.js). No external LLM SDK dependencies.
 */

/**
 * Unified answer shape returned by getAIAnswer().
 * @typedef {Object} AIAnswer
 * @property {string} answer
 * @property {'serper'|'duckduckgo'|'wikipedia'} provider
 * @property {Array<{title:string,url:string,source:string}>} [sources]
 */

const { getSearchAnswer } = require('./search-answer');

/**
 * Get an answer for a community question (web-search based).
 *
 * @param {string} question - the user's question
 * @param {string} language - 'tr' or 'en'
 * @returns {Promise<{answer: string, provider: string, sources: Array}>} an answer object, or null when no answer could be generated
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
  // Web-search pipeline (Serper.dev Google results when configured,
  // else DuckDuckGo / Wikipedia). Always available.
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

