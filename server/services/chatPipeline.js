// ---------------------------------------------------------------------------
// chatPipeline.js — Search Augmentation + Groq LLM Synthesis Pipeline
// ---------------------------------------------------------------------------
// Orchestrates the answer pipeline:
//   1. Use Serper.dev (Google search results, free 2,500 credits/month) to
//      retrieve real, citable web results.
//   2. Feed those results into Groq (Qwen/Llama family) to synthesize a
//      concise, well-sourced answer.
//
// Quota resilience (no 500s):
//   When Serper search is unavailable (monthly quota exhausted, no
//   SERPER_API_KEY, or zero results), the query is sent DIRECTLY to Groq
//   WITHOUT search context. The system prompt instructs the model to state
//   that external web details were limited in that case.
//
// Fallback when NO Groq key is configured:
//   - search results present -> plain-text snippet summary (provider serper)
//   - search unavailable     -> "no relevant sources found" (provider none)
// ---------------------------------------------------------------------------
import { searchSerper, getQuotaStatus } from './serperService.js';
import { getGroqChatCompletion } from './groqService.js';

// --- Config ------------------------------------------------------------------

const GROQ_API_KEY = (process.env.GROQ_API_KEY || '').trim();
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 15000);

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

// --- LLM synthesis ---------------------------------------------------------

async function callGroq(system, prompt) {
  if (!GROQ_API_KEY) {
    return null;
  }
  try {
    const messages = [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ];
    return await getGroqChatCompletion(messages);
  } catch (error) {
    console.error('[chatPipeline] Groq error:', error.message);
    return null;
  }
}

async function callLLM({ system, prompt }) {
  return callGroq(system, prompt);
}

// --- Search context formatting ----------------------------------------------

function formatSearchContext(results, language) {
  if (!results || results.length === 0) {
    return language === 'tr'
      ? 'Aramada uygun sonuç bulunamadı.'
      : 'No relevant search results found.';
  }
  return results
    .map((r, i) => '[Kaynak ' + (i + 1) + ']: ' + r.title + '\n' + r.snippet + '\n' + r.link)
    .join('\n\n');
}

function buildSnippetAnswer(results, language) {
  const tr = language === 'tr';
  const header = tr
    ? 'İnternetteki güvenilir kaynaklardan derlenen bilgi:'
    : 'Information gathered from trusted sources on the web:';
  const lines = [header, ''];
  for (const r of results.slice(0, 3)) {
    const snippet = stripHtml(r.snippet || '').slice(0, 300);
    lines.push('- **' + r.title + '**: ' + snippet + ' [' + r.link + ']');
  }
  return lines.join('\n');
}


// --- System prompts ---------------------------------------------------------

const SYSTEM_PROMPTS = {
  tr: [
    'Sen "İslamı öğreniyorum" (İslam nasıl öğrenilir) adlı bir mobil uygulamanın bilgili, dikkatli İslam asistanısın.',
    'Kullanıcının sorusuna, aşağıda verdiğin arama sonucu bağlamını kullanarak Türkçe cevap ver.',
    'Sağlanan arama snippet\'lerini sentezleyerek soruyu doğru bir şekilde cevapla. Snippet\'ler yeterli bilgi içermiyorsa genel bilgini kullan, ancak dış web kaynaklarının sınırlı olduğunu açıkça belirt.',
    'Kurallar:',
    '- Kısa ve öz ol (en fazla ~180 kelime), sıcak ve saygılı bir ton kullan.',
    '- Cevaplarını Kur\'an, sahih hadis ve ana akademik anlayışa (örn. Diyanet İşleri Başkanlığı) dayandır.',
    '- Kişisel dinî hüküm (fetva) gerektiren sorularda genel rehberlik ver ve Diyanet\'e veya nitelikli bir âlime danışılmasını öner.',
    '- Tıbbi, hukuki veya mali önerilerde bulunma; nitelikli profesyonellere başvurmasını öner.',
    '- Emin olmadığın Kur\'an ayet numaralarını veya hadis referansını uydurma.',
    '- Cevaplarında kaynak linklerini aşağıda sunulan listeden kullan.',
  ].join('\n'),
  en: [
    'You are a knowledgeable, careful Islamic assistant inside a mobile app called "İslamı öğreniyorum" (How to Learn Islam).',
    'Answer the user\'s question using the search context provided below.',
    'Synthesize the provided search snippets to answer the user\'s question accurately. If the snippets do not contain enough information, rely on your general knowledge but state that external web details were limited.',
    'Rules:',
    '- Be concise (at most ~180 words), warm and respectful.',
    '- Base answers on the Quran, authentic Hadith and mainstream scholarly understanding (e.g. Diyanet İşleri Başkanlığı).',
    '- If the question needs a personal religious ruling (fatwa), give general guidance and kindly recommend consulting Diyanet or a qualified scholar.',
    '- Never give medical, legal or financial directives; suggest qualified professionals instead.',
    '- Do not invent Quran verse numbers or hadith references you are not sure about.',
    '- Cite the sources from the provided list when making factual claims.',
  ].join('\n'),
};

// --- Public API --------------------------------------------------------------

/**
 * Handle a search-augmented chat query.
 *
 * @param {string} userQuery - the user's question
 * @param {'tr'|'en'} language
 * @returns {Promise<{reply: string, sources: Array<{title:string,url:string}>, provider: string}>}
 */
export async function handleSearchAugmentedChat(userQuery, language = 'en') {
  // Stage 1: Search
  const searchResults = await searchSerper(userQuery, language);
  const context = formatSearchContext(searchResults, language);

  // Stage 2: Synthesize — Groq with search context; else direct Groq (quota fallback)
  let reply, provider, sources;

  if (searchResults.length > 0) {
    const sourcesList = searchResults.slice(0, 3).map((r) => ({
      title: r.title,
      url: r.link,
    }));

    if (GROQ_API_KEY) {
      const systemPrompt = SYSTEM_PROMPTS[language] || SYSTEM_PROMPTS.en;
      const userPrompt = 'Search Context:\n' + context + '\n\nUser Question: ' + userQuery;
      const llmReply = await callLLM({
        system: systemPrompt,
        prompt: userPrompt,
      });
      if (llmReply) {
        reply = llmReply;
        provider = 'groq';
        sources = sourcesList;
      }
    }

    if (!reply) {
      // Fallback: plain-text snippet summary (no LLM)
      reply = buildSnippetAnswer(searchResults, language);
      provider = 'serper';
      sources = sourcesList;
    }
  } else if (GROQ_API_KEY) {
    // Serper search unavailable (monthly quota exhausted / unconfigured / no
    // results): send the query DIRECTLY to Groq WITHOUT search context instead
    // of returning an error. The system prompt tells the model to note that
    // external web details were limited.
    const systemPrompt = SYSTEM_PROMPTS[language] || SYSTEM_PROMPTS.en;
    const llmReply = await callLLM({
      system: systemPrompt,
      prompt: 'User Question: ' + userQuery +
        '\n\n(Search context is unavailable right now — external web details may be limited.)',
    });
    if (llmReply) {
      reply = llmReply;
      provider = 'groq';
      sources = [];
    } else {
      reply = language === 'tr'
        ? 'Şu anda yanıt üretilemiyor. Lütfen daha sonra tekrar deneyin.'
        : 'I could not generate an answer right now. Please try again shortly.';
      provider = 'none';
      sources = [];
    }
  } else {
    reply = language === 'tr'
      ? 'Aramanıza uygun kaynak bulunamadı. Lütfen sorunuzu daha genel ifadeyle yeniden deneyin.'
      : 'No relevant sources found for your question. Please try a broader phrasing.';
    provider = 'none';
    sources = [];
  }

  return { reply, sources, provider };
}

/** Expose quota status for monitoring. */
export { getQuotaStatus };