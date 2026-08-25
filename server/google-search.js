/**
 * Google Search Answer Engine for "İslam nasıl öğrenilir"
 *
 * Uses the Google Programmable Search Engine (Custom Search JSON API) to find
 * real, sourced answers to community questions. Rather than a generative model,
 * this returns a concise summary built from Google's top search results and
 * always includes the live source URL so users can verify.
 *
 * ---------- ONE-TIME SETUP (required) ----------
 * 1. Get a Google Cloud API key (billing optional for the free tier):
 *      https://console.cloud.google.com/apis/credentials
 * 2. Create a Programmable Search Engine (CX / Search Engine ID):
 *      https://programmablesearchengine.google.com/
 *     - In "Sites to search" enter *.diyanet.gov.tr and islamsources.org (or the
 *       sites you want; you can add more).
 * 3. Set in your server's .env:
 *      GOOGLE_API_KEY=your-google-api-key
 *      GOOGLE_CX=your-search-engine-id
 *
 * When these are set, getGoogleAnswer() calls the Google Custom Search JSON API:
 *      https://www.googleapis.com/customsearch/v1?key=...&cx=...&q=...
 */

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || '';
const GOOGLE_CX = process.env.GOOGLE_CX || '';

// Turkish character normalization for adding a language hint to the query.
function normalize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[çÇ]/g, 'c')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[ıİ]/g, 'i')
    .replace(/[öÖ]/g, 'o')
    .replace(/[şŞ]/g, 's')
    .replace(/[üÜ]/g, 'u')
    .replace(/[âÂ]/g, 'a')
    .replace(/[îÎ]/g, 'i')
    .replace(/[ûÛ]/g, 'u')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Search Google and return a sourced answer for the given question.
 * @param {string} question - the user's question
 * @param {string} language - 'tr' or 'en'
 * @returns {Promise<null | { answer: string, source: string, href: string, results: Array }>}
 */
async function searchGoogle(question, language = 'tr') {
  if (!GOOGLE_API_KEY || !GOOGLE_CX) {
    console.warn('Google Custom Search not configured (GOOGLE_API_KEY / GOOGLE_CX missing).');
    return null;
  }

  // Improve result relevance by adding a domain/context hint and language filter.
  const hints = {
    tr: ['islam nedir diyanet fıkıh', 'sites:diyanet.gov.tr islam'],
    en: ['islam islamic fiqh', 'sites:diyanet.gov.tr islam'],
  };
  const query = `${question} ${hints[language] ? hints[language][0] : ''}`.trim();

  const url =
    'https://www.googleapis.com/customsearch/v1' +
    `?key=${encodeURIComponent(GOOGLE_API_KEY)}` +
    `&cx=${encodeURIComponent(GOOGLE_CX)}` +
    `&q=${encodeURIComponent(query)}` +
    `&num=5&gl=${language === 'tr' ? 'tr' : 'us'}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error('Google Custom Search error:', response.status, await response.text());
      return null;
    }
    const data = await response.json();

    const results = (data.items || []).slice(0, 5).map((item) => ({
      title: item.title,
      snippet: item.snippet,
      link: item.link,
    }));

    if (results.length === 0) return null;

    // Build a concise, well-sourced answer from the top results.
    const top = results[0];
    const answer = language === 'tr'
      ? `İşte arama sonuçlarına dayalı kısa bir özet:\n\n${top.snippet || top.title}\n\nKaynak: ${top.title} (${top.link})`
      : `Here is a short summary based on search results:\n\n${top.snippet || top.title}\n\nSource: ${top.title} (${top.link})`;

    return {
      answer,
      source: language === 'tr' ? 'Google arama sonucu' : 'Google search result',
      href: top.link,
      results,
    };
  } catch (error) {
    console.error('Google search request failed:', error.message);
    return null;
  }
}

module.exports = { searchGoogle, normalize };