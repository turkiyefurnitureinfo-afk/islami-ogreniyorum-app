/**
 * Gemini AI Answer Module for "İslam nasıl öğrenilir"
 *
 * Uses Google's Gemini API (free tier via Google AI Studio) to answer
 * community questions. This is the highest-quality answer source and is
 * tried FIRST by ai-answer.getAIAnswer() when GEMINI_API_KEY is set.
 *
 * ---------- ONE-TIME SETUP ----------
 * 1. Get a free API key: https://aistudio.google.com/apikey
 * 2. Add to the server's .env:
 *      GEMINI_API_KEY=your-key
 *    (optionally pin a model: GEMINI_MODEL=gemini-2.5-flash)
 * 3. Restart / redeploy the server. No app rebuild is needed.
 *
 * Free-tier limits are generous for a small user base; if a request is
 * rate-limited (429) we simply fall through to the next answer source.
 */

// Verified live against the API (2026-08): 2.x models are closed to new
// accounts ("no longer available to new users"), so we default to the
// current generation and keep older names only as harmless fallbacks.
const DEFAULT_MODELS = ['gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.5-flash'];

function getApiKey() {
  return (process.env.GEMINI_API_KEY || '').trim();
}

function buildPrompt(question, language) {
  const langName = language === 'en' ? 'English' : 'Turkish';
  return [
    'You are a knowledgeable, careful Islamic assistant inside a mobile app called "İslamı öğreniyorum" (How to Learn Islam).',
    `Answer the user's question in ${langName}.`,
    'Rules:',
    '- Be concise (at most ~180 words), warm and respectful.',
    '- Base answers on the Quran, authentic Hadith and mainstream scholarly understanding (e.g. Diyanet İşleri Başkanlığı).',
    '- If the question needs a personal religious ruling (fatwa), give general guidance and kindly recommend consulting Diyanet or a qualified scholar.',
    '- Never give medical, legal or financial directives; suggest qualified professionals instead.',
    '- Do not invent Quran verse numbers or hadith references you are not sure about.',
    '',
    `Question: ${question}`,
  ].join('\n');
}

async function callGemini(model, prompt, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 512 },
    }),
  });

  if (!res.ok) {
    // Carry the HTTP status so callers can short-circuit auth/quota errors.
    throw Object.assign(new Error(`Gemini HTTP ${res.status}`), {
      status: res.status,
    });
  }

  const data = await res.json();
  const parts = (data && data.candidates && data.candidates[0] &&
    data.candidates[0].content && data.candidates[0].content.parts) || [];
  const text = parts.map((p) => p.text || '').join('').trim();
  if (!text) {
    throw new Error('Gemini returned an empty candidate');
  }
  return text;
}

/**
 * Try to answer a question with Gemini.
 * @param {string} question - the user's question
 * @param {string} language - 'tr' or 'en'
 * @returns {Promise<{answer:string, provider:'gemini', model:string}|null>}
 *   null when no key is configured or every attempt failed.
 */
async function getGeminiAnswer(question, language = 'tr') {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  // Try the pinned model first (if any), then newest-to-older flash models
  // so the module keeps working as Google deprecates old versions.
  const models = [
    ...(process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL.trim()] : []),
    ...DEFAULT_MODELS,
  ].filter((m, i, a) => a.indexOf(m) === i);

  for (const model of models) {
    try {
      const answer = await callGemini(model, buildPrompt(question, language), apiKey);
      return { answer, provider: 'gemini', model };
    } catch (err) {
      // Auth / quota / bad-request problems will repeat for every model:
      if (err.status === 401 || err.status === 403 || err.status === 429 || err.status === 400) {
        console.error(`Gemini request rejected (${err.message}). Check GEMINI_API_KEY / quota.`);
        return null;
      }
      // Model not found (404) or transient failure -> try the next model.
      console.error(`Gemini model "${model}" unavailable (${err.message}), trying next...`);
    }
  }
  return null;
}

module.exports = { getGeminiAnswer };