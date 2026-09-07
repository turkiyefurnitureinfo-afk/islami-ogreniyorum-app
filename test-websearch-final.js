const WEB_SEARCH_TIMEOUT_MS = 10000;

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

function extractKeywords(question, language) {
  const tr = language === 'tr';
  const stopWords = tr
    ? ['nasıl', 'nedir', 'ne', 'için', 'ile', 'bir', 'bu', 'şu', 'mi', 'mı', 'mu', 'mü', 'da', 'de', 'ki', 'ama', 'çok', 'gibi', 'var', 'yok', 'kim', 'nerede', 'zaman', 'hangi', 'hangisi', 'neden', 'niçin', 'yapılır', 'alınır', 'kılınır', 'edilir', 'verilir', 'bulunur', 'söylenir', 'bilinir', 'görülür']
    : ['how', 'to', 'what', 'is', 'the', 'a', 'an', 'in', 'on', 'at', 'for', 'with', 'and', 'or', 'but', 'not', 'this', 'that', 'it', 'its', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'shall', 'pray', 'prayer'];
  const words = question.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !stopWords.includes(w));
  // If all words were stop words, use the original question (minus very common words)
  if (words.length === 0) {
    const fallback = question.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    return fallback.slice(0, 3).join(' ');
  }
  return words.slice(0, 4).join(' ');
}

async function searchWikipedia(query, language) {
  const langs = language === 'en' ? ['en'] : ['tr', 'en'];
  for (const lang of langs) {
    try {
      // Try full query first, then fall back to single keywords
      const queries = [query, ...query.split(' ').filter((w) => w.length > 3)];
      for (const q of queries) {
        const params = new URLSearchParams({
          action: 'query',
          list: 'search',
          srsearch: q,
          format: 'json',
          srlimit: '3',
          utf8: '1',
          origin: '*',
        });
        const res = await fetch(`https://${lang}.wikipedia.org/w/api.php?${params}`, {
          signal: AbortSignal.timeout(WEB_SEARCH_TIMEOUT_MS),
        });
        if (!res.ok) continue;
        const data = await res.json();
        const hits = (data && data.query && data.query.search) || [];
        if (hits.length > 0) {
          return hits.map((h) => ({
            title: h.title,
            snippet: stripHtml(h.snippet),
            url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(h.title).replace(/ /g, '_'))}`,
            source: `${lang}.wikipedia.org`,
          }));
        }
      }
    } catch (e) {}
  }
  return null;
}

function buildSearchAnswerText(results, language) {
  const tr = language === 'tr';
  const lines = [];
  const header = tr
    ? 'İnternetteki güvenilir kaynaklardan derlenen bilgi:'
    : 'Information gathered from trusted sources on the web:';
  lines.push(header, '');
  for (const r of results.slice(0, 3)) {
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

// --- 2. DuckDuckGo Instant Answer API (keyless) -----------------------------
async function searchDuckDuckGo(query) {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    no_html: '1',
    skip_disambig: '1',
  });
  const data = await fetch(`https://api.duckduckgo.com/?${params}`, {
    signal: AbortSignal.timeout(WEB_SEARCH_TIMEOUT_MS),
  }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
  const results = [];

  const push = (text, url) => {
    const clean = stripHtml(text);
    if (clean && url && results.length < 4) {
      results.push({
        title: clean.slice(0, 80),
        snippet: clean.slice(0, 260),
        url: url,
        source: domainOf(url) || 'duckduckgo.com',
      });
    }
  };

  if (data.Abstract && data.AbstractURL) {
    push(data.Abstract, data.AbstractURL);
  }
  if (data.Answer) {
    push(data.Answer, data.AbstractURL || `https://duckduckgo.com/?q=${encodeURIComponent(query)}`);
  }
  if (Array.isArray(data.RelatedTopics)) {
    for (const topic of data.RelatedTopics) {
      if (topic.Text && topic.FirstURL) {
        push(topic.Text, topic.FirstURL);
      }
    }
  }
  return results.length > 0 ? results : null;
}

async function getWebSearchAnswer(question, language = 'tr') {
  const keywords = extractKeywords(question, language);
  if (!keywords) return null;

  // Try Wikipedia first, then DuckDuckGo
  let results = await searchWikipedia(keywords, language);
  if (!results) {
    results = await searchDuckDuckGo(keywords);
  }
  if (!results) return null;

  return {
    answer: buildSearchAnswerText(results, language),
    provider: 'web-search',
    sources: results.slice(0, 3).map((r) => ({ title: r.title, url: r.url, source: r.source })),
  };
}

async function test() {
  const tests = [
    { q: 'abdest nasil alinir', lang: 'tr' },
    { q: 'how to pray in islam', lang: 'en' },
    { q: 'oruc ne zaman açılır', lang: 'tr' },
    { q: 'what is zakat', lang: 'en' },
    { q: 'namaz nasıl kılınır', lang: 'tr' },
    { q: 'islam nedir', lang: 'tr' },
    { q: 'what is ramadan', lang: 'en' },
    { q: 'gusül abdesti', lang: 'tr' },
  ];

  let passed = 0;
  let failed = 0;

  for (const t of tests) {
    const start = Date.now();
    try {
      const result = await getWebSearchAnswer(t.q, t.lang);
      const elapsed = Date.now() - start;
      console.log(`\n=== "${t.q}" (${t.lang}) === ${elapsed}ms`);
      if (result) {
        console.log('Provider:', result.provider);
        console.log('Sources:', result.sources.length);
        console.log('Answer preview:', result.answer.slice(0, 200) + '...');
        passed++;
      } else {
        console.log('No result');
        failed++;
      }
    } catch (error) {
      console.error(`\n=== "${t.q}" (${t.lang}) === ERROR`);
      console.error('Error:', error.message);
      failed++;
    }
  }

  console.log(`\n\n=== TEST SUMMARY ===`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total: ${tests.length}`);
}

test().catch((e) => console.error('Fatal error:', e.message));
