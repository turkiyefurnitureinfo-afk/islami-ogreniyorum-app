// ---------------------------------------------------------------------------
// Question answering — SERVER-FIRST (Serper.dev Google + Groq synthesis).
// ---------------------------------------------------------------------------
// Priority order in getAIAnswer():
//   1. Backend /api/ai/chat  — Serper.dev Google results synthesized by Groq
//      (concise, sourced, conversational Islamic assistant).
//   2. Backend /api/ai/answer — legacy search pipeline (same server keys).
//   3. On-device keyless fallback — Wikipedia extracts + DuckDuckGo HTML.
//      Runs ONLY when the server is unreachable. If you see
//      "I could not find a matching wikipedia article", the app never
//      reached the server (old build, offline, or Render sleeping) —
//      rebuild + reinstall the latest build, then retry on network.
//
// SPEED: server call races a local fallback guard; on-device variants fire
// in parallel (Promise.allSettled) and the best hit wins.
//
// No client-side API keys required. Works on all platforms — RN's fetch has
// no CORS restrictions on native, and Wikipedia sends permissive CORS
// headers (`origin=*`) for web builds.
// ---------------------------------------------------------------------------

// Per-request timeout (Wikipedia is fast; this only guards stalled sockets so
// answers stay immediate). 10s hard ceiling per the task spec.
const WEB_SEARCH_TIMEOUT_MS = 10000;

// DuckDuckGo HTML search endpoint — the only DDG endpoint that returns real
// snippet text (the Instant Answer API returns junk for religious questions).
const DDG_HTML_URL = 'https://html.duckduckgo.com/html/';

// A browser-like User-Agent is required: DDG's HTML endpoint returns a bare
// "blank" page to default React Native fetch UAs.
const DDG_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Religious keywords that must NEVER be stripped from a query — they are the
// actual subject of the question. Appending "Islam" / "Diyanet" to a query
// steers search results toward authoritative religious content.
const ISLAMIC_KEYWORDS_TR = [
  'namaz', 'oruç', 'oruç', 'zekat', 'hac', 'abdest', 'wudu', 'hadis',
  'kuran', 'kur\'an', 'islam', 'müslüman', 'muslim', 'diyanet', 'peygamber',
  'sahabe', 'allah', 'tevhid', 'inanç', 'farz', 'vacip', 'sünnet', 'mekruh',
  'helal', 'haram', 'cennet', 'cehennem', 'melek', 'melekler', 'kıble',
  'ezan', 'vitir', 'teravih', 'bayram', 'kurban', 'aşure', 'mevlid',
  'ramazan', 'şaban', 'receb', 'şaban', 'regâip', 'berat', 'kadir',
];
const ISLAMIC_KEYWORDS_EN = [
  'prayer', 'fasting', 'zakat', 'hajj', 'wudu', 'hadith', 'quran', 'koran',
  'islam', 'muslim', 'diyanet', 'prophet', 'sahaba', 'allah', 'tawhid',
  'faith', 'fard', 'wajib', 'sunnah', 'makruh', 'halal', 'haram',
  'paradise', 'hell', 'angel', 'qibla', 'adhan', 'ezan', 'taraweeh',
  'eid', 'sacrifice', 'ashura', 'mawlid', 'ramadan', 'shaban', 'rajab',
  'mid-sha\'ban', 'laylat al-qadr',
];

/**
 * Detect whether a query is religious in nature (so we can steer results).
 * @param {string} query
 * @param {'tr'|'en'} language
 * @returns {boolean}
 */
function isReligiousQuery(query, language) {
  const q = query.toLowerCase();
  const keywords = language === 'tr' ? ISLAMIC_KEYWORDS_TR : ISLAMIC_KEYWORDS_EN;
  return keywords.some((kw) => q.includes(kw));
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    signal: AbortSignal.timeout(WEB_SEARCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  }
  return res.json();
}

/**
 * fetchJson with 429-aware retries. Wikipedia rate-limits bursts with
 * HTTP 429; status-aware backoff (900 ms, then 1800 ms) absorbs those blips
 * without making the user wait meaningfully longer (429s return instantly).
 * @param {string} url
 * @returns {Promise<any>}
 */
async function fetchJsonWithRetry(url) {
  const backoffs = [900, 1800];
  let lastError = null;
  for (let i = 0; i <= backoffs.length; i++) {
    try {
      return await fetchJson(url);
    } catch (error) {
      lastError = error;
      if (i < backoffs.length) {
        await new Promise((resolve) => setTimeout(resolve, backoffs[i]));
      }
    }
  }
  throw lastError;
}

// --- Keyword extraction for better search results ---------------------------
// The old extractor removed religious nouns (prayer, islam, namaz...) from the
// stop-list, which sometimes collapsed the query to nothing and made Wikipedia
// return zero results — exactly why users saw "could not find a summary".
// The new extractor only removes TRUE question/filler words, keeping every
// meaningful noun so the search term matches real Wikipedia article titles.

/** Normalize Turkish characters to ASCII for stop-word matching. */
function normalizeTr(w) {
  return w
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u');
}

// Only genuine question/filler words — religious nouns stay out on purpose.
const TR_QWORDS = new Set([
  'nasıl', 'nasil', 'nedir', 'ne', 'neden', 'niçin', 'nicin', 'kim', 'kime',
  'kimin', 'hangi', 'hangisi', 'nerede', 'nereye', 'kaç', 'kac', 'kadar',
  'mi', 'mı', 'mu', 'mü', 'da', 'de', 'ki', 'bir', 'bu', 'şu', 'su', 'o',
  'için', 'icin', 'ile', 'ama', 'fakat', 'çok', 'cok', 'gibi', 'var', 'yok',
  've', 'veya', 'ya', 'değil', 'degil', 'dır', 'dir', 'dur', 'dür',
  'yapılır', 'yapilir', 'edilir', 'etmek', 'yapmak', 'yapılıyor', 'kılınır',
  'kilinir', 'kılmak', 'kilmak', 'alınır', 'alinir', 'almak', 'verilir',
  'bulunur', 'söylenir', 'soylenir', 'bilinir', 'görülür', 'gorulur',
  'denir', 'der', 'olur', 'olurmu', 'mudur', 'midir', 'mıdır', 'nasıldır',
  'nasildir', 'demek', 'diyor', 'demiş',
]);

const EN_QWORDS = new Set([
  'how', 'what', 'why', 'when', 'where', 'who', 'which', 'whose', 'whom',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'the', 'a', 'an',
  'of', 'in', 'on', 'at', 'for', 'with', 'and', 'or', 'but', 'not', 'to',
  'do', 'does', 'did', 'done', 'have', 'has', 'had', 'can', 'could', 'should',
  'would', 'will', 'shall', 'may', 'might', 'me', 'my', 'myself', 'we', 'you',
  'your', 'it', 'its', 'that', 'this', 'these', 'those', 'i', 'they', 'them',
  'perform', 'make', 'take', 'give', 'tell', 'know', 'learn', 'explain',
  'about', 'please', 'asking', 'asked', 'ask', 'means', 'mean', 'many',
  'much', 'some', 'all', 'every', 'difference', 'between', 'proper', 'correct',
  'person', 'people',
]);

/**
 * Turn a question into an ordered list of meaningful tokens (nouns etc.).
 * @param {string} question
 * @param {'tr'|'en'} language
 * @returns {string[]}
 */
function extractKeywordTokens(question, language) {
  const stop = language === 'tr' ? TR_QWORDS : EN_QWORDS;
  const tokens = question
    .toLowerCase()
    .split(/[^a-zçğıöşüâàáäãåæéèêëíìîïóòôöõúùûüÿñ]+/gi)
    .map((w) => w.trim())
    .filter((w) => w.length > 2);
  const seen = new Set();
  const out = [];
  for (const raw of tokens) {
    const key = language === 'tr' ? normalizeTr(raw) : raw;
    if (stop.has(key) || stop.has(raw) || seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
    if (out.length >= 6) break;
  }
  return out;
}

/**
 * Build up to 5 distinct Wikipedia search candidates for a question.
 * The full phrase is tried first, then progressively narrower keyword
 * combinations — all of them are fired IN PARALLEL by the caller, so the
 * first useful hit wins instantly.
 * @param {string} question
 * @param {'tr'|'en'} language
 * @returns {string[]}
 */
function buildSearchQueries(question, language) {
  const clean = question.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const tokens = extractKeywordTokens(clean, language);
  const results = new Set();
  results.add(clean);

  // Islamic keyword optimization: for religious queries, append "Islam" /
  // "Diyanet" context to steer search results toward authoritative religious
  // content. This is the #1 fix for religious questions returning zero results.
  if (isReligiousQuery(clean, language)) {
    results.add(language === 'tr' ? `${clean} İslam` : `${clean} Islam`);
    results.add(language === 'tr' ? `${clean} Diyanet` : `${clean} Diyanet`);
  }

  if (tokens.length >= 3) results.add(tokens.slice(0, 3).join(' '));
  if (tokens.length >= 2) results.add(tokens.slice(0, 2).join(' '));
  if (tokens.length >= 1) results.add(tokens[0]);
  if (tokens.length >= 2) results.add(tokens[1]);
  // Cap at 5: Wikipedia rate-limits (HTTP 429) aggressive bursts, so fewer,
  // smarter candidates beat a big fan-out. The Islamic context queries get
  // priority placement at the front.
  return [...results].slice(0, 5);
}

// ---------------------------------------------------------------------------
// WIKIPEDIA SEARCH + EXTRACTS (single request)
// ---------------------------------------------------------------------------
// DuckDuckGo's Instant Answer API rarely has useful content for religious
// questions and its "RelatedTopics" are short link-junk fragments, so it has
// been REMOVED as an answer provider. It now appears only as a clickable
// reference link in the answer's sources (user-tappable -> external search).
//
// THIS IS THE ANSWER ENGINE: one MediaWiki request that combines
//   generator=search  -> find article titles matching the keywords
//   prop=extracts      -> fetch each article's intro paragraph AS PLAIN TEXT
// so a full, real answer extract is available without a second round-trip.
// @param {string} query
// @param {'tr'|'en'} language
// @returns {Promise<Array|null>} [{title, url, extract, source, lang}]
/**
 * ONE Wikipedia request = article search + intro extracts (single round-trip).
 * Combines `generator=search` (find pages) with `list=search` (ordered ranks)
 * and `prop=extracts` (intro paragraphs as plain text) — everything needed to
 * build a real answer in a single network call.
 *
 * @param {string} query - search keywords
 * @param {'tr'|'en'} lang - single wiki language edition
 * @returns {Promise<Array|null>} [{title, url, extract, source, lang}] ordered by relevance
 */
async function searchWikipediaExtracts(query, lang) {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrlimit: '3',
    gsrenamespace: '0',
    // Combine list=search with generator=search so the response carries BOTH
    // the ordered headline list (query.search) and the page extracts
    // (query.pages) in this single request.
    list: 'search',
    srsearch: query,
    srlimit: '3',
    prop: 'extracts',
    exintro: '1',
    explaintext: '1',
    exlimit: '3',
    format: 'json',
    utf8: '1',
    origin: '*',
  });
  const url = `https://${lang}.wikipedia.org/w/api.php?${params}`;

  // 429-aware fetch: one retry with a short backoff keeps answers immediate
  // while absorbing Wikipedia's transient rate-limit blips.
  const data = await fetchJsonWithRetry(url);

  const pages = (data && data.query && data.query.pages) || {};
  const pageList = Object.values(pages).filter((p) => p && p.title);
  // Preferred ordering: `query.search` (returned in the same request).
  // Fallback: the `index` field each page carries (its own search rank).
  const orderedTitles = ((data && data.query && data.query.search) || []).map((h) => h.title);
  const ordered = orderedTitles.length > 0
    ? orderedTitles.map((t) => pageList.find((p) => p.title === t)).filter(Boolean)
    : pageList.slice().sort((a, b) => (a.index || 99) - (b.index || 99));

  const results = [];
  for (const page of ordered.slice(0, 3)) {
    const extract = String(page.extract || '').trim();
    if (!extract) continue;
    results.push({
      title: page.title,
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(page.title).replace(/ /g, '_'))}`,
      extract,
      source: `${lang}.wikipedia.org`,
      lang,
    });
  }
  return results.length > 0 ? results : null;
}

// ---------------------------------------------------------------------------
// DUCKDUCKGO HTML SEARCH (Tier 1 — real snippet text)
// ---------------------------------------------------------------------------
// DuckDuckGo's HTML endpoint returns real result snippets (unlike the Instant
// Answer API which returns junk for religious questions). We POST to
// html.duckduckgo.com/html/ with a browser-like User-Agent and parse the
// result titles + snippet text out of the returned HTML using regex (no DOM).
//
// This is the FIRST tier in the answer chain: if DDG returns a usable snippet,
// we use it immediately without hitting Wikipedia (faster, and DDG's index
// covers many religious sites Wikipedia doesn't).
// ---------------------------------------------------------------------------

/**
 * Fetch and parse DuckDuckGo HTML search results for a query.
 * Returns up to 3 results, each { title, url, extract, source, lang }.
 * Returns null on any failure (network, parse, rate-limit) so the caller can
 * fall through to the Wikipedia tier.
 *
 * @param {string} query - search keywords
 * @param {'tr'|'en'} lang - language context (used for source label)
 * @returns {Promise<Array|null>}
 */
async function searchDuckDuckGoHTML(query, lang) {
  const body = new URLSearchParams({ q: query }).toString();
  let html;
  try {
    const res = await fetch(DDG_HTML_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': DDG_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': lang === 'tr' ? 'tr-TR,tr;q=0.9' : 'en-US,en;q=0.9',
      },
      body,
      signal: AbortSignal.timeout(WEB_SEARCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    html = await res.text();
  } catch (error) {
    // Network/timeout — fall through to Wikipedia tier silently.
    return null;
  }

  if (!html || html.length < 200) return null;

  // Parse DDG HTML results. Each result is a <div class="result"> containing
  // <a class="result__a"> (title + link) and <a class="result__snippet"> (text).
  const results = [];
  const resultBlockRe = /<div[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  let blockMatch;
  while ((blockMatch = resultBlockRe.exec(html)) !== null) {
    if (results.length >= 3) break;
    const block = blockMatch[1];

    // Title + URL from the result__a link.
    const titleMatch = block.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!titleMatch) continue;
    const rawUrl = titleMatch[1];
    const title = String(titleMatch[2] || '')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
    if (!title) continue;

    // Snippet text from result__snippet.
    const snippetMatch = block.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    let extract = snippetMatch
      ? String(snippetMatch[1])
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/\s+/g, ' ')
          .trim()
      : '';

    // DDG sometimes puts the snippet in a <td class="result__snippet"> instead.
    if (!extract) {
      const tdMatch = block.match(/<td[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
      if (tdMatch) {
        extract = String(tdMatch[1])
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/\s+/g, ' ')
          .trim();
      }
    }

    if (!extract || extract.length < 30) continue;

    // Resolve DDG's redirect URLs (/l/?uddg=...) to real https URLs.
    let url = rawUrl;
    try {
      if (rawUrl.startsWith('/l/')) {
        const parsed = new URL(rawUrl, DDG_HTML_URL);
        const real = parsed.searchParams.get('uddg');
        if (real) url = decodeURIComponent(real);
      }
    } catch {
      url = rawUrl;
    }
    if (!url.startsWith('http')) url = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;

    results.push({
      title,
      url,
      extract,
      source: 'duckduckgo.com',
      lang,
    });
  }

  return results.length > 0 ? results : null;
}

// ---------------------------------------------------------------------------
// ANSWER COMPOSITION
// ---------------------------------------------------------------------------

/**
 * Build the user-facing answer text from a single Wikipedia article extract.
 *
 * Formatted conversationally so the reply reads like a chatbot answer, not a
 * raw list of links: a short lead-in, the article's intro paragraph as flowing
 * prose (capped at a sentence boundary), then the source + guidance line.
 *
 * @param {object} primary - { title, extract, url, source, lang } of the best hit
 * @param {'tr'|'en'} language
 * @returns {string}
 */
function buildSearchAnswerText(primary, language) {
  const tr = language === 'tr';

  // Wikipedia intro extracts are already clean, encyclopaedic prose.
  let body = String(primary.extract || '')
    .replace(/\s+/g, ' ')
    .trim();

  // Cap at ~430 chars, cutting at the last sentence boundary for readability.
  const MAX = 430;
  if (body.length > MAX) {
    const cutoff = body.slice(0, MAX);
    const lastStop = Math.max(
      cutoff.lastIndexOf('.'),
      cutoff.lastIndexOf('!'),
      cutoff.lastIndexOf('?')
    );
    body = lastStop > 120 ? cutoff.slice(0, lastStop + 1) : (cutoff.trimEnd() + '…');
  }

  const lines = [];
  lines.push(
    tr
      ? 'Sorunuzun cevabını şöyle özetleyebilirim:'
      : 'Here is a concise answer to your question:'
  );
  lines.push('');
  if (body) {
    lines.push(body.charAt(0).toUpperCase() + body.slice(1));
  }
  lines.push('');
  lines.push(
    tr
      ? `📖 Kaynak: ${primary.source === 'duckduckgo.com' ? 'DuckDuckGo' : 'Vikipedi'} — “${primary.title}”`
      : `📖 Source: ${primary.source === 'duckduckgo.com' ? 'DuckDuckGo' : 'Wikipedia'} — “${primary.title}”`
  );
  lines.push('');
  // 📌 Sources section — formatted chatbot-style with clickable reference links.
  lines.push(tr ? '📌 Kaynaklar / Sources:' : '📌 Kaynaklar / Sources:');
  lines.push(`• ${primary.title} — ${primary.url}`);
  lines.push('');
  lines.push(
    tr
      ? 'Daha fazla bilgi için yukarıdaki kaynak bağlantısına dokunabilirsiniz.'
      : 'Tap the reference link above for more details.'
  );
  lines.push(
    tr
      ? 'Not: Bu özet ansiklopedik bilgidir; dinî hükümler için Diyanet İşleri Başkanlığı’na danışmanız önerilir.'
      : 'Note: this is encyclopedic information; for religious rulings, please consult Diyanet.'
  );
  return lines.join('\n');
}

/**
 * Build the clickable reference links shown under every answer.
 * The article (when found) is listed first, followed by the manual-search
 * links — DuckDuckGo is deliberately placed at the TOP of these so users can
 * deep-dive their question on the open web without the app answering from it.
 *
 * @param {string} question
 * @param {'tr'|'en'} language
 * @param {{title:string,url:string,source:string}|null} article
 * @returns {Array<{title:string,url:string,source:string}>}
 */
function buildReferenceSources(question, language, article) {
  const tr = language === 'tr';
  const q = encodeURIComponent(question);
  const wikiLang = language === 'en' ? 'en' : 'tr';
  const sources = [];
  if (article) {
    sources.push({ title: article.title, url: article.url, source: article.source });
  }
  sources.push(
    { title: tr ? 'DuckDuckGo’da ara' : 'Search DuckDuckGo', url: `https://duckduckgo.com/?q=${q}`, source: 'duckduckgo.com' },
    { title: tr ? 'Google’da ara' : 'Search Google', url: `https://www.google.com/search?q=${q}`, source: 'google.com' },
    { title: tr ? 'Wikipedia’da ara' : 'Search Wikipedia', url: `https://${wikiLang}.wikipedia.org/wiki/Special:Search?search=${q}`, source: 'wikipedia.org' },
    { title: 'Diyanet İşleri Başkanlığı', url: 'https://www.diyanet.gov.tr', source: 'diyanet.gov.tr' }
  );
  return sources;
}

/**
 * Friendly fallback shown when every Wikipedia query comes back empty.
 * Formatted like a normal chatbot reply (never a blank bubble) and — per the
 * product decision — hands the user to CLICKABLE manual-search reference links
 * (DuckDuckGo is listed first) instead of trying to answer from DuckDuckGo.
 *
 * @param {string} question
 * @param {'tr'|'en'} language
 * @returns {{answer:string, provider:string, sources:Array, noResults:boolean}}
 */
function buildNoResultsText(question, language) {
  const tr = language === 'tr';
  const lines = [];

  lines.push(
    tr
      ? 'Bu soru için Wikipedia’da hazır bir madde bulamadım. 🙏'
      : 'I could not find a matching Wikipedia article for this question. 🙏'
  );
  lines.push('');
  lines.push(
    tr
      ? 'Aşağıdaki arama bağlantılarına dokunarak cevabı DuckDuckGo veya Google üzerinden bulabilirsiniz.'
      : 'Tap the search links below to find the answer on DuckDuckGo or Google.'
  );
  lines.push('');
  lines.push(
    tr
      ? 'Not: Dinî hükümler için Diyanet İşleri Başkanlığı’nın resmî sitesi veya bir âlimine danışmak en doğrusudur.'
      : 'Note: for religious rulings, the official Diyanet website or a qualified scholar is the best reference.'
  );

  return {
    answer: lines.join('\n'),
    provider: 'web-search',
    sources: buildReferenceSources(question, language, null),
    noResults: true,
  };
}

/**
 * Answer a question using a multi-tiered, 100% free web search pipeline.
 *
 * TIER 1 — DuckDuckGo HTML search: real snippet text from DDG's index (covers
 * many religious sites Wikipedia doesn't). Faster than Wikipedia and returns
 * results for queries Wikipedia has no article for.
 *
 * TIER 2 — Wikipedia search + intro extracts: encyclopaedic prose from the
 * MediaWiki API (generator=search + prop=extracts, single round-trip).
 *
 * TIER 3 — Search URL fallback: a pre-formatted Google / DuckDuckGo /
 * Wikipedia / Diyanet search link so the user can deep-dive manually.
 *
 * GUARANTEES a usable reply object for every well-formed question — the
 * formatted fallback (Tier 3) is returned instead of null, so the chat UI
 * never renders a broken or blank AI bubble.
 *
 * @param {string} question
 * @param {'tr'|'en'} language
 * @returns {Promise<{answer:string, provider:string, sources:Array, noResults?:boolean}>}
 *   resolves always; rejects only for invalid input.
 */
export async function getWebSearchAnswer(question, language = 'tr') {
  if (!question || typeof question !== 'string') return null;
  const safeQuestion = question.trim().slice(0, 1000);
  if (safeQuestion.length < 2) return null;

  const queries = buildSearchQueries(safeQuestion, language);

  // ---- TIER 1: DuckDuckGo HTML search ------------------------------------
  // Try DDG first — it's faster than Wikipedia and covers more religious
  // content. Fire the top 2 query variants in parallel; first usable hit wins.
  try {
    for (const q of queries.slice(0, 2)) {
      const ddgHits = await searchDuckDuckGoHTML(q, language);
      if (ddgHits && ddgHits.length > 0) {
        const best = ddgHits[0];
        console.log(`[AI] Answer from DuckDuckGo: "${best.title}"`);
        const article = { title: best.title, url: best.url, source: best.source };
        return {
          answer: buildSearchAnswerText(best, language),
          provider: 'web-search',
          sources: buildReferenceSources(safeQuestion, language, article),
        };
      }
    }
  } catch (error) {
    console.warn('[AI] DuckDuckGo tier failed:', error?.message || error);
  }

  // ---- TIER 2: Wikipedia search + extracts -------------------------------
  // Language WAVES: wave 1 fires every query variant against the UI language
  // IN PARALLEL and wins immediately if anything hits; only an empty wave 1
  // falls through to the fallback language wave.
  console.log('[AI] DDG returned no hits — trying Wikipedia tier');
  const waves = language === 'en' ? [['en']] : [['tr'], ['en']];

  let hits = [];
  for (let w = 0; w < waves.length; w++) {
    const wave = waves[w];
    // Stagger the starts slightly (~140 ms apart): the burst still completes
    // in about a second, but Wikipedia's rate limiter sees a trickle instead
    // of 5 simultaneous hits, which was causing spurious empty answers.
    const attempts = [];
    for (const q of queries) {
      for (const lang of wave) {
        attempts.push({ q, lang, fn: () => searchWikipediaExtracts(q, lang) });
      }
    }

    const settled = await Promise.allSettled(
      attempts.map((a, i) =>
        new Promise((resolve) => setTimeout(resolve, i * 140)).then(a.fn)
      )
    );

    attempts.forEach((attempt, i) => {
      const r = settled[i];
      if (r.status !== 'fulfilled' || !r.value) return;
      for (const h of r.value) {
        hits.push({ ...h, _q: attempt.q, _lang: attempt.lang });
      }
    });

    if (hits.length > 0) break; // first productive wave wins — immediate
    // Pause before the fallback-language wave so the previous burst has fully
    // drained from Wikipedia's rate limiter.
    if (w < waves.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
  }

  if (hits.length > 0) {
    // Rank: prefer the UI language, then an exact/partial-title match with the
    // strongest keyword, then earlier search order.
    const tokens = extractKeywordTokens(safeQuestion, language);
    const primaryTerm = tokens.length > 0 ? (language === 'tr' ? normalizeTr(tokens[0]) : tokens[0].toLowerCase()) : '';
    let best = null;
    let bestScore = -Infinity;
    for (const h of hits) {
      let score = h._lang === language ? 100 : 0;
      const titleKey = language === 'tr' ? normalizeTr(h.title).toLowerCase() : h.title.toLowerCase();
      if (primaryTerm && titleKey === primaryTerm) score += 80;
      else if (primaryTerm && titleKey.startsWith(primaryTerm)) score += 60;
      else if (primaryTerm && primaryTerm.startsWith(titleKey)) score += 40;
      score -= hits.indexOf(h) * 5;
      if (score > bestScore) {
        bestScore = score;
        best = h;
      }
    }

    if (best && best.extract) {
      console.log(`[AI] Answer from Wikipedia (${best._lang}): "${best.title}"`);
      const article = { title: best.title, url: best.url, source: best.source };
      return {
        answer: buildSearchAnswerText(best, language),
        provider: 'web-search',
        sources: buildReferenceSources(safeQuestion, language, article),
      };
    }
  }

  // ---- TIER 3: Search URL fallback ---------------------------------------
  console.log('[AI] All search tiers returned no hits — using clickable-search fallback');
  return buildNoResultsText(safeQuestion, language);
}

// ---------------------------------------------------------------------------
// ASYNCSTORAGE PERSISTENCE for AI answers
// ---------------------------------------------------------------------------
// Auto-generated search answers are kept LOCAL to the user's device so search
// limits aren't burned by other users, and so answers survive app restarts.
// Stored under @app/qanda as a JSON map of question -> answer.
// ---------------------------------------------------------------------------

/**
 * Load the persisted AI answers map from AsyncStorage.
 * @returns {Promise<Record<string, {answer:string, provider:string, sources?:Array, savedAt:number}>>}
 */
export async function loadPersistedAIAnswers() {
  try {
    const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
    const raw = await AsyncStorage.getItem('@app/qanda_ai_answers');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.warn('[AI] Failed to load persisted answers:', error?.message || error);
    return {};
  }
}

/**
 * Save a single AI answer to AsyncStorage, keyed by the normalized question.
 * Caps the cache at 200 entries (oldest by savedAt evicted).
 * @param {string} question
 * @param {{answer:string, provider:string, sources?:Array}} answer
 */
export async function persistAIAnswer(question, answer) {
  if (!question || !answer) return;
  try {
    const store = await loadPersistedAIAnswers();
    const key = question.trim().slice(0, 200);
    store[key] = { ...answer, savedAt: Date.now() };
    // Evict oldest entries if cache exceeds 200.
    const entries = Object.entries(store).sort((a, b) => (b[1].savedAt || 0) - (a[1].savedAt || 0));
    if (entries.length > 200) {
      const trimmed = entries.slice(0, 200);
      const trimmedStore = {};
      for (const [k, v] of trimmed) trimmedStore[k] = v;
      const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
      await AsyncStorage.setItem('@app/qanda_ai_answers', JSON.stringify(trimmedStore));
      return;
    }
    const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
    await AsyncStorage.setItem('@app/qanda_ai_answers', JSON.stringify(store));
  } catch (error) {
    console.warn('[AI] Failed to persist answer:', error?.message || error);
  }
}

/**
 * Look up a previously-generated answer for a question (cache hit avoids a
 * network round-trip). Returns null on cache miss.
 * @param {string} question
 * @returns {Promise<{answer:string, provider:string, sources?:Array}|null>}
 */
export async function getPersistedAIAnswer(question) {
  if (!question) return null;
  const store = await loadPersistedAIAnswers();
  const key = question.trim().slice(0, 200);
  const entry = store[key];
  if (!entry) return null;
  // Return without the internal savedAt field.
  const { savedAt, ...answer } = entry;
  return answer;
}

// Lazy import for the Firebase Web SDK app — reused by mediaService.js
// (Firebase Storage) so both features share a single initialised app instance.
let _firebaseApp = null;

async function getFirebaseAppModules() {
  if (!_firebaseApp) {
    _firebaseApp = await import('firebase/app');
  }
  return _firebaseApp;
}

import Constants from 'expo-constants';
import { API_URL } from './config.js';

// Web-app config for THIS Firebase project (islami-ogreniyorum). These are
// public, client-side identifiers — the same values Firebase publishes in
// Project Settings. Read from expo-constants (configured in app.json) so they
// can be changed without modifying source code. Falls back to the values
// from app.json for development.
const FIREBASE_WEB_CONFIG = {
  apiKey: Constants?.expoConfig?.extra?.firebaseWebConfig?.apiKey || 'AIzaSyDwIT4O1c_24SzLx42CuI36mjYhX24YFcY',
  authDomain: Constants?.expoConfig?.extra?.firebaseWebConfig?.authDomain || 'islami-ogreniyorum.firebaseapp.com',
  projectId: Constants?.expoConfig?.extra?.firebaseWebConfig?.projectId || 'islami-ogreniyorum',
  storageBucket: Constants?.expoConfig?.extra?.firebaseWebConfig?.storageBucket || 'islami-ogreniyorum.firebasestorage.app',
  messagingSenderId: Constants?.expoConfig?.extra?.firebaseWebConfig?.messagingSenderId || '817195380589',
  appId: Constants?.expoConfig?.extra?.firebaseWebConfig?.appId || '1:817195380589:android:aa2049bbae8fb9f7c9b464',
};

// Hard ceiling for one search/AI request so the UI never hangs on a stalled
// socket.
const AI_TIMEOUT_MS = 25000;

// The unified answer shape returned by getAIAnswer().
// @typedef {{answer: string, provider: string, sources?: Array}} AIAnswer

let appInstance = null;

/** Initialise (once) and return the Firebase JS app used for AI calls.
 *  Also reused by mediaService.js (Firebase Storage uploads) so both features
 *  share a single initialised app instance. */
export async function getFirebaseApp() {
  if (!appInstance) {
    const firebaseApp = await getFirebaseAppModules();
    appInstance = firebaseApp.getApps().length > 0 
      ? firebaseApp.getApp() 
      : firebaseApp.initializeApp(FIREBASE_WEB_CONFIG);
  }
  return appInstance;
}

/** True when the embedded Firebase config is present (always true in builds). */
export function isAIConfigured() {
  return Boolean(
    FIREBASE_WEB_CONFIG.apiKey &&
      FIREBASE_WEB_CONFIG.projectId &&
      FIREBASE_WEB_CONFIG.appId
  );
}

/**
 * Get an answer for a community question — SERVER-FIRST.
 *
 *   Tier 0 (primary): backend /api/ai/chat — Serper.dev Google results
 *     synthesized by Groq into a concise sourced answer.
 *   Tier 0b: backend /api/ai/answer — legacy search pipeline.
 *   Tier 1 (offline fallback only): on-device DuckDuckGo HTML search.
 *   Tier 2 (offline fallback only): on-device Wikipedia extracts.
 *   Tier 3: Search URL fallback (clickable Google/DDG/Wikipedia/Diyanet links)
 *
 * Answers are cached locally in AsyncStorage so repeated questions resolve
 * instantly and server quota isn't burned by other users.
 *
 * @param {string} question - the user's question
 * @param {'tr'|'en'} language - 'tr' or 'en'
 * @returns {Promise<{answer: string, provider: string, sources?: Array}>}
 *   the generated answer
 * @throws {Error} when no provider can produce an answer (offline etc.).
 */
export async function getAIAnswer(question, language = 'tr') {
  if (!question || typeof question !== 'string') {
    throw new Error('Question must be a non-empty string');
  }
  // Cap the payload the model sees (cost + abuse protection).
  const safeQuestion = question.trim().slice(0, 1000);
  if (safeQuestion.length < 2) {
    throw new Error('Question is too short');
  }

  // ---------------------------------------------------------------------
  // CACHE CHECK: return a previously-generated answer immediately so we
  // don't burn search quota on repeated questions.
  // ---------------------------------------------------------------------
  try {
    const cached = await getPersistedAIAnswer(safeQuestion);
    if (cached) {
      console.log('[AI] Cache hit for:', safeQuestion);
      return cached;
    }
  } catch (error) {
    console.warn('[AI] Cache read failed:', error?.message || error);
  }

  // ---------------------------------------------------------------------
  // PRIMARY SOURCE: backend Serper.dev (Google) + Groq synthesis pipeline.
  // The server holds SERPER_API_KEY + GROQ_API_KEY, so answers are real,
  // sourced Google results — NOT bare Wikipedia extracts.
  // ---------------------------------------------------------------------
  console.log('[AI] Attempting server answer (Serper+Groq) for:', safeQuestion);
  try {
    const serverAnswer = await fetchServerAIAnswer(safeQuestion, language);
    if (serverAnswer) {
      console.log('[AI] Server answer succeeded, provider:', serverAnswer.provider);
      // Persist the answer locally (fire-and-forget — never block the UI).
      persistAIAnswer(safeQuestion, serverAnswer).catch(() => {});
      return serverAnswer;
    }
    console.warn('[AI] Server answer returned null/empty — falling back to device');
  } catch (error) {
    // Surface the warming-up signal to the caller (don't swallow it).
    if (error.isWarmingUp) throw error;
    console.warn('[AI] Server answer failed, falling back to device:', error?.message || error);
  }

  // Secondary (offline fallback only): free keyless on-device web search
  // (DDG → Wikipedia → search URL fallback). Runs ONLY when the server is
  // unreachable (offline / Render sleeping / old deployment).
  console.log('[AI] Attempting on-device web search fallback for:', safeQuestion);
  try {
    const webAnswer = await getWebSearchAnswer(safeQuestion, language);
    if (webAnswer) {
      console.log('[AI] On-device search succeeded, provider:', webAnswer.provider);
      persistAIAnswer(safeQuestion, webAnswer).catch(() => {});
      return webAnswer;
    }
    console.warn('[AI] On-device search returned null/empty');
  } catch (error) {
    console.warn('[AI] On-device search failed:', error?.message || error);
  }

  // Nothing worked — surface a friendly, actionable message.
  console.error('[AI] All providers failed for question:', safeQuestion);
  const tr = language === 'tr';
  throw new Error(
    tr
      ? 'Sorunuzu şu an cevaplayamıyorum. Lütfen internet bağlantınızı kontrol edin veya sorunuzu farklı kelimelerle yeniden sorun. Dinî hükümler için Diyanet İşleri Başkanlığı\'nın resmî sitesine (diyanet.gov.tr) bakabilirsiniz.'
      : 'I cannot answer your question right now. Please check your internet connection or try rephrasing your question. For religious rulings, please refer to the official Diyanet website (diyanet.gov.tr).'
  );
}

/**
 * PRIMARY answer source: ask our own server (Render) for an answer via the
 * Serper.dev (Google) + Groq synthesis pipeline: POST /api/ai/chat first,
 * then legacy POST /api/ai/answer. Returns null only when the server is
 * unreachable so the caller can use the on-device fallback.
 *
 * @param {string} question
 * @param {'tr'|'en'} language
 * @returns {Promise<{answer:string, provider:string, model?:string}|null>}
 *   null when the server has no answer (non-OK / offline / timeout).
 * @throws {{isWarmingUp:boolean}} when the HF model is warming up (HTTP 503).
 */
async function fetchServerAIAnswer(question, language) {
  for (const endpoint of ['/api/ai/chat', '/api/ai/answer']) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    try {
      const resp = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, language }),
        signal: controller.signal,
      });
      // Hugging Face 503 = model warming up. Surface this so the UI can retry.
      if (resp.status === 503) {
        const data = await resp.json().catch(() => ({}));
        if (data && data.isWarmingUp) {
          const err = new Error(data.error || 'Model warming up');
          err.isWarmingUp = true;
          throw err;
        }
      }
      if (!resp.ok) continue; // try next endpoint
      const data = await resp.json().catch(() => null);
      if (!data || !data.success || !data.answer) continue;
      return {
        answer: String(data.answer),
        provider: data.provider || 'groq',
        ...(data.model ? { model: data.model } : {}),
        ...(Array.isArray(data.sources) && data.sources.length > 0
          ? { sources: data.sources }
          : {}),
      };
    } catch (error) {
      if (error.isWarmingUp) throw error; // re-throw warming-up signal
      if (endpoint === '/api/ai/answer') {
        console.warn('Server AI unavailable:', error?.message || error);
        return null;
      }
      // First endpoint failed (offline / timeout / Render sleeping) — try legacy.
      console.warn(`Server ${endpoint} failed, trying fallback:`, error?.message || error);
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/**
 * Detect configuration-level failures (service not enabled in the Firebase
 * project, blocked API key, permission denied) so the UI can show a hint that
 * actually helps instead of a generic retry message.
 *
 * @param {any} error
 * @returns {boolean}
 */
export function isAIConfigError(error) {
  const text = `${error?.code || ''} ${error?.message || ''}`;
  return /PERMISSION_DENIED|403|api key|API key|api_key|not been used|disabled|permission|failed-precondition|generativelanguage|not allowed|restricted/i.test(
    text
  );
}

/**
 * Human-readable, localized explanation of an answer failure — the message the
 * UI shows in the Q&A tab when an answer could not be generated.
 *
 * @param {any} error
 * @param {'tr'|'en'} [language]
 * @returns {string}
 */
export function describeAIError(error, language = 'tr') {
  const text = `${error?.code || ''} ${error?.message || ''}`;
  const tr = language === 'tr';

  // Hugging Face model warming up (cold start on the free tier) — the most
  // actionable error: tell the user to retry in a few seconds.
  if (error?.isWarmingUp || /warming up|model is warming/i.test(text)) {
    return tr
      ? 'AI modeli şu an ısınıyor (ücretsiz katman). Lütfen 10-15 saniye sonra tekrar deneyin.'
      : 'The AI model is warming up (free tier). Please try again in 10-15 seconds.';
  }

  // Network-level failures (offline, timeout, DNS) — the most common cause
  // now that answers come from Wikipedia / DuckDuckGo.
  if (
    /network|timeout|timed out|abort|offline|fetch failed|http 5\d\d|http 4\d\d/i.test(
      text
    )
  ) {
    return tr
      ? 'Cevap üretilirken bir bağlantı sorunu oluştu. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.'
      : 'A connection problem occurred while generating the answer. Please check your internet connection and try again.';
  }
  return tr
    ? 'Şu anda cevap alınamadı. Lütfen birkaç saniye sonra tekrar deneyin.'
    : 'Could not get an answer right now. Please try again in a moment.';
}

// ---------------------------------------------------------------------------
// Community translation — keyless, search-based (no Gemini dependency).
// Turkish ↔ English so every user can read every post regardless of language.
// ---------------------------------------------------------------------------

/**
 * Translate arbitrary text between Turkish and English.
 *
 * The previous implementation called Gemini, whose free-tier quota has been
 * exhausted. It is now a KEYLESS two-stage pipeline that works everywhere:
 *   1. MyMemory translation API (free, no key, ~5000 chars/day per IP).
 *   2. A built-in offline Turkish↔English glossary for common community
 *      words, used when the network path is unavailable.
 *
 * @param {string} text - text to translate
 * @returns {Promise<{ translated: string, sourceLang: 'tr'|'en', targetLang: 'tr'|'en' }>}
 */
export async function translateText(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('Text must be a non-empty string');
  }
  const safeText = text.trim().slice(0, 500);
  if (safeText.length < 2) {
    throw new Error('Text is too short');
  }

  const sourceLang = looksLikeTurkish(safeText) ? 'tr' : 'en';
  const targetLang = sourceLang === 'tr' ? 'en' : 'tr';

  // --- 1. MyMemory (free, keyless translation API) ------------------------
  try {
    const params = new URLSearchParams({
      q: safeText,
      langpair: `${sourceLang}|${targetLang}`,
      mt: '1',
    });
    const data = await fetchJson(
      `https://api.mymemory.translated.net/get?${params}`
    );
    const translated =
      data && data.responseData && data.responseData.translatedText
        ? String(data.responseData.translatedText).trim()
        : '';
    if (translated && !/^MYMEMORY WARNING/i.test(translated)) {
      return { translated, sourceLang, targetLang };
    }
  } catch (error) {
    console.warn('MyMemory translate failed:', error?.message || error);
  }

  // --- 2. Offline glossary fallback ---------------------------------------
  const glossary = glossaryTranslate(safeText, sourceLang);
  if (glossary) {
    return { translated: glossary, sourceLang, targetLang };
  }

  throw new Error(
    sourceLang === 'tr'
      ? 'Çeviri şu anda kullanılamıyor. Lütfen tekrar deneyin.'
      : 'Translation is unavailable right now. Please try again.'
  );
}

/**
 * Tiny offline Turkish↔English glossary used as the final translation
 * fallback when no network translation provider is reachable. Covers the
 * short community phrases that appear in posts; returns null when nothing
 * matches (the caller then surfaces a friendly "unavailable" message).
 * @param {string} text
 * @param {'tr'|'en'} sourceLang
 * @returns {string|null}
 */
function glossaryTranslate(text, sourceLang) {
  const GLOSSARY = {
    tr: {
      merhaba: 'hello', selam: 'hi', teşekkür: 'thanks', teşekkürler: 'thanks',
      lütfen: 'please', evet: 'yes', hayır: 'no', nasılsın: 'how are you',
      iyiyim: 'i am fine', abdest: 'ablution', namaz: 'prayer', dua: 'prayer',
      oruç: 'fasting', ramazan: 'ramadan', bayram: 'eid', cami: 'mosque',
      kurban: 'sacrifice', zekat: 'zakat', hac: 'hajj', umre: 'umrah',
      sabah: 'morning', öğle: 'noon', ikindi: 'afternoon', akşam: 'evening',
      yatsı: 'night', cemaat: 'congregation', imam: 'imam', kuran: 'quran',
      peygamber: 'prophet', allah: 'god', inşallah: 'god willing',
      maşallah: 'god bless', günaydın: 'good morning',
      iyiakşamlar: 'good evening', hoşçakal: 'goodbye', görüşürüz: 'see you',
    },
    en: {
      hello: 'merhaba', hi: 'selam', thanks: 'teşekkürler', please: 'lütfen',
      yes: 'evet', no: 'hayır', prayer: 'namaz', fasting: 'oruç',
      ramadan: 'ramazan', eid: 'bayram', mosque: 'cami', quran: 'kuran',
      prophet: 'peygamber', god: 'allah', hajj: 'hac', zakat: 'zekat',
      ablution: 'abdest', 'good morning': 'günaydın',
      'good evening': 'iyi akşamlar', goodbye: 'hoşça kal',
      'see you': 'görüşürüz', 'how are you': 'nasılsın',
    },
  };
  const map = GLOSSARY[sourceLang] || GLOSSARY.tr;
  const lower = text.toLowerCase();
  const exact = map[lower];
  if (exact) return exact;
  let replaced = text;
  let hit = false;
  for (const [from, to] of Object.entries(map)) {
    const re = new RegExp(`\\b${from}\\b`, 'gi');
    if (re.test(replaced)) {
      replaced = replaced.replace(re, to);
      hit = true;
    }
  }
  return hit ? replaced : null;
}

/**
 * Lightweight Turkish detection — checks for common Turkish characters and
 * high-frequency suffixes. Good enough to pick the translation direction.
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeTurkish(text) {
  const turkishChars = /[çğıöşüÇĞİÖŞÜ]/;
  if (turkishChars.test(text)) return true;
  const lower = text.toLowerCase();
  const turkishWords = /\b(ve|bir|bu|için|ile|dır|dir|mi|mı|mu|mü|de|da|ki|ama|çok|gibi|var|yok|ne|kim|nasıl|neden|nerede|zaman)\b/;
  return turkishWords.test(lower);
}
