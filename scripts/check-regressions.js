/**
 * Regression guard — catches the "silent breakage" bug class this project has
 * repeatedly shipped inside a GREEN Gradle build, where nothing crashes at
 * build time and only users notice:
 *
 *   1. UNDEFINED FUNCTION CALLS
 *      `postMediaTag(...)` was called in App.js while the helper existed
 *      nowhere in the repo. Building a post object therefore threw
 *      `ReferenceError: postMediaTag is not defined` for every post WITH media,
 *      so setCommunityPosts() and the backend registration (and with them the
 *      "New Post" push broadcast) never ran. scripts/check-jsx.js only looks at
 *      JSX *components* (<Capitalized/>), so a plain lowercase call slipped
 *      through — this check covers plain calls too.
 *
 *   2. STRUCTURAL INVARIANTS
 *      Source assertions for fixes that are invisible from the UI (see the
 *      checkFile table below).
 *
 * Usage: node scripts/check-regressions.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Part 1 — undefined function calls
// ---------------------------------------------------------------------------

// Functions the JS runtime / Metro provides. Anything else that is CALLED but
// never imported or declared locally is almost certainly a crash in waiting.
const GLOBALS = new Set([
  'fetch', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'setImmediate', 'requestAnimationFrame', 'cancelAnimationFrame',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'String', 'Number',
  'Boolean', 'Array', 'Object', 'JSON', 'Math', 'Date', 'Promise', 'Set',
  'Map', 'WeakMap', 'WeakSet', 'RegExp', 'Error', 'TypeError', 'Symbol',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  'require', 'alert', 'console', 'process', 'global', 'globalThis',
  'Buffer', 'URL', 'URLSearchParams', 'AbortController', 'AbortSignal',
  'TextEncoder', 'TextDecoder', 'atob', 'btoa', 'structuredClone',
  'queueMicrotask', 'requireNativeComponent',
]);

// Reserved words / statement keywords that can appear immediately before "("
// (if (…), for (…), catch (…), await (…), …). They are never function calls.
const KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
  'catch', 'try', 'finally', 'throw', 'new', 'typeof', 'instanceof', 'delete',
  'in', 'of', 'await', 'async', 'function', 'class', 'const', 'let', 'var',
  'yield', 'super', 'void', 'default', 'export', 'import', 'extends', 'static',
  'return',
]);

/** Add every identifier found in a fragment (params, destructuring patterns). */
function addIdentifiers(defined, fragment) {
  const idRe = /[A-Za-z_$][\w$]*/g;
  let m;
  while ((m = idRe.exec(fragment)) !== null) {
    if (!KEYWORDS.has(m[0])) defined.add(m[0]);
  }
}

const appFiles = fs
  .readdirSync(root)
  .filter((f) => f.endsWith('.js') && fs.statSync(path.join(root, f)).isFile())
  // Maintenance / tooling scripts are never bundled into the app.
  .filter((f) => !/^(convert-icon|gen-high-sound|generate-assets|verify-setup|installAsync|update-events|test-|patch-gservices|check-|trim-)/.test(f));

function stripCommentsAndStrings(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

let problems = 0;

for (const file of appFiles) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const defined = new Set();
  let m;

  // Named imports (with or without a preceding default import).
  const importRe = /import\s+(?:[A-Za-z_$][\w$]*\s*,?\s*)?\{([^}]*)\}\s*from/g;
  while ((m = importRe.exec(src)) !== null) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) defined.add(name);
    }
  }
  // Default / namespace imports.
  const defRe = /import\s+(?:([A-Za-z_$][\w$]*)|(\*\s+as\s+[A-Za-z_$][\w$]*))/g;
  while ((m = defRe.exec(src)) !== null) {
    if (m[1]) defined.add(m[1]);
    if (m[2]) defined.add(m[2].replace(/\*\s+as\s+/, ''));
  }
  // Local declarations (function / const / let / var / class).
  const declRe = /(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = declRe.exec(src)) !== null) defined.add(m[1]);
  // Function parameters: (a, b) => … and function (a, b) { … }
  const paramRe = /\(([^()]*)\)\s*(?:=>|\{)/g;
  while ((m = paramRe.exec(src)) !== null) {
    addIdentifiers(defined, m[1]);
  }
  // Destructured names: const { a } = …, ({ a }) => …
  // Destructured bindings: const [a, setA] = …, const { a, b } = …
  const arrayBindRe = /\[([^\]]*)\]\s*=/g;
  while ((m = arrayBindRe.exec(src)) !== null) addIdentifiers(defined, m[1]);
  const objectBindRe = /\{([^}]*)\}\s*=/g;
  while ((m = objectBindRe.exec(src)) !== null) addIdentifiers(defined, m[1]);
  // Catch bindings.
  const catchRe = /catch\s*\(\s*([A-Za-z_$][\w$]*)/g;
  while ((m = catchRe.exec(src)) !== null) defined.add(m[1]);

  const code = stripCommentsAndStrings(src);

  // Calls: `name(` not preceded by `.` (a method call).
  const callRe = /(^|[^\w$.])([a-z_$][\w$]*)\s*\(/gm;
  const reported = new Set();
  while ((m = callRe.exec(code)) !== null) {
    const name = m[2];
    if (KEYWORDS.has(name) || GLOBALS.has(name) || defined.has(name) || reported.has(name)) continue;
    const before = code.slice(Math.max(0, m.index - 12), m.index + m[1].length);
    if (/(?:function|class|typeof|await|new)\s*$/.test(before)) continue;
    reported.add(name);
    problems++;
    console.log(
      `UNDEFINED_CALL ${name}() in ${file} — never imported or declared (throws ReferenceError at runtime)`
    );
  }
}

// ---------------------------------------------------------------------------
// Part 2 — structural invariants behind previously-shipped bugs
// ---------------------------------------------------------------------------

/**
 * Assert source-level invariants for one file.
 * @param {string} file - path relative to the repo root
 * @param {Array<{label:string, mustMatch?:RegExp, mustNotMatch?:RegExp}>} checks
 */
function checkFile(file, checks) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) {
    problems++;
    console.log(`MISSING_FILE ${file}`);
    return;
  }
  const src = fs.readFileSync(full, 'utf8');
  for (const { label, mustMatch, mustNotMatch } of checks) {
    if (mustMatch && !mustMatch.test(src)) {
      problems++;
      console.log(`INVARIANT_BROKEN ${file}: ${label}`);
    }
    if (mustNotMatch && mustNotMatch.test(src)) {
      problems++;
      console.log(`INVARIANT_BROKEN ${file}: ${label}`);
    }
  }
}

checkFile('server/index.js', [
  {
    label: '/api/upload must be exempt from the global 32kb body parser',
    mustMatch: /if\s*\(ownsBodyParsing\(req\)\) return next\(\);/,
    // A bare global express.json({limit:'32kb'}) captures /api/upload FIRST and
    // rejects every real photo/video with HTTP 413 before the route can run.
    mustNotMatch: /^app\.use\(express\.json\(\{ limit: '32kb' \}\)\);$/m,
  },
  {
    // An exact `req.path === '/api/upload'` compare misses '/api/upload/', which
    // Express still routes to the upload handler — that variant would fall back
    // to the 32kb parser and 413 again.
    label: 'the upload body-parser exemption must tolerate a trailing slash',
    mustMatch: /req\.path\.replace\(\/\\\/\+\$\/, ''\) === '\/api\/upload'/,
  },
  {
    label: '/api/upload must keep its own large body parser',
    mustMatch: /const uploadJson = express\.json\(\{ limit: '60mb' \}\)/,
  },
]);

checkFile('server/ai-answer.js', [
  {
    label: '/api/ai/answer must synthesize through the Groq chat pipeline',
    mustMatch: /handleSearchAugmentedChat/,
  },
]);

checkFile('server/push-dispatch.js', [
  {
    label: 'new_question must route to the community channel',
    mustMatch: /trigger === 'new_question' \|\|/,
  },
]);

checkFile('notifications.js', [
  {
    label: 'community channel must not be DEFAULT importance (silent notifications)',
    mustNotMatch: /COMMUNITY_CHANNEL_ID[\s\S]{0,600}?AndroidImportance\.DEFAULT/,
  },
]);

checkFile('mediaService.js', [
  {
    label: 'uploadCommunityMedia must resolve the media kind, not trust a bare extension',
    mustMatch: /resolveMediaKind\(uri, type\)/,
  },
]);

checkFile('App.js', [
  {
    label: 'posts must pass the media kind (image|video) to uploadCommunityMedia',
    mustMatch: /uploadCommunityMedia\(media\.uri, kind\)/,
    // The old code called a helper that did not exist — see the header comment.
    mustNotMatch: /\bpostMediaTag\s*\(/,
  },
]);

checkFile('aiLogic.js', [
  {
    label: 'stale non-AI cached answers must be re-asked',
    mustMatch: /isStaleCachedAnswer/,
  },
]);

if (problems === 0) {
  console.log('ALL_REGRESSION_CHECKS_PASSED');
  process.exit(0);
}
console.log(problems + ' REGRESSION CHECK(S) FAILED');
process.exit(1);
