// Prayer time calculation utilities for İslamı öğreniyorum
// Uses standard astronomical calculations for prayer times

// Convert degrees to radians
const degToRad = (deg) => (deg * Math.PI) / 180;
// Convert radians to degrees
const radToDeg = (rad) => (rad * 180) / Math.PI;

// The sun's declination for the given day of the year (1..365/366)
function sunDeclination(dayOfYear) {
  return -23.44 * Math.cos(degToRad((360 / 365) * (dayOfYear + 10)));
}

// Equation of time in minutes (apparent solar time minus mean solar time)
function equationOfTime(dayOfYear) {
  const b = degToRad((360 / 365) * (dayOfYear - 81));
  return 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
}

// Hour angle (in degrees) when the sun reaches the given altitude
// altitude: sun's altitude in degrees (negative values mean below horizon)
function hourAngle(latitudeDeg, declinationDeg, altitudeDeg) {
  const numerator =
    Math.sin(degToRad(altitudeDeg)) -
    Math.sin(degToRad(latitudeDeg)) * Math.sin(degToRad(declinationDeg));
  const denominator =
    Math.cos(degToRad(latitudeDeg)) * Math.cos(degToRad(declinationDeg));
  const cosH = Math.max(-1, Math.min(1, numerator / denominator));
  return radToDeg(Math.acos(cosH));
}

// Normalize minutes since midnight to [0, 1440)
function normalizeMinutes(minutes) {
  return ((minutes % 1440) + 1440) % 1440;
}

/**
 * fetchJsonWithRetry — resilient JSON fetch for the sleeping Render free-tier
 * backend. Retries network failures/timeouts with backoff so the first cold
 * start of the server does not leave users on stale fallback data.
 *
 * @param {string} url absolute URL to fetch
 * @param {object} [options] standard fetch options (method, headers, body...)
 * @param {number} [retries=2] number of RETRIES after the first attempt
 * @param {number} [timeoutMs=45000] per-attempt timeout
 * @returns {Promise<any>} parsed JSON
 */
export async function fetchJsonWithRetry(url, options = {}, retries = 2, timeoutMs = 45000) {
  let lastError;
  /** Build an abort signal that always works (AbortSignal.timeout may be missing on older RN). */
  function buildSignal() {
    if (options.signal) return options.signal;
    try {
      if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        return AbortSignal.timeout(timeoutMs);
      }
    } catch { /* fall through */ }
    try {
      const controller = new AbortController();
      setTimeout(() => { try { controller.abort(); } catch {} }, timeoutMs);
      return controller.signal;
    } catch {
      return undefined;
    }
  }
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: buildSignal(),
      });
      if (!response.ok) {
        throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
      }
      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error('Failed to parse JSON response');
      }
      if (data == null) throw new Error('Unexpected empty JSON response');
      return data;
    } catch (error) {
      lastError = error;
      // Retry only transient problems (network/timeout); skip client errors.
      const statusMatch = /HTTP (\d+)/.exec(error.message || '');
      const status = statusMatch ? Number(statusMatch[1]) : 0;
      const retryable =
        !statusMatch ||
        status === 408 || status === 429 ||
        status >= 500;
      if (!retryable || attempt === retries) break;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw lastError;
}

export function computeTimes(now, latitude, longitude, tz, methodKey = 'diyanet') {
  try {
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) return null;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(tz)) return null;
    const startOfYear = new Date(now.getFullYear(), 0, 0);
    const dayOfYear = Math.floor((now.getTime() - startOfYear.getTime()) / 86400000);
    const decl = sunDeclination(dayOfYear);
    const eot = equationOfTime(dayOfYear);
    const solarNoon = 720 - 4 * longitude + eot + tz * 60;
    const METHODS = { diyanet: { fajr: 18, isha: 17 }, mwl: { fajr: 18, isha: 17 }, isna: { fajr: 15, isha: 15 }, egypt: { fajr: 19.5, isha: 17.5 }, makkah: { fajr: 18.5, ishaMinutesAfterMaghrib: 90 }, karachi: { fajr: 18, isha: 18 }, };
    const m = METHODS[methodKey] || METHODS.diyanet;
    const twilightAngle = 0.833;
    const hFajr = hourAngle(latitude, decl, -m.fajr);
    const hSunrise = hourAngle(latitude, decl, -twilightAngle);
    const hIsha = m.isha !== undefined ? hourAngle(latitude, decl, -m.isha) : null;
    const asrAltitude = radToDeg(Math.atan(1 / (1 + Math.tan(degToRad(Math.abs(latitude - decl))))));
    const hAsr = hourAngle(latitude, decl, asrAltitude);
    return { fajr: normalizeMinutes(solarNoon - hFajr * 4), sunrise: normalizeMinutes(solarNoon - hSunrise * 4), dhuhr: normalizeMinutes(solarNoon), asr: normalizeMinutes(solarNoon + hAsr * 4), maghrib: normalizeMinutes(solarNoon + hSunrise * 4), isha: m.ishaMinutesAfterMaghrib !== undefined ? normalizeMinutes(solarNoon + hSunrise * 4 + m.ishaMinutesAfterMaghrib) : normalizeMinutes(solarNoon + hIsha * 4), };
  } catch (error) { console.warn('[prayer] computeTimes failed:', error?.message || error); return null; }
}

/**
 * Human-readable relative time for feed items ("3 dk önce" / "3h ago").
 * @param {string|Date} then - ISO date string or Date
 * @param {'tr'|'en'} lang
 */
export function timeAgo(then, lang = 'tr') {
  try {
    const t = typeof then === 'string' ? new Date(then) : then;
    if (!t || Number.isNaN(t.getTime())) return lang === 'tr' ? 'şimdi' : 'just now';
    const s = Math.max(0, Math.floor((Date.now() - t.getTime()) / 1000));
    if (s < 60) return lang === 'tr' ? 'şimdi' : 'just now';
    const min = Math.floor(s / 60);
    if (min < 60) return lang === 'tr' ? `${min} dk önce` : `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return lang === 'tr' ? `${hr} sa önce` : `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (!Number.isFinite(day) || day < 0) return lang === 'tr' ? 'şimdi' : 'just now';
    return lang === 'tr' ? `${day} gün önce` : `${day}d ago`;
  } catch {
    return lang === 'tr' ? 'şimdi' : 'just now';
  }
}

/**
 * Format minutes since midnight as "HH:MM".
 * @param {number} minutes - minutes since local midnight (may be a float)
 */
export function fmt(minutes) {
  if (!Number.isFinite(minutes)) return '--:--';
  const m = normalizeMinutes(minutes);
  const h = Math.floor(m / 60);
  const min = Math.floor(m % 60);
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/**
 * Format a Date as a clock string "HH:MM:SS".
 * @param {Date} date
 */
export function formatClock(date) {
  try {
    if (!date || !(date instanceof Date) || Number.isNaN(date.getTime())) return '--:--:--';
    const h = date.getHours();
    const min = date.getMinutes();
    const s = date.getSeconds();
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  } catch {
    return '--:--:--';
  }
}