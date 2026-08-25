/**
 * Prayer times provider for the backend.
 *
 * Primary source: AlAdhan (https://aladhan.com/prayer-times-api) — a free,
 * key-less API whose method 13 implements the official Diyanet İşleri
 * Başkanlığı convention used in Turkey. It works worldwide, so users outside
 * Turkey get the same trusted criteria.
 *
 * Responses are cached per (rounded coordinates, timezone, method, date) so
 * repeated app refreshes never hammer the upstream API.
 */

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const CACHE_MAX = 500;

// App method keys -> AlAdhan "method" ids.
// 13 = Diyanat İşleri (Diyanet), 3 = MWL, 2 = ISNA, 5 = Egyptian,
// 4 = Umm al-Qura, 1 = Karachi.
const METHOD_IDS = {
  diyanet: 13,
  mwl: 3,
  isna: 2,
  egypt: 5,
  makkah: 4,
  karachi: 1,
};

const cache = new Map(); // key -> { at, payload }

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.payload;
}

function cacheSet(key, payload) {
  if (cache.size >= CACHE_MAX) {
    // Drop the oldest entry (Map preserves insertion order).
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, { at: Date.now(), payload });
}

/** "HH:MM (+03)" / "HH:MM" -> minutes since midnight. */
function toMinutes(raw) {
  const match = String(raw || '').match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

async function fetchWithTimeout(url, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    // A descriptive UA avoids Cloudflare-style blocks of bare client UAs.
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'islami-ogreniyorum-server/1.0 (prayer-times proxy)',
        Accept: 'application/json',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch prayer times for a coordinate/day.
 *
 * @param {object} p
 * @param {number} p.lat - latitude
 * @param {number} p.lng - longitude
 * @param {number} [p.tz] - device UTC offset in hours (keeps display aligned)
 * @param {string} [p.method='diyanet'] - one of METHOD_IDS keys
 * @param {Date}   [p.date=new Date()]
 * @returns {Promise<{source:string, method:string, timings:object}>}
 */
async function getPrayerTimes({ lat, lng, tz, method = 'diyanet', date = new Date() }) {
  const aladhanMethod = METHOD_IDS[method] ?? METHOD_IDS.diyanet;

  // Round coordinates to ~1 km so nearby devices share cache entries.
  const rLat = Number(Number(lat).toFixed(2));
  const rLng = Number(Number(lng).toFixed(2));

  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();

  // NOTE: no timezonestring param — AlAdhan resolves the timezone from the
  // coordinates itself (UTC-offset strings like "UTC+03:00" are rejected with
  // a misleading 400). For users physically at the coordinates this matches
  // their device clock anyway.
  const url =
    `https://api.aladhan.com/v1/timings/${dd}-${mm}-${yyyy}` +
    `?latitude=${rLat}&longitude=${rLng}&method=${aladhanMethod}`;

  const tzNum = typeof tz === 'number' && !Number.isNaN(tz) ? tz : -(new Date().getTimezoneOffset() / 60);
  const key = `${rLat},${rLng},${tzNum},${aladhanMethod},${dd}-${mm}-${yyyy}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new Error(`AlAdhan HTTP ${res.status}`);
  }
  const body = await res.json();
  if (!body || body.code !== 200 || !body.data || !body.data.timings) {
    throw new Error('AlAdhan response missing timings');
  }

  const t = body.data.timings;
  const timings = {
    fajr: toMinutes(t.Fajr),
    sunrise: toMinutes(t.Sunrise),
    dhuhr: toMinutes(t.Dhuhr),
    asr: toMinutes(t.Asr),
    maghrib: toMinutes(t.Maghrib),
    isha: toMinutes(t.Isha),
  };
  for (const [k, v] of Object.entries(timings)) {
    if (v === null) throw new Error(`AlAdhan timing unreadable: ${k}`);
  }

  const payload = {
    source: 'diyanet-online',
    upstreamMethodId: aladhanMethod,
    method,
    timings,
  };
  cacheSet(key, payload);
  return payload;
}

module.exports = { getPrayerTimes };
