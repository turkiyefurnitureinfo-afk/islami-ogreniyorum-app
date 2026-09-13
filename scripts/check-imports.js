// check-imports.js — verify every local (relative) import in the repo's
// top-level .js files resolves to an existing file, so Metro bundling can
// never fail on a dangling import. Run before each release build.
// Usage: node scripts/check-imports.js
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const files = fs
  .readdirSync(root)
  .filter((f) => f.endsWith('.js') && fs.statSync(path.join(root, f)).isFile());

let missing = 0;
for (const file of files) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const re = /(?:from\s+|require\s*\(\s*)['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const rel = m[1];
    const resolved = path.resolve(root, rel);
    // require() resolves extensionless specifiers to .js (and /index.js);
    // mirror that so valid imports are not flagged as missing.
    const candidates = [
      resolved,
      resolved + '.js',
      resolved + '.json',
      path.join(resolved, 'index.js'),
    ];
    if (!candidates.some((c) => fs.existsSync(c))) {
      missing++;
      console.log('MISSING ' + rel + ' referenced by ' + file);
    }
  }
}

if (missing === 0) {
  console.log('ALL_LOCAL_IMPORTS_RESOLVE (' + files.length + ' files scanned)');
} else {
  console.log(missing + ' MISSING IMPORT(S) - fix before building');
  process.exit(1);
}

// --- Named/default export consistency -------------------------------------
// A missing NAMED export does not fail bundling: Metro happily binds it to
// `undefined` and the app crashes later with "ReferenceError: x is not
// defined" (or a silent no-op). This mirrors the module graph and checks
// that every `import { name } from './file'` is actually exported.
const exportCache = new Map();

function scanExports(src) {
  const named = new Set();
  let hasDefault = false;
  const patterns = [
    /export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g,
    /export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
    /export\s+class\s+([A-Za-z_$][\w$]*)/g,
    /export\s*\{([^}]*)\}/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src)) !== null) {
      if (m[0].startsWith('export {') || m[0].startsWith('export{')) {
        for (const part of m[1].split(',')) {
          const name = part.trim().split(/\s+as\s+/).pop().trim();
          if (name && name !== 'default') named.add(name);
        }
      } else {
        named.add(m[1]);
      }
    }
  }
  if (/export\s+default\b/.test(src)) hasDefault = true;
  return { named, hasDefault };
}

let badExports = 0;
for (const file of files) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const re = /import\s+(?:([A-Za-z_$][\w$]*)\s*,\s*)?(?:\{([^}]*)\}\s*)?from\s*['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const rel = m[3];
    const resolved = path.resolve(root, rel);
    const target = [resolved, resolved + '.js', path.join(resolved, 'index.js')].find((c) =>
      fs.existsSync(c) && fs.statSync(c).isFile()
    );
    if (!target) continue; // already reported above
    if (!exportCache.has(target)) exportCache.set(target, scanExports(fs.readFileSync(target, 'utf8')));
    const exp = exportCache.get(target);

    if (m[1] && !exp.hasDefault) {
      badExports++;
      console.log('NO_DEFAULT_EXPORT ' + rel + ' default-imported by ' + file);
    }
    if (m[2]) {
      for (const part of m[2].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (!name || name === 'default') continue;
        if (!exp.named.has(name)) {
          badExports++;
          console.log('MISSING_NAMED_EXPORT { ' + name + ' } not exported by ' + rel + ' (imported by ' + file + ')');
        }
      }
    }
  }
}

if (badExports === 0) {
  console.log('ALL_NAMED_IMPORTS_EXPORTED');
  process.exit(0);
} else {
  console.log(badExports + ' EXPORT MISMATCH(ES) - these become undefined at runtime');
  process.exit(1);
}
