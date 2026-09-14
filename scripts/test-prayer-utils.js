/**
 * Prayer-time utility regression tests (pure logic, no React Native).
 *
 * Covers the utils used by the Prayer tab render path — the tab that crashed
 * for every new user at welcome-screen completion:
 *   - sanitizeTimings: server payload validation (numbers / "HH:MM" strings /
 *     garbage -> null) so a malformed backend response can never poison `times`
 *   - computeTimes: returns null (not an object) on invalid input — callers
 *     must survive that
 *   - fmt: placeholder for non-finite input
 *   - nextPrayer selection algorithm (mirrors App.js) incl. numeric-only
 *     handling and the past-Isha rollover
 *
 * Usage: node scripts/test-prayer-utils.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0;
let failed = 0;
const ok = (name, cond) => {
  if (cond) { passed++; console.log('  ok - ' + name); }
  else { failed++; console.log('  FAIL - ' + name); }
};

(async () => {
  // utils.js is an ES module without any React Native dependency — load it
  // through a temporary .mjs copy so plain Node can import it.
  const tmp = path.join(os.tmpdir(), 'prayer-utils-' + Date.now() + '.mjs');
  fs.copyFileSync(path.join(__dirname, '..', 'utils.js'), tmp);
  const U = await import('file://' + tmp.replace(/\\/g, '/'));

  console.log('sanitizeTimings');
  ok('accepts numeric minutes map',
    JSON.stringify(U.sanitizeTimings({ fajr: 300, sunrise: 360, dhuhr: 740, asr: 1060, maghrib: 1210, isha: 1325 })) !== 'null');
  ok('accepts raw AlAdhan "HH:MM (TRT)" strings',
    U.sanitizeTimings({ fajr: '05:34 (EET)', sunrise: '07:02', dhuhr: '12:20', asr: '15:40', maghrib: '18:05', isha: '19:30' }).fajr === 334);
  ok('rejects missing key', U.sanitizeTimings({ fajr: 300, sunrise: 360, dhuhr: 740, asr: 1060, maghrib: 1210 }) === null);
  ok('rejects non-numeric garbage', U.sanitizeTimings({ fajr: 'x', sunrise: 360, dhuhr: 740, asr: 1060, maghrib: 1210, isha: 1325 }) === null);
  ok('rejects null/undefined/non-object', U.sanitizeTimings(null) === null && U.sanitizeTimings('n/a') === null && U.sanitizeTimings([1, 2]) === null);
  ok('rejects out-of-range minutes (>=1440 / negative)',
    U.sanitizeTimings({ fajr: 1500, sunrise: 360, dhuhr: 740, asr: 1060, maghrib: 1210, isha: 1325 }) === null &&
    U.sanitizeTimings({ fajr: -5, sunrise: 360, dhuhr: 740, asr: 1060, maghrib: 1210, isha: 1325 }) === null);
  ok('rejects NaN values', U.sanitizeTimings({ fajr: NaN, sunrise: 360, dhuhr: 740, asr: 1060, maghrib: 1210, isha: 1325 }) === null);
  ok('never throws on weird input', U.sanitizeTimings({ fajr: {} }) === null);

  console.log('computeTimes');
  ok('valid Istanbul input returns all six prayers',
    Object.keys(U.computeTimes(new Date(), 41.0082, 28.9784, 3, 'diyanet') || {}).length === 6);
  ok('invalid latitude -> null (callers must not index into null)',
    U.computeTimes(new Date(), undefined, 28.9784, 3, 'diyanet') === null);
  ok('invalid date -> null', U.computeTimes('not-a-date', 41.0082, 28.9784, 3, 'diyanet') === null);
  ok('unknown method falls back to diyanet', (() => {
    const t = U.computeTimes(new Date(), 41.0082, 28.9784, 3, 'does-not-exist');
    return !!t && Number.isFinite(t.fajr);
  })());

  console.log('fmt');
  ok('formats minutes as HH:MM', U.fmt(605) === '10:05');
  ok('non-finite -> placeholder (never "NaN")', U.fmt(NaN) === '--:--' && U.fmt(undefined) === '--:--');
  ok('wraps minutes >= 1440', U.fmt(1440 + 605) === '10:05');

  console.log('nextPrayer selection (mirrors App.js algorithm)');
  const pickNext = (src, nowMinutes) => {
    const order = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
    const safe = src && typeof src === 'object' ? src : {};
    for (const key of order) {
      const value = Number(safe[key]);
      if (Number.isFinite(value) && value > nowMinutes) return { key, time: value };
    }
    const fajr = Number(safe.fajr);
    return { key: 'fajr', time: (Number.isFinite(fajr) ? fajr : 0) + 1440 };
  };
  const T = { fajr: 300, sunrise: 360, dhuhr: 740, asr: 1060, maghrib: 1210, isha: 1325 };
  ok('picks the next upcoming prayer', pickNext(T, 700).key === 'dhuhr');
  ok('past Isha rolls over to tomorrow Fajr (+1440, numeric)',
    pickNext(T, 1400).key === 'fajr' && pickNext(T, 1400).time === 300 + 1440);
  ok('malformed times -> numeric fallback (no crash, no string concat)',
    pickNext(null, 700).key === 'fajr' && pickNext(null, 700).time === 1440);
  ok('string timings are coerced numerically (no "05:341440" bug)',
    (() => { const r = pickNext({ ...T, fajr: '05:00' }, 1400); return Number.isFinite(r.time); })());

  fs.unlinkSync(tmp);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('Test harness error:', e);
  process.exit(1);
});
