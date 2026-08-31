// ---------------------------------------------------------------------------
// Firebase Storage — hosts community post media (images / videos)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS: the community feed stores only METADATA in Firestore
// (mediaType + mediaUri). It used to receive the author's device-local path
// (file:///data/.../ImagePicker/xxx.jpg) — a path that exists on no other
// device, so images/videos were broken for everyone except the author (and
// broke for the author too once Android cleared the cache). This module
// uploads the picked file to Firebase Storage first and returns a permanent
// https:// download URL, which is what gets stored in Firestore and rendered
// by every device.
//
// ONE-TIME SETUP (Firebase Console):
//   Build → Storage → Get started (the default bucket
//   islami-ogreniyorum.firebasestorage.app already exists in this project),
//   then set these RULES (Storage → Rules):
//
//     rules_version = '2';
//     service firebase.storage {
//       match /b/{bucket}/o {
//         match /community/media/{fileName} {
//           allow read: if true;
//           allow write: if request.resource.size < 50 * 1024 * 1024
//             && (request.resource.contentType.matches('image/.*')
//                 || request.resource.contentType.matches('video/.*'));
//         }
//       }
//     }
//
//   (Reads are public because community posts are public in the app; writes
//   are capped at 50 MB and to image/video MIME types. Optional hardening:
//   enable Anonymous sign-in in Authentication and add
//   `&& request.auth != null` to the write rule, then this module's
//   anonymous sign-in below satisfies it automatically.)
// ---------------------------------------------------------------------------

import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getFirebaseApp } from './aiLogic.js';

// Matches the 50 MB limit written into the Storage rules above.
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

/**
 * Upload a picked image/video to Firebase Storage.
 *
 * @param {string} uri - local file URI from expo-image-picker (file://…)
 * @param {'image'|'video'} type - media kind (picks extension + MIME type)
 * @returns {Promise<string>} permanent https:// download URL for the file
 * @throws {Error} when Storage isn't set up, the file is too large, or the
 *   upload fails (network / rules). Callers should fall back to keeping the
 *   local file so the author's own preview still works.
 */
export async function uploadCommunityMedia(uri, type) {
  if (!uri) throw new Error('No media URI provided');
  const isVideo = type === 'video';
  const contentType = isVideo ? 'video/mp4' : 'image/jpeg';
  const extension = isVideo ? 'mp4' : 'jpg';

  // Local file -> Blob (React Native's fetch supports file:// URIs).
  const blob = await (await fetch(uri)).blob();
  if (blob && blob.size > MAX_MEDIA_BYTES) {
    throw new Error(
      `Media is ${(blob.size / (1024 * 1024)).toFixed(1)} MB — the limit is 50 MB.`
    );
  }

  const storage = getStorage(getFirebaseApp());
  const path =
    `community/media/${Date.now()}-` +
    `${Math.random().toString(36).slice(2, 8)}.${extension}`;
  const fileRef = ref(storage, path);

  await uploadBytes(fileRef, blob, { contentType });
  return getDownloadURL(fileRef);
}

/**
 * Upload a profile picture to Firebase Storage and return a permanent
 * https:// download URL.
 *
 * WHY THIS EXISTS: profile pictures picked on-device used to be stored (and
 * shared with the backend) as file:///... paths from the image picker's cache
 * — paths that exist on no other device and break for the author too once
 * Android clears the cache. Uploading gives every device a stable URL; the
 * avatarCache module additionally mirrors it on disk so it renders offline.
 *
 * @param {string} uri - local file URI from expo-image-picker (file://…).
 *   Already-remote http(s) URLs are returned unchanged (nothing to upload).
 * @returns {Promise<string>} permanent https:// URL for the picture
 * @throws {Error} when Storage isn't set up or the upload fails (network /
 *   rules). Callers should fall back to keeping the local file.
 */
export async function uploadProfileImage(uri) {
  if (!uri) throw new Error('No image URI provided');
  if (!/^file:/i.test(uri) && !uri.startsWith('/')) {
    // Already a remote URL (Google avatar or a previously uploaded picture).
    return uri;
  }

  // Local file -> Blob (React Native's fetch supports file:// URIs).
  const blob = await (await fetch(uri)).blob();
  const storage = getStorage(getFirebaseApp());
  const path =
    `community/avatars/${Date.now()}-` +
    `${Math.random().toString(36).slice(2, 8)}.jpg`;
  const fileRef = ref(storage, path);

  await uploadBytes(fileRef, blob, { contentType: 'image/jpeg' });
  return getDownloadURL(fileRef);
}
