/**
 * JSX component checker — catches "used but never imported" React components.
 *
 * Why: a missing named import does NOT fail Metro bundling (it binds to
 * undefined), and React then throws at render time:
 *   - dev:      "ReferenceError: X is not defined" (red screen)
 *   - release:  "Element type is invalid: expected a string ... got: undefined"
 * This is the exact bug class of the PrayerTab crash (Pressable used without
 * being imported) and the earlier setupNotificationChannel startup crash.
 *
 * Scans every top-level app .js file, extracts <Identifier ...> JSX tags, and
 * verifies each capitalized identifier is either imported into the file or
 * defined locally (function/const/class). Usage: node scripts/check-jsx.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const files = fs
  .readdirSync(root)
  .filter((f) => f.endsWith('.js') && fs.statSync(path.join(root, f)).isFile())
  // One-off maintenance scripts are never bundled — skip them.
  .filter((f) => !/^(convert-icon|gen-high-sound|generate-assets|verify-setup|installAsync|update-events|test-|patch-gservices|check-)/.test(f));

const isComponent = (name) => /^[A-Z]/.test(name);

let problems = 0;
for (const file of files) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const defined = new Set();

  // 1) Named imports: import { A, B } from '...'
  let m;
  const importRe = /import\s*\{([^}]*)\}\s*from/g;
  while ((m = importRe.exec(src)) !== null) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) defined.add(name);
    }
  }
  // 2) Default / namespace imports: import React..., import * as X...
  const defRe = /import\s+(?:([A-Za-z_$][\w$]*)|\*\s+as\s+([A-Za-z_$][\w$]*))/g;
  while ((m = defRe.exec(src)) !== null) {
    if (m[1]) defined.add(m[1]);
    if (m[2]) defined.add(m[2]);
  }
  // 3) Local declarations anywhere in the file.
  const declRe = /(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = declRe.exec(src)) !== null) defined.add(m[1]);

  // Strip comments and strings so JSX-looking text inside them is not scanned.
  let code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  code = code.replace(/`(?:\\[\s\S]|[^`\\])*`/g, '``');
  code = code.replace(/'(?:\\.|[^'\\\n])*'/g, "''");
  code = code.replace(/"(?:\\.|[^"\\\n])*"/g, '""');

  // 4) Collect JSX component tags: <Name followed by whitespace, > or /.
  const tagRe = /<([A-Za-z_$][\w$]*)/g;
  const used = new Set();
  while ((m = tagRe.exec(code)) !== null) {
    const name = m[1];
    if (!isComponent(name)) continue;
    const after = code.slice(m.index + 1 + name.length).match(/^\s|[>/]/);
    if (!after) continue;
    used.add(name);
  }

  for (const name of used) {
    if (!defined.has(name)) {
      problems++;
      console.log(`UNDEFINED_COMPONENT <${name}> used in ${file} but never imported/defined`);
    }
  }
}

if (problems === 0) {
  console.log('ALL_JSX_COMPONENTS_DEFINED');
  process.exit(0);
} else {
  console.log(problems + ' UNDEFINED COMPONENT(S) - these crash at render time');
  process.exit(1);
}
