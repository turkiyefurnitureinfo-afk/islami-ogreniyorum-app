// ---------------------------------------------------------------------------
// search-answer.js — web-search answer source (snippet fallback / legacy endpoint)
// ---------------------------------------------------------------------------
// This module gives the user a useful, sourced answer by querying real web
// search results even when no LLM is configured (or falls through).
//
// Provider order:
//   1. Serper.dev Google Search JSON API    (official Google organic results;
//      needs SERPER_API_KEY, free for 2,500 queries/month).
//   2. DuckDuckGo Instant Answer API        (keyless, needs no setup).
//   3. Wikipedia search API (tr + en)       (keyless, always up, curated).
//
// NOTE: scraping google.com/search HTML is NOT used — it violates Google's
// ToS and breaks constantly. Serper.dev is the official-API way to show
// Google results inside an app.
//
// The formatted answer is plain text: a header, then each result as
// "Title — snippet (domain)". The structured `sources` array is returned
// separately so the app can render tappable links.
// ---------------------------------------------------------------------------

const SEARCH_TIMEOUT_MS = Number(process.env.SEARCH_TIMEOUT_MS || 8000);

/** Domains that are safe/authoritative for religious answers. */
const PREFERRED = /(?:^|\.)(gov\.tr|diyanet\.gov\.tr|wikipedia\.org|islamqa\.info|sukranislam\.com|kuransayfasi\.com|kuranmeali\.com)\b/i;

function stripHtml(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Wikipedia requires a User-Agent header; without it the API returns 200 with
// 0 hits. Identify our bot politely so admins can contact us if needed.
const WIKIPEDIA_UA = 'islami-ogreniyorum/1.0 (https://github.com/turkiyefurnitureinfo-afk/islami-ogreniyorum-app)';

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    headers: {
      'User-Agent': WIKIPEDIA_UA,
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  }
  return res.json();
}

// --- 1. Serper.dev (Google search results, key-only) -------------------------
async function searchSerperResults(query, language) {
  try {
    const { searchSerper } = await import('./services/serperService.js');
    const items = await searchSerper(query, language);
    if (!items || items.length === 0) return null;
    return items.map((it) => ({
      title: stripHtml(it.title),
      snippet: stripHtml(it.snippet),
      url: it.link,
      source: domainOf(it.link),
    }));
  } catch (error) {
    console.error('[search-answer] serper failed:', error.message);
    return null;
  }
}

// --- 2. DuckDuckGo Instant Answer API ---------------------------------------
async function searchDuckDuckGo(query) {
  // Try full query first, then keywords.
  const queries = [query];
  const keywords = extractKeywords(query, 'en');
  if (keywords !== query) queries.push(keywords);

  for (const q of queries) {
    try {
      const params = new URLSearchParams({
        q,
        format: 'json',
        no_html: '1',
        skip_disambig: '1',
      });
      const data = await fetchJson(`https://api.duckduckgo.com/?${params}`);
      const results = [];

      const push = (text, url) => {
        const clean = stripHtml(text);
        if (clean && url && results.length < 4) {
          results.push({
            title: clean.slice(0, 120),
            snippet: clean,
            url,
            source: domainOf(url),
          });
        }
      };

      // Direct instant answer (abstract) — best quality when present.
      if (data.AbstractText && data.AbstractURL) {
        push(`${data.Heading}: ${data.AbstractText}`, data.AbstractURL);
      }
      // Top results / related topics (may be nested one level).
      const walk = (topics) => {
        for (const t of topics || []) {
          if (t.Topics) walk(t.Topics);
          else if (t.FirstURL) push(t.Text, t.FirstURL);
        }
      };
      walk(data.Results);
      walk(data.RelatedTopics);

      if (results.length > 0) return results;
    } catch (error) {
      // Try the next query variant.
    }
  }
  return null;
}

// --- [PART2]
// --- 3. Wikipedia search API (keyless, most reliable fallback) --------------

// Turkish stop words — common words that add noise to search queries.
// ASCII-normalized copy is used for comparison so "nasil" matches "nasıl".
const TR_STOP_WORDS = new Set([
  'bir', 'bu', 'şu', 'ile', 'için', 'gibi', 'kadar', 'daha', 'çok', 'az',
  'var', 'yok', 'nasıl', 'neden', 'niçin', 'nerede', 'ne', 'kim', 'hangi',
  'ama', 'fakat', 'lakin', 'veya', 'ya', 'da', 'de', 'ki', 'mi', 'mı',
  'mu', 'mü', 'değil', 'olan', 'olarak', 'sonra', 'önce',
  'şimdi', 'burada', 'orada', 'her', 'bazı', 'hiç', 'tüm', 'bütün',
  'alinir', 'yapilir', 'edilir', 'olunur', 'verilir',
]);
const TR_STOP_WORDS_NORMALIZED = new Set([...TR_STOP_WORDS].map(normalizeTurkish));

// English stop words.
const EN_STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
  'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
  'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'just', 'because', 'but', 'and',
  'or', 'if', 'while', 'about', 'up', 'what', 'which', 'who', 'whom',
  'this', 'that', 'these', 'those', 'i', 'me', 'my', 'myself', 'we',
  'our', 'ours', 'you', 'your', 'yours', 'he', 'him', 'his', 'she',
  'her', 'hers', 'it', 'its', 'they', 'them', 'their', 'theirs',
  'pray', 'prayer', 'islam', 'islamic', 'muslim', 'do', 'does', 'done',
]);

/**
 * Normalize Turkish characters to their ASCII equivalents so that
 * user-typed queries like "nasil" (Latin i) match stop words like
 * "nasıl" (Turkish ı). Without this, keyword extraction fails and
 * Wikipedia returns 0 hits for queries the user actually typed.
 */
function normalizeTurkish(text) {
  return String(text)
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/İ/g, 'I')
    .replace(/Ş/g, 'S')
    .replace(/Ç/g, 'C')
    .replace(/Ğ/g, 'G')
    .replace(/Ö/g, 'O')
    .replace(/Ü/g, 'U');
}

/**
 * Extract meaningful keywords from a query by removing stop words.
 * Falls back to the original query if extraction yields nothing.
 */
function extractKeywords(query, language) {
  const words = normalizeTurkish(String(query)).toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);

  const stopWords = language === 'en' ? EN_STOP_WORDS : TR_STOP_WORDS_NORMALIZED;
  const keywords = words.filter((w) => !stopWords.has(w));

  // If everything was a stop word, return original
  if (keywords.length === 0) return query;
  return keywords.join(' ');
}

async function searchWikipedia(query, language) {
  const langs = language === 'en' ? ['en'] : ['tr', 'en'];

  // Try the full query first, then fall back to extracted keywords.
  // Wikipedia does exact-phrase matching, so "abdest nasil alinir" returns
  // 0 hits while "abdest" returns many. Keyword extraction fixes this.
  const queries = [query];
  const keywords = extractKeywords(query, language);
  if (keywords !== query) queries.push(keywords);

  for (const lang of langs) {
    for (const q of queries) {
      try {
        const params = new URLSearchParams({
          action: 'query',
          list: 'search',
          srsearch: q,
          format: 'json',
          srlimit: '3',
          utf8: '1',
          origin: '*',
        });
        const url = `https://${lang}.wikipedia.org/w/api.php?${params}`;
        const data = await fetchJson(url);
        const hits = (data && data.query && data.query.search) || [];
        if (hits.length === 0) continue;
        return hits.map((h) => ({
          title: h.title,
          snippet: stripHtml(h.snippet),
          url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(h.title).replace(/ /g, '_'))}`,
          source: `${lang}.wikipedia.org`,
        }));
      } catch (error) {
        console.error(`[search-answer] Wikipedia ${lang} error:`, error.message);
        // Try the next query variant / language.
      }
    }
  }
  return null;
}

/**
 * Build the user-facing answer text from search results.
 * @param {Array<{title:string,snippet:string,url:string,source:string}>} results
 * @param {'tr'|'en'} language
 */
function buildAnswerText(results, language) {
  const tr = language === 'tr';
  // Prefer trusted Islamic sources first, then Wikipedia, then the rest.
  const ranked = [...results].sort((a, b) => {
    const score = (r) => (PREFERRED.test(r.url) ? 0 : 1);
    return score(a) - score(b);
  });
  const lines = [];
  const header = tr
    ? 'İnternetteki güvenilir kaynaklardan derlenen bilgi:'
    : 'Information gathered from trusted sources on the web:';
  lines.push(header, '');
  for (const r of ranked.slice(0, 3)) {
    const snippet = (r.snippet || '').slice(0, 260);
    lines.push(`• ${r.title}${snippet ? ` — ${snippet}` : ''} (${r.source})`);
  }
  lines.push(
    '',
    tr
      ? 'Not: Bu bir yapay zekâ cevabı değil, arama sonuçlarının özetidir. Dinî hükümler için Diyanet İşleri Başkanlığı veya bir âlimine danışın.'
      : 'Note: this is a summary of web search results, not an AI-generated answer. For religious rulings please consult Diyanet or a qualified scholar.'
  );
  return lines.join('\n');
}

/**
 * Try to answer a question from web-search results (no generative AI).
 * @param {string} question
 * @param {'tr'|'en'} language
 * @returns {Promise<{answer:string, provider:'serper', sources:Array}|null>}
 *   null when every provider failed.
 */
async function getSearchAnswer(question, language = 'tr') {
  const providers = [
    ['serper', () => searchSerperResults(question, language)],
    ['duckduckgo', () => searchDuckDuckGo(question)],
    ['wikipedia', () => searchWikipedia(question, language)],
  ];

  for (const [name, fn] of providers) {
    try {
      const results = await fn();
      if (results && results.length > 0) {
        return {
          answer: buildAnswerText(results, language),
          provider: name,
          sources: results
            .slice(0, 3)
            .map((r) => ({ title: r.title, url: r.url, source: r.source })),
        };
      }
    } catch (error) {
      console.error(`[search-answer] ${name} failed:`, error.message);
    }
  }
  return null;
}

module.exports = { getSearchAnswer, buildAnswerText };