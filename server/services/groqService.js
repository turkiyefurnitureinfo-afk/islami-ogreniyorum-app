// ---------------------------------------------------------------------------
// groqService.js — Groq LLM chat completions (OpenAI-compatible API)
// ---------------------------------------------------------------------------
// Groq serves OpenAI-compatible chat completions at:
//   https://api.groq.com/openai/v1
//
// We call it with plain fetch (not the "openai" npm SDK): the SDK v4 serializes
// a `timeout` field into the JSON body which Groq rejects with "400 property
// 'timeout' is unsupported". fetch gives us full control and needs no extra dep.
//
// SETUP (Render backend env vars):
//   GROQ_API_KEY=gsk_YourActualGroqKeyHere
//   GROQ_MODEL=model-id        # e.g. qwen/qwen3.8-27b (see below)
//
// The default model is account-dependent — list yours with:
//   GET https://api.groq.com/openai/v1/models  (Authorization: Bearer $GROQ_API_KEY)
// Good general chat models that are commonly available:
//   qwen/qwen3.8-27b            Strong multilingual reasoning (TR + EN); solid default
//   groq/compound-mini          Fast small compound model
//   groq/compound               Bigger compound model
//   openai/gpt-oss-20b          OpenAI open-weights, fast
//   openai/gpt-oss-120b         OpenAI open-weights, high quality
//   allam-2-7b                  Arabic-focused model
// ---------------------------------------------------------------------------

const GROQ_API_KEY = (process.env.GROQ_API_KEY || '').trim();
const GROQ_BASE_URL = (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').trim();
const DEFAULT_MODEL = (process.env.GROQ_MODEL || 'qwen/qwen3.8-27b').trim();
const TIMEOUT_MS = Number(process.env.GROQ_TIMEOUT_MS || 15000);

/**
 * Send a message array to Groq and return the text response.
 * @param {Array<{role: string, content: string}>} messages
 * @returns {Promise<string>}
 */
export async function getGroqChatCompletion(messages) {
  if (!GROQ_API_KEY) {
    throw new Error('[GroqService] Missing GROQ_API_KEY environment variable.');
  }

  if (!Array.isArray(messages)) {
    throw new Error('[GroqService] messages must be an array.');
  }

  const safeMessages = messages
    .filter((m) => m && typeof m?.content === 'string')
    .slice(0, 20)
    .map((m) => ({ role: m.role === 'system' || m.role === 'assistant' ? m.role : 'user', content: String(m.content).slice(0, 4000) }))
    .filter((m) => m && m.content.length > 0);

  if (safeMessages.length === 0) {
    throw new Error('[GroqService] No valid messages to send.');
  }

  let controller;
  let timer = null;

  try {
    try {
      controller = new AbortController();
      timer = setTimeout(() => {
        try { controller.abort(); } catch {}
      }, TIMEOUT_MS);
    } catch {
      controller = undefined;
    }

    const res = await fetch(GROQ_BASE_URL + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + GROQ_API_KEY,
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: safeMessages,
        temperature: 0.6,
        max_tokens: 1024,
      }),
      ...(controller ? { signal: controller.signal } : {}),
    });

    if (timer) clearTimeout(timer);

    let data = {};
    try {
      data = await res.json();
    } catch {
      const statusText = res.statusText || '';
      throw new Error(`[GroqService] HTTP ${res.status}${statusText ? ': ' + statusText : ''}`);
    }

    if (!res.ok) {
      const errorMsg = data?.error?.message || res.statusText || `[HTTP ${res.status}]`;
      throw new Error(`[GroqService] HTTP ${res.status}: ${errorMsg}`);
    }

    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('[GroqService] Empty response from Groq.');
    }

    return content;
  } catch (error) {
    if (timer) {
      try { clearTimeout(timer); } catch {}
    }

    const message = error instanceof Error ? error.message : String(error);

    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      throw new Error(`[GroqService] Request timed out after ${TIMEOUT_MS} ms.`);
    }

    if (message.startsWith('[GroqService]')) {
      throw error instanceof Error ? error : new Error(message);
    }

    throw new Error(`[GroqService] Failed to get Groq completion: ${message}`);
  }
}
