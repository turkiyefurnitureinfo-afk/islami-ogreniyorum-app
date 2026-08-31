#!/usr/bin/env node
// ---------------------------------------------------------------------------
// check-deploy.js — deployment self-check for the İslamı öğreniyorum server.
//
// Run on the LIVE host (Render/Heroku...) to verify the things that often
// silently degrade in production:
//   1. .env secrets are present (tokens/keys), not placeholders.
//   2. Firestore is ACTUALLY connected (not the silent in-memory fallback).
//   3. Firebase Admin / ID-token verification is available (anti-spoofing).
//   4. The server's own /api/health endpoint answers.
//
// Exit code is non-zero when anything critical is misconfigured, so CI/deploy
// hooks can block a broken deploy.
//
// Usage:
//   node server/check-deploy.js                          # local env/.env
//   API_URL=https://your-server.onrender.com node server/check-deploy.js
// ---------------------------------------------------------------------------

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const LINE = ''.padEnd(60, '-');
let failures = 0;
const ok = (m) => console.log('  \u2714  ' + m);
const warn = (m) => console.log('  \u26a0  ' + m);
const fail = (m) => console.log('  \u2716  ' + m);

const isRedacted = (v) =>
  !v || v.trim() === '' || /your-|PASTE_|placeholder/i.test(String(v));

// ---------- 1. Secrets -------------------------------------------------------
console.log('\n' + LINE);
console.log('  İslamı öğreniyorum server — deploy health check');
console.log(LINE);

console.log('\n[1] Required secrets');
const REQUIRED_ENV = [
  ['EXPO_ACCESS_TOKEN', 'push notifications'],
  ['GEMINI_API_KEY', 'AI Q&A answers (Gemini only)'],
];
for (const [key, purpose] of REQUIRED_ENV) {
  const v = process.env[key];
  if (isRedacted(v)) { fail(`${key} -> missing/placeholder (${purpose})`); failures++; }
  else ok(`${key} present (${purpose})`);
}

// Google Custom Search is no longer used — Gemini is the only AI provider.
// Firebase credentials may arrive as base64 env OR a local key file.
const fs = require('fs');
const path = require('path');
let serviceAccount = null;
const b64 = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
if (b64 && !isRedacted(b64)) {
  try { serviceAccount = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')); }
  catch { fail('GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid base64 JSON'); failures++; }
}
if (!serviceAccount) {
  const keyPath = path.resolve(__dirname, process.env.GOOGLE_APPLICATION_CREDENTIALS || 'serviceAccountKey.json');
  serviceAccount = fs.existsSync(keyPath) ? require(keyPath) : null;
}
if (serviceAccount) ok('Firebase service-account credentials resolved');
else { fail('No Firebase service-account found'); failures++; }
async function main() {
  // (No live Google CSE probe: Gemini is the only AI source now, and its
  //  key presence is verified in [1] above. The separate Google Programmable
  //  Search path was removed to avoid the key/CX account-pairing fragility.)

  // ---------- 2. Firestore persistence -----------------------------------------
  console.log('\n[2] Firestore / persistence');
  const admin = require('firebase-admin');
  if (String(process.env.USE_FIRESTORE).toLowerCase() === 'false') {
    warn('USE_FIRESTORE=false -> storing to memory only; set true for persistence.');
  }
  if (serviceAccount && serviceAccount.project_id) {
    ok(`service account for project "${serviceAccount.project_id}"`);
    try {
      // firebase-admin v14 moved apps off the root namespace; getApps() works on both.
      const apps =
        (typeof admin.getApps === 'function' ? admin.getApps() : admin.apps) || [];
      if (apps.length === 0) {
        const cred = typeof admin.credential?.cert === 'function'
          ? admin.credential.cert(serviceAccount)
          : admin.cert(serviceAccount);
        admin.initializeApp({ credential: cred });
      }
      const db = typeof admin.firestore === 'function'
        ? admin.firestore()
        : require('firebase-admin/firestore').getFirestore();
      await Promise.race([
        db.collection('devices').limit(1).get(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('probe timed out (8s)')), 8000)),
      ]);
      ok('Firestore round-trip OK -> persistence is ACTIVE (not in-memory)');
    } catch (err) {
      fail('Firestore probe failed: ' + (err.message || err));
      warn('Create the DB (Firebase Console -> Firestore -> Create database) and enable the API.');
      failures++;
    }
  } else if (serviceAccount) {
    fail('service account JSON has no project_id (probably an OAuth client secret).');
    failures++;
  }

  // ---------- 3. ID-token verification (anti-spoofing) ----------------------------
  console.log('\n[3] Firebase ID-token verification');
  try {
    const verify = require('./verify');
    const auth = verify.initVerify();
    if (auth) ok('Token verification ready -> spoofed userIds will be rejected.');
    else { fail('Token verification unavailable -> ownership can be spoofed.'); failures++; }
  } catch (err) {
    fail('verify module error: ' + (err.message || err));
    failures++;
  }

  // ---------- 4. Live health endpoint --------------------------------------------
  const api = process.env.API_URL || process.env.RENDER_EXTERNAL_URL;
  if (api) {
    console.log('\n[4] Live health check');
    try {
      const res = await fetch(api + '/api/health');
      const body = await res.json();
      if (res.ok) ok(`GET ${api}/api/health -> ${res.status} ${JSON.stringify(body)}`);
      else { fail(`health -> ${res.status} ${JSON.stringify(body)}`); failures++; }
    } catch (err) {
      fail(`could not reach ${api}: ${(err && err.message) || err}`);
      warn('   (expected during first deploy while Render spins up; retry in ~60s)');
      failures++;
    }
  } else {
    console.log('\n[4] Live health check -> skipped (set API_URL / RENDER_EXTERNAL_URL)');
  }

  // ---------- Summary -------------------------------------------------------------
  console.log('\n' + LINE);
  if (failures === 0) { ok('ALL CHECKS PASSED — safe to ship.'); console.log(LINE); process.exit(0); }
  else { fail(`${failures} check(s) FAILED — fix before publishing`); console.log(LINE); process.exit(1); }
}

main().catch((err) => { console.error('check-deploy failed to run:', err); process.exit(1); });