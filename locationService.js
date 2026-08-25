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

/** Nearest known city to a coordinate (used for a friendly label). */
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

async function buildLocation() {
  const pos = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  // Prayer times are displayed in device time, so use the device's UTC offset.
  const tz = -(new Date().getTimezoneOffset() / 60);
  const near = nearestCity(pos.coords.latitude, pos.coords.longitude);
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    tz,
    name: near.name,
    cityKey: near.key,
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