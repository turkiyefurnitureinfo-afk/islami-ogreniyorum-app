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

// Matches the 50 MB limit enforced by the server upload endpoint.
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

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

  const dataUri = await fileToDataUri(uri);
  const { url } = await fetch(`${API_URL}/api/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await getSecurityHeaders('POST', '/api/upload', null)),
    },
    body: JSON.stringify({ data: dataUri, ext: extension }),
  }).then((res) => {
    if (!res.ok) throw new Error(`Upload failed (HTTP ${res.status})`);
    return res.json();
  });

  if (!url) throw new Error('Upload returned no URL');
  return url.startsWith('http') ? url : `${API_URL}${url}`;
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

  const dataUri = await fileToDataUri(uri);
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
 * Convert a local file:// URI to a base64 data-URI string.
 * Handles both RN file:// paths and already-loaded data: URIs.
 * @param {string} uri
 * @returns {Promise<string>}
 */
async function fileToDataUri(uri) {
  if (/^data:/i.test(uri)) return uri;
  // React Native's fetch can read local file:// URIs.
  const response = await fetch(uri);
  const blob = await response.blob();
  if (blob && blob.size > MAX_MEDIA_BYTES) {
    throw new Error(
      `Media is ${(blob.size / (1024 * 1024)).toFixed(1)} MB — the limit is 50 MB.`
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
