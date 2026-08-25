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
 * Compute prayer times for a given date/location.
 * Times are returned as minutes since local midnight (0..1440).
 *
 * @param {Date} now - the current date/time
 * @param {number} latitude - location latitude in degrees
 * @param {number} longitude - location longitude in degrees
 * @param {number} tz - timezone offset from UTC in hours
 * @returns {{fajr:number, sunrise:number, dhuhr:number, asr:number, maghrib:number, isha:number}}
 */
export function computeTimes(now, latitude, longitude, tz) {
  const startOfYear = new Date(Date.UTC(now.getUTCFullYear(), 0, 0));
  const dayOfYear = Math.floor((now - startOfYear) / 86400000);

  const decl = sunDeclination(dayOfYear);
  const eot = equationOfTime(dayOfYear);

  // Solar noon in minutes relative to the local standard-time midnight
  const solarNoon = 720 - 4 * longitude + eot + tz * 60;

  // Standard angular values used by the Diyanet-style calculation
  const fajrAngle = 18;
  const ishaAngle = 17;
  const twilightAngle = 0.833; // accounts for atmospheric refraction

  const hFajr = hourAngle(latitude, decl, -fajrAngle);
  const hSunrise = hourAngle(latitude, decl, -twilightAngle);
  const hIsha = hourAngle(latitude, decl, -ishaAngle);

  // Asr (Shafi'i): when shadow length = object length + noon shadow.
  // tan(altitude) = 1 / (1 + tan(|lat - decl|))
  const asrAltitude = radToDeg(
    Math.atan(1 / (1 + Math.tan(degToRad(Math.abs(latitude - decl)))))
  );
  const hAsr = hourAngle(latitude, decl, asrAltitude);

  return {
    fajr: normalizeMinutes(solarNoon - hFajr * 4),
    sunrise: normalizeMinutes(solarNoon - hSunrise * 4),
    dhuhr: normalizeMinutes(solarNoon),
    asr: normalizeMinutes(solarNoon + hAsr * 4),
    maghrib: normalizeMinutes(solarNoon + hSunrise * 4),
    isha: normalizeMinutes(solarNoon + hIsha * 4),
  };
}

/**
 * Format minutes since midnight as "HH:MM".
 * @param {number} minutes - minutes since local midnight (may be a float)
 */
export function fmt(minutes) {
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
  const h = date.getHours();
  const min = date.getMinutes();
  const s = date.getSeconds();
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}