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
  if (question == null) return null;
  if (typeof question !== 'string') return null;
  const safeQuestion = question.trim();
  if (safeQuestion.length === 0) return null;

  const validLanguages = ['tr', 'en'];
  const lang = validLanguages.includes(language) ? language : 'tr';

  if (safeQuestion.length < 2) return null;

  try {
    const searchAnswer = await getSearchAnswer(safeQuestion, lang);
    if (searchAnswer && typeof searchAnswer.answer === 'string') {
      return {
        answer: searchAnswer.answer,
        provider: searchAnswer.provider || 'none',
        sources: Array.isArray(searchAnswer.sources) ? searchAnswer.sources : [],
      };
    }
  } catch (error) {
    console.error('[getAIAnswer] search fallback failed:', error?.message || error);
  }

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

