// ---------------------------------------------------------------------------
// serperService.js — Serper.dev Google Search JSON API fetcher
// ---------------------------------------------------------------------------
// Serper.dev returns the SAME Google organic results as Google Custom Search
// with a far more generous free tier (2,500 credits/month) and no CX /
// Programmable Search Engine setup — just one API key.
//
//   API:   POST https://google.serper.dev/search
//   Auth:  X-API-KEY: <your_serper_api_key>
//   Body:  { "q": "...", "num": 5, "gl": "us", "hl": "en" }
//   Resp:  { "organic": [ { "title": "...", "link": "...", "snippet": "..." } ] }
//
// SETUP:
//   1. Sign up at https://serper.dev (free plan = 2,500 credits/month) and
//      copy your API key.
//   2. Add to the server's .env:
//        SERPER_API_KEY=...
//   (Optional) SERPER_MONTHLY_LIMIT=2500  — in-memory monthly cap (free tier).
//   (Optional) SERPER_TIMEOUT_MS=8000     — per-call timeout.
//
// Quota behaviour:
//   We keep an in-memory monthly counter so we never exceed the free quota
//   silently. When exhausted, `searchSerper` returns [] and the chat pipeline
//   gracefully falls back to direct-Groq (quota-resilient, no 500).
// ---------------------------------------------------------------------------

const SERPER_API_KEY = (process.env.SERPER_API_KEY || '').trim();
const SERPER_BASE_URL = (process.env.SERPER_BASE_URL || 'https://google.serper.dev').trim();
const SEARCH_TIMEOUT_MS = Number(process.env.SERPER_TIMEOUT_MS || 8000);

/** Monthly free-tier credit cap (Serper free plan = 2,500 credits/month). */
const MONTHLY_LIMIT = Number(process.env.SERPER_MONTHLY_LIMIT || 2500);
const MONTHLY_WARN = Math.max(0, MONTHLY_LIMIT - 100);

const _state = {
  /** { month: 'YYYY-MM', count: number } */
  month: null,
  count: 0,
};

function getMonth() {
  return new Date().toISOString().slice(0, 7); // 'YYYY-MM'
}

function consumeQuota() {
  const month = getMonth();
  if (_state.month !== month) {
    _state.month = month;
    _state.count = 0;
    console.info(`[serperService] Monthly quota reset (${month})`);
  }
  return _state.count >= MONTHLY_LIMIT
    ? 'exhausted'
    : ((_state.count = _state.count + 1), 'ok');
}

/**
 * Query the Serper.dev Google Search JSON API.
 *
 * @param {string} query   - the search query
 * @param {'tr'|'en'} [language='en'] - result language/geo hint
 * @returns {Promise<Array<{title:string,snippet:string,link:string}>>}
 *   Up to 5 results, or [] when quota is exhausted / API unconfigured / no results.
 */
export async function searchSerper(query, language = 'en') {
  if (!SERPER_API_KEY) {
    console.warn('[serperService] Missing SERPER_API_KEY — skipping web search.');
    return [];
  }

  const quota = consumeQuota();
  if (quota === 'exhausted') {
    console.warn(`[serperService] Monthly quota exhausted (${MONTHLY_LIMIT}). Skipping web search.`);
    return [];
  }

  const body = {
    q: query,
    num: 5,
    gl: language === 'tr' ? 'tr' : 'us',
    hl: language === 'tr' ? 'tr' : 'en',
  };

  try {
    const res = await fetch(SERPER_BASE_URL + '/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': SERPER_API_KEY,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      console.error(`[serperService] API error ${res.status}: ${bodyText.slice(0, 300)}`);
      return [];
    }

    const data = await res.json();
    const organic = Array.isArray(data?.organic) ? data.organic : [];
    if (organic.length === 0) return [];

    return organic
      .map((item) => ({
        title: String(item.title || '').trim(),
        snippet: String(item.snippet || '').trim(),
        link: String(item.link || '').trim(),
      }))
      .filter((r) => r.title && r.link);
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      console.error('[serperService] Request timed out after', SEARCH_TIMEOUT_MS, 'ms');
    } else {
      console.error('[serperService] Fetch exception:', error.message);
    }
    return [];
  }
}

/**
 * Serper monthly usage status (for monitoring / logging).
 * @returns {{ used:number, limit:number, remaining:number, exhausted:boolean, month:string }}
 */
export function getQuotaStatus() {
  return {
    used: _state.count,
    limit: MONTHLY_LIMIT,
    remaining: Math.max(0, MONTHLY_LIMIT - _state.count),
    exhausted: _state.count >= MONTHLY_LIMIT,
    month: _state.month || getMonth(),
  };
}