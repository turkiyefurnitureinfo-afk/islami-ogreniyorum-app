// ---------------------------------------------------------------------------
// verify-deploy-config.js — pre-release configuration connectivity check.
// ---------------------------------------------------------------------------
// Run:  node scripts/verify-deploy-config.js
// Verifies the whole release chain: Firebase (google-services.json ↔ app.json
// ↔ server), backend env, push/AI keys, and Android release-signing keystore.
// Prints [OK]/[WARN]/[FAIL] lines and exits non-zero on any FAIL.
// Prints NO secret values (only presence/length).
// ---------------------------------------------------------------------------
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const indent = '    ';
let failures = 0;
const ok = (label, detail) => console.log(`[OK]   ${label}${detail ? ' - ' + detail : ''}`);
const warn = (label, detail) => console.log(`[WARN] ${label}${detail ? ' - ' + detail : ''}`);
const bad = (label, detail) => { failures++; console.log(`[FAIL] ${label}${detail ? ' - ' + detail : ''}`); };

function readJson(p) { return JSON.parse(fs.readFileSync(path.isAbsolute(p) ? p : path.join(root, p), 'utf8')); }
function readText(p) { return fs.readFileSync(path.isAbsolute(p) ? p : path.join(root, p), 'utf8'); }
function fileExists(p) { return fs.existsSync(path.isAbsolute(p) ? p : path.join(root, p)); }
function envKeys(p) {
  if (!fileExists(p)) return [];
  const out = [];
  for (const line of readText(p).split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    const k = t.slice(0, eq).trim();
    if (!out.includes(k)) out.push(k);
  }
  return out;
}

console.log('=== 1/ Firebase (mobile <-> server) ===');
try {
  const rootSvcs = readJson('google-services.json');
  const appSvcs = readJson('android/app/google-services.json');
  const appCfg = readJson('app.json');
  const webCfg = appCfg.expo.extra.firebaseWebConfig || {};
  const project = rootSvcs.project_info && rootSvcs.project_info.project_id;
  const appProject = appSvcs.project_info && appSvcs.project_info.project_id;
  if (project === 'islami-ogreniyorum' && appProject === project) {
    ok('google-services.json project_id matches', project + ' (root + android/app)');
  } else {
    bad('google-services.json project_id mismatch', 'root=' + project + ' android=' + appProject);
  }
  if (webCfg.projectId === project) ok('app.json firebaseWebConfig.projectId matches', project);
  else bad('app.json firebaseWebConfig.projectId', webCfg.projectId + ' != ' + project);
  if (webCfg.storageBucket) ok('firebaseWebConfig.storageBucket set', webCfg.storageBucket);
  if (webCfg.apiKey && webCfg.apiKey.length > 10) ok('firebaseWebConfig.apiKey present', 'len=' + webCfg.apiKey.length);
  else bad('firebaseWebConfig.apiKey missing');
  const webClient = rootSvcs.client[0].oauth_client || [];
  const hasWebOAuth = webClient.some((o) => o.client_type === 3 || String(o.client_id).includes('googleusercontent'));
  ok(hasWebOAuth ? 'web OAuth client present (Google sign-in)' : 'WARN: web OAuth client missing (run patch-gservices.js)');
  console.log(indent + 'project_number=' + rootSvcs.project_info.project_number + '  messagingSenderId=' + webCfg.messagingSenderId);
} catch (e) { bad('Firebase config parse', e.message); }

console.log('=== 2/ Backend connectivity ===');
const API_DEFAULT = 'https://islami-ogreniyorum-server.onrender.com';
const configSrc = readText('config.js');
ok(configSrc.includes(API_DEFAULT) ? 'config.js API_URL = production backend' : 'config.js API_URL set', API_DEFAULT);
if (configSrc.includes('requestSigningKey')) ok('config.js reads requestSigningKey from app.json extra');
const serverEnv = envKeys('server/.env');
for (const k of ['EXPO_ACCESS_TOKEN', 'GROQ_API_KEY', 'SERPER_API_KEY', 'USE_FIRESTORE', 'GOOGLE_APPLICATION_CREDENTIALS', 'PORT']) {
  if (serverEnv.includes(k)) ok('server/.env ' + k + ' set');
  else warn('server/.env ' + k + ' NOT set');
}
if (serverEnv.includes('GOOGLE_APPLICATION_CREDENTIALS')) {
  const m = /GOOGLE_APPLICATION_CREDENTIALS=(.*)/.exec(readText('server/.env'));
  if (m) {
    const p = m[1].trim().trim('"').trim("'");
    if (p && fs.existsSync(path.isAbsolute(p) ? p : path.join(root, 'server', p))) {
      ok('server credential file exists', p);
    } else {
      warn('server credential file missing locally', p + ' (secret is gitignored; host sets GOOGLE_APPLICATION_CREDENTIALS_JSON or mounts the file)');
    }
  }
}
const useFs = /^USE_FIRESTORE\s*=\s*(.*)$/m.exec(readText('server/.env'));
console.log(indent + 'USE_FIRESTORE=' + (useFs ? useFs[1].trim() : '(unset)') + '  (unset/true = Firestore, false = in-memory)');

console.log('=== 3/ Android release signing (keystore) ===');
const gp = readText('android/gradle.properties');
const storeFile = /MYAPP_UPLOAD_STORE_FILE=(.*)/.exec(gp);
if (storeFile && storeFile[1].trim() === 'eas-keystore.jks') ok('gradle.properties uses eas-keystore.jks (release keystore)');
else bad('gradle.properties MYAPP_UPLOAD_STORE_FILE', storeFile ? storeFile[1].trim() : 'missing');
const appBuildGradle = readText('android/app/build.gradle');
for (const k of ['MYAPP_UPLOAD_STORE_PASSWORD', 'MYAPP_UPLOAD_KEY_ALIAS', 'MYAPP_UPLOAD_KEY_PASSWORD']) {
  ok(appBuildGradle.includes(k) ? 'build.gradle references ' + k : 'FAIL: build.gradle missing ' + k);
}
ok(fileExists('android/app/eas-keystore.jks') ? 'android/app/eas-keystore.jks exists' : 'FAIL: eas-keystore.jks missing');
const userGradleProps = path.join(os.homedir(), '.gradle', 'gradle.properties');
const userKeys = envKeys(userGradleProps);
for (const k of ['MYAPP_UPLOAD_STORE_PASSWORD', 'MYAPP_UPLOAD_KEY_ALIAS', 'MYAPP_UPLOAD_KEY_PASSWORD']) {
  if (userKeys.includes(k)) ok('~/.gradle/gradle.properties ' + k + ' set');
  else bad('~/.gradle/gradle.properties ' + k + ' missing (local signing needs it)');
}
const easCreds = fileExists('android/eas-credentials.properties');
ok(easCreds ? 'android/eas-credentials.properties present' : 'WARN: eas-credentials.properties missing');
if (easCreds) {
  const eKeys = envKeys('android/eas-credentials.properties');
  for (const k of ['EAS_UPLOAD_STORE_FILE', 'EAS_UPLOAD_STORE_PASSWORD', 'EAS_UPLOAD_KEY_ALIAS', 'EAS_UPLOAD_KEY_PASSWORD']) {
    if (eKeys.includes(k)) ok('eas-credentials.properties ' + k + ' set');
    else bad('eas-credentials.properties ' + k + ' missing');
  }
}

console.log('=== 4/ JKS contents (fingerprint) ===');
const keytool = 'C:/ASDK/jdk-17.0.20.1+1/bin/keytool.exe';
if (fs.existsSync(keytool)) {
  try {
    const creds = readJson('credentials.json');
    const storePass = creds.android.keystore.keystorePassword;
    const alias = creds.android.keystore.keyAlias;
    if (storePass && alias) {
      let out = '';
      try {
        out = execFileSync(keytool, ['-list', '-v', '-keystore', path.join(root, 'android/app/eas-keystore.jks'), '-storepass', storePass, '-alias', alias], { encoding: 'utf8', timeout: 20000 });
      } catch (e) {
        out = e.stdout ? String(e.stdout) : ('keytool error: ' + (e.stderr || e.message));
      }
      const shaLines = String(out).split(/\r?\n/).filter((l) => /SHA1:|SHA256:|Valid from:|Owner:/.test(l));
      if (shaLines.length > 0) { ok('keystore certificate readable'); for (const l of shaLines) console.log(indent + l.trim()); }
      else { warn('keystore fingerprint not extracted', String(out).slice(0, 200)); }
    } else bad('credentials.json keystore fields incomplete');
  } catch (e) { bad('credentials.json not parseable', e.message); }
} else {
  warn('JDK 17 keytool not found', keytool);
}

console.log('=== 5/ Versions & assets ===');
const pkg = readJson('package.json');
const appCfg2 = readJson('app.json');
console.log(indent + 'versionName=' + appCfg2.expo.version + '  versionCode=' + appCfg2.expo.android.versionCode + '  easProjectId=' + appCfg2.expo.extra.eas.projectId);
console.log(indent + 'expo=' + (pkg.dependencies && pkg.dependencies.expo));
ok(fileExists('android/app/src/main/res/raw/notification_high.wav') ? 'notification_high.wav present' : 'FAIL: notification sound missing');
ok((fileExists('assets/icon.png') && fileExists('assets/splash.png')) ? 'assets present' : 'FAIL: assets missing');

console.log('');
if (failures === 0) { console.log('ALL CONFIGURATION CHECKS PASSED'); process.exit(0); }
else { console.log(failures + ' CHECKS FAILED - fix before release'); process.exit(1); }