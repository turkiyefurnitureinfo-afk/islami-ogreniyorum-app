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

  try {
    const res = await fetch(GROQ_BASE_URL + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + GROQ_API_KEY,
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages,
        temperature: 0.6,
        max_tokens: 1024,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(
        '[GroqService] HTTP ' + res.status + ': ' + (data?.error?.message || res.statusText)
      );
    }

    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('[GroqService] Empty response from Groq.');
    }
    return content;
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      throw new Error('[GroqService] Request timed out after ' + TIMEOUT_MS + ' ms.');
    }
    if (error instanceof Error && error.message.includes('[GroqService]')) {
      throw error;
    }
    throw new Error('[GroqService] Failed to get Groq completion: ' + error.message);
  }
}
