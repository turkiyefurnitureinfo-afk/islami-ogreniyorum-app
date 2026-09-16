// ---------------------------------------------------------------------------
// Firebase Storage — hosts community post media (images / videos)
// ---------------------------------------------------------------------------
//
// WHY THIS EXISTS: the community feed stores only METADATA in Firestore
// (mediaType + mediaUri). It used to receive the author's device-local path
// (file:///data/.../ImagePicker/xxx.jpg) — a path that exists on no other
// device, so images/videos were broken for everyone except the author (and
// broke for the author too once Android cleared the cache).
//
// HOW IT WORKS NOW (server-backed upload): on-device Firebase Web-SDK
// (firebase/storage) does NOT run in React Native, which is why media was
// never actually uploaded and always fell back to a local path. Instead we
// POST the file to the backend (POST /api/upload), which stores it and returns
// a permanent public https:// URL. That URL is what gets stored in Firestore
// and rendered by every device.
// ---------------------------------------------------------------------------

import { API_URL } from './config.js';
import { getSecurityHeaders } from './security.js';

// Matches the server upload endpoint's per-type caps (see server/index.js):
// images <= 10 MB, videos <= 40 MB (≈60 s clip). Checking here avoids
// uploading a payload the server is guaranteed to reject with 413.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 40 * 1024 * 1024;

/**
 * Upload a picked image/video to the backend, which stores it and returns a
 * permanent public URL.
 *
 * @param {string} uri - local file URI (file://…) or data URI
 * @param {'image'|'video'} type - media kind (picks extension + MIME type)
 * @returns {Promise<string>} permanent public URL for the file
 * @throws {Error} when the upload fails (network / server error).
 */
export async function uploadCommunityMedia(uri, type) {
  if (!uri) throw new Error('No media URI provided');
  const isVideo = type === 'video';
  const extension = isVideo ? 'mp4' : 'jpg';

  console.log(
    '[upload] starting upload — uri=',
    uri.substring(0, 80),
    '| type=',
    type,
    '| ext=',
    extension
  );
  const dataUri = await fileToDataUri(uri, isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES);
  const uploadStart = Date.now();
  let httpStatus = null;
  let returnedUrl = null;
  try {
    const res = await fetch(`${API_URL}/api/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getSecurityHeaders('POST', '/api/upload', null)),
      },
      body: JSON.stringify({ data: dataUri, ext: extension }),
    });
    httpStatus = res.status;
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Upload failed (HTTP ${res.status})${errText ? ': ' + errText : ''}`);
    }
    const json = await res.json();
    returnedUrl = json.url;
  } catch (error) {
    console.warn(
      '[upload] FAILED — httpStatus=',
      httpStatus,
      '| returnedUrl=',
      returnedUrl || '(none)',
      '| error=',
      error?.message || error
    );
    throw error;
  }
  console.log(
    '[upload] SUCCESS — httpStatus=',
    httpStatus,
    '| returnedUrl=',
    returnedUrl,
    '| elapsed=',
    Date.now() - uploadStart,
    'ms'
  );

  if (!returnedUrl) throw new Error('Upload returned no URL');
  return returnedUrl.startsWith('http') ? returnedUrl : `${API_URL}${returnedUrl}`;
}

/**
 * Upload a profile picture to the backend and return a permanent public URL.
 *
 * @param {string} uri - local file URI (file://…) from the image picker.
 *   Already-remote http(s) URLs are returned unchanged (nothing to upload).
 * @returns {Promise<string>} permanent public URL for the picture
 * @throws {Error} when the upload fails (network / server error).
 */
export async function uploadProfileImage(uri) {
  if (!uri) throw new Error('No image URI provided');
  if (!/^file:/i.test(uri) && !uri.startsWith('/') && !/^data:/i.test(uri)) {
    // Already a remote URL (Google avatar or a previously uploaded picture).
    return uri;
  }

  const dataUri = await fileToDataUri(uri, MAX_IMAGE_BYTES);
  const { url } = await fetch(`${API_URL}/api/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await getSecurityHeaders('POST', '/api/upload', null)),
    },
    body: JSON.stringify({ data: dataUri, ext: 'jpg' }),
  }).then((res) => {
    if (!res.ok) throw new Error(`Upload failed (HTTP ${res.status})`);
    return res.json();
  });

  if (!url) throw new Error('Upload returned no URL');
  return url.startsWith('http') ? url : `${API_URL}${url}`;
}

/**
 * Validate that a media URL is a renderable remote URL (http/https).
 * Returns the URL if valid, or null if it's a local file:// path, empty,
 * or otherwise unusable — so renderers can fall back to initials/placeholders.
 * @param {string} [url]
 * @returns {string|null}
 */
export function validateMediaUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  // Only remote URLs are renderable across devices. Local file:// paths,
  // data: URIs (except tiny placeholders), and relative paths are NOT.
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return null;
}

/**
 * Convert a local file:// URI to a base64 data-URI string.
 * Handles both RN file:// paths and already-loaded data: URIs.
 * @param {string} uri
 * @returns {Promise<string>}
 */
async function fileToDataUri(uri, maxBytes = MAX_IMAGE_BYTES) {
  if (/^data:/i.test(uri)) return uri;
  // React Native's fetch can read local file:// URIs.
  const response = await fetch(uri);
  const blob = await response.blob();
  if (blob && blob.size > maxBytes) {
    const limitMb = Math.round(maxBytes / (1024 * 1024));
    throw new Error(
      `Media is ${(blob.size / (1024 * 1024)).toFixed(1)} MB — the limit is ${limitMb} MB.`
    );
  }
  // RN Blob has no.arrayBuffer() in some versions; use a FileReader instead.
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Read failed'));
    reader.readAsDataURL(blob);
  });
}
