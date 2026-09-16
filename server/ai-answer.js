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
 * Get an answer for a community question.
 *
 * PRIMARY: the search-augmented Groq synthesis pipeline
 * (services/chatPipeline.js) — Serper.dev Google results synthesized into a
 * concise, sourced answer. This is the SAME pipeline /api/ai/chat uses, so the
 * legacy endpoint no longer degrades to a raw snippet dump.
 *
 * WHY: /api/ai/answer is the app's tier-2 fallback and is reached whenever
 * /api/ai/chat fails or times out (e.g. the free-tier host cold-starting). It
 * used to return only the plain-text snippet summary, so the app rendered it
 * with provider 'serper' -> the badge/author switched to "Web Search" and users
 * reported "the AI answer changed to web search". Synthesizing here means BOTH
 * tiers deliver an AI answer.
 *
 * FALLBACK: the raw web-search pipeline (search-answer.js) when Groq is
 * unconfigured/unavailable/over quota — a sourced snippet summary is still far
 * better than no answer at all.
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

  // --- 1. Groq synthesis (search-augmented) — the real AI answer -------------
  try {
    const { handleSearchAugmentedChat } = require('./services/chatPipeline');
    const chat = await handleSearchAugmentedChat(safeQuestion, lang);
    if (
      chat &&
      chat.provider === 'groq' &&
      typeof chat.reply === 'string' &&
      chat.reply.trim().length > 0
    ) {
      return {
        answer: chat.reply,
        provider: 'groq',
        sources: Array.isArray(chat.sources) ? chat.sources : [],
      };
    }
    console.warn(
      '[getAIAnswer] Groq synthesis unavailable (provider=' +
        (chat && chat.provider) +
        ') — falling back to the search snippet summary.'
    );
  } catch (error) {
    console.error('[getAIAnswer] Groq synthesis failed:', error?.message || error);
  }

  // --- 2. Fallback: raw web-search snippets ---------------------------------
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

