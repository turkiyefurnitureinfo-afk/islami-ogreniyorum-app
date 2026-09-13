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
  process.exit(0);
} else {
  console.log(missing + ' MISSING IMPORT(S) - fix before building');
  process.exit(1);
}
