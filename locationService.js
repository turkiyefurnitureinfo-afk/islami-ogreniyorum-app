import * as Location from 'expo-location';
import { CITIES } from './data.js';

// Great-circle distance in km between two coordinates (haversine formula).
function distanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Nearest known preset city to a coordinate (friendly fallback label). */
export function nearestCity(lat, lng) {
  let bestKey = null;
  let bestDist = Infinity;
  for (const [key, c] of Object.entries(CITIES)) {
    const d = distanceKm(lat, lng, c.lat, c.lng);
    if (d < bestDist) {
      bestDist = d;
      bestKey = key;
    }
  }
  return { key: bestKey, ...CITIES[bestKey], distanceKm: Math.round(bestDist) };
}

/**
 * Reverse-geocode coordinates into a real, world-wide place name so prayer
 * times are attributed to the user's ACTUAL location (not just the 8 preset
 * cities). Works anywhere on Earth.
 *
 * Returns e.g. "Jakarta, Indonesia" or "Toronto, Canada". Falls back to the
 * nearest preset city when geocoding is unavailable, then to a generic label.
 */
async function reverseGeocodeName(lat, lng) {
  try {
    if (typeof Location.reverseGeocodeAsync === 'function') {
      const results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      if (results && results.length > 0) {
        const r = results[0];
        const parts = [r.city || r.district || r.subregion, r.region || r.subregion, r.country]
          .filter((p) => p && p.trim());
        if (parts.length > 0) return parts.slice(0, 2).join(', ');
      }
    }
  } catch (e) {
    // Reverse geocoding unavailable on this device/platform — fall through.
  }
  const near = nearestCity(lat, lng);
  // Only trust the preset-city name if the user is actually near one of them;
  // otherwise show a generic but honest label.
  if (near.distanceKm <= 200) return near.name;
  return null;
}

async function buildLocation() {
  const pos = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  // Prayer times are displayed in device time, so use the device's UTC offset.
  const tz = -(new Date().getTimezoneOffset() / 60);
  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;
  const near = nearestCity(lat, lng);
  const placeName = await reverseGeocodeName(lat, lng);
  return {
    lat,
    lng,
    tz,
    // Real city name when we can geocode it; preset-city label as fallback;
    // last resort generic "Current Location".
    name: placeName || near.name,
    cityKey: (placeName ? null : near.key),
    distanceKm: near.distanceKm,
  };
}

/**
 * Ask the user for permission and return their GPS location.
 * @returns {Promise<{lat:number,lng:number,tz:number,name:string,cityKey:string,distanceKm:number}>}
 * @throws Error with code 'PERMISSION_DENIED' when permission is refused.
 */
export async function detectLocation() {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    const err = new Error('PERMISSION_DENIED');
    err.code = 'PERMISSION_DENIED';
    throw err;
  }
  return buildLocation();
}

/**
 * Silent refresh: returns a GPS fix only when permission was granted
 * previously (never shows a prompt). Returns null otherwise.
 */
export async function silentLocationRefresh() {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    return await buildLocation();
  } catch (e) {
    return null;
  }
}

/**
 * Auto-detect the user's location on startup so prayer times automatically
 * match wherever they are in the world.
 *
 * Unlike `detectLocation()`, this NEVER throws: it asks for permission if
 * needed, and returns `{ location, denied }` so the UI can decide whether to
 * show the manual-detection button. `denied` is true when the user refused
 * (or location is otherwise unavailable).
 *
 * @returns {Promise<{ location: object|null, denied: boolean }>}
 */
export async function autoDetectLocation() {
  let status = 'undetermined';
  try {
    status = (await Location.getForegroundPermissionsAsync()).status;
  } catch (e) {
    /* ignore */
  }

  if (status !== 'granted' && status !== 'undetermined') {
    return { location: null, denied: true };
  }

  // Request permission (prompts the user the first time only).
  try {
    const { status: askedStatus } = await Location.requestForegroundPermissionsAsync();
    if (askedStatus !== 'granted') {
      return { location: null, denied: true };
    }
  } catch (e) {
    return { location: null, denied: true };
  }

  try {
    const location = await buildLocation();
    return { location, denied: false };
  } catch (e) {
    return { location: null, denied: false };
  }
}