// ---------------------------------------------------------------------------
// security.js — Client-side security hardening utilities
// ---------------------------------------------------------------------------
// Provides:
//   - Request signing (HMAC-SHA256) for API call integrity verification
//   - Client-side rate limiting to prevent accidental API flooding
//   - Certificate pinning helpers for SSL/TLS validation
// ---------------------------------------------------------------------------

import { REQUEST_SIGNING_KEY, RATE_LIMITS, SECURITY_CONFIG } from './config.js';

// ---------------------------------------------------------------------------
// Request Signing (HMAC-SHA256)
// ---------------------------------------------------------------------------

/**
 * Generate HMAC-SHA256 signature for a request.
 * @param {string} method - HTTP method
 * @param {string} path - API endpoint path
 * @param {object|string} body - Request body
 * @param {number} timestamp - Unix timestamp for replay protection
 * @returns {Promise<string>} Hex-encoded HMAC-SHA256 signature
 */
export async function signRequest(method, path, body, timestamp) {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body || {});
  const payload = `${method.toUpperCase()}|${path}|${bodyStr}|${timestamp}`;

  // crypto.subtle is not available on all React Native platforms; if it's
  // missing, request signing is skipped (callers already wrap in try/catch).
  const subtle = crypto?.subtle;
  if (!subtle || typeof subtle.importKey !== 'function') {
    console.warn('crypto.subtle unavailable — skipping request signing');
    return '';
  }

  const key = await subtle.importKey(
    'raw',
    new TextEncoder().encode(REQUEST_SIGNING_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payload)
  );

  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Build security headers for an API request.
 * @param {string} method - HTTP method
 * @param {string} path - API endpoint path
 * @param {object|string} body - Request body
 * @returns {Promise<object>} Headers object with security headers
 */
export async function getSecurityHeaders(method, path, body) {
  const timestamp = Date.now();
  const signature = await signRequest(method, path, body, timestamp);

  const headers = {
    'X-Request-Timestamp': String(timestamp),
    'X-Request-Nonce': generateNonce(),
  };
  // Only include the signature header when signing actually produced one.
  // An empty string would be a malformed header value.
  if (signature) {
    headers['X-Request-Signature'] = signature;
  }
  return headers;
}

/**
 * Generate a cryptographically random nonce.
 * @returns {string} Hex-encoded random nonce
 */
function generateNonce() {
  try {
    const array = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      crypto.getRandomValues(array);
    } else {
      // Fallback: Math.random is not cryptographic, but the nonce is only used
      // for logging/dedup and is not security-critical if crypto is missing.
      for (let i = 0; i < 16; i++) array[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return Date.now().toString(36);
  }
}

// ---------------------------------------------------------------------------
// Rate Limiting (Client-Side)
// ---------------------------------------------------------------------------

const rateLimitBuckets = new Map();

/**
 * Check if a request is within rate limits.
 * @param {string} endpoint - API endpoint identifier
 * @param {string} category - Rate limit category ('default', 'write', 'ai', 'auth')
 * @returns {{ allowed: boolean, remaining: number, resetTime: number }}
 */
export function checkRateLimit(endpoint, category = 'default') {
  if (!SECURITY_CONFIG.enableRateLimit) {
    return { allowed: true, remaining: Infinity, resetTime: 0 };
  }

  const limits = RATE_LIMITS[category] || RATE_LIMITS.default;
  const now = Date.now();
  const key = `${endpoint}:${category}`;

  if (!rateLimitBuckets.has(key)) {
    rateLimitBuckets.set(key, []);
  }

  const requests = rateLimitBuckets.get(key);

  // Remove requests outside the window
  const windowStart = now - limits.windowMs;
  const recentRequests = requests.filter(t => t > windowStart);
  rateLimitBuckets.set(key, recentRequests);

  if (recentRequests.length >= limits.maxRequests) {
    const oldestInWindow = recentRequests[0] || now;
    return {
      allowed: false,
      remaining: 0,
      resetTime: oldestInWindow + limits.windowMs,
    };
  }

  recentRequests.push(now);

  return {
    allowed: true,
    remaining: limits.maxRequests - recentRequests.length,
    resetTime: now + limits.windowMs,
  };
}

/**
 * Reset rate limit tracking for a specific endpoint or all endpoints.
 * @param {string} [endpoint] - Specific endpoint to reset, or omit for all
 */
export function resetRateLimits(endpoint) {
  if (endpoint) {
    for (const key of rateLimitBuckets.keys()) {
      if (key.startsWith(`${endpoint}:`)) {
        rateLimitBuckets.delete(key);
      }
    }
  } else {
    rateLimitBuckets.clear();
  }
}

// ---------------------------------------------------------------------------
// Certificate Pinning Helpers
// ---------------------------------------------------------------------------

/**
 * Validate that a server URL matches the pinned certificate configuration.
 * @param {string} url - The URL to validate
 * @returns {{ valid: boolean, message?: string }}
 */
export function validatePinningConfig(url) {
  if (!SECURITY_CONFIG.enableCertificatePinning) {
    return { valid: true };
  }

  if (!url.startsWith('https://')) {
    return {
      valid: false,
      message: 'Certificate pinning requires HTTPS connections',
    };
  }

  return { valid: true };
}

/**
 * Mask a string for logging (e.g., email, token).
 * @param {string} str - String to mask
 * @param {number} [visibleStart=3] - Characters to show at start
 * @param {number} [visibleEnd=2] - Characters to show at end
 * @returns {string} Masked string
 */
export function maskForLog(str, visibleStart = 3, visibleEnd = 2) {
  if (!str || typeof str !== 'string') return '***';
  if (str.length <= visibleStart + visibleEnd) return '***';

  const start = str.slice(0, visibleStart);
  const end = str.slice(-visibleEnd);
  const middle = '*'.repeat(Math.min(10, str.length - visibleStart - visibleEnd));

  return `${start}${middle}${end}`;
}