/**
 * check-imports.js — validates every relative import in the root JS files
 * resolves to an existing file. Exit code 1 if any import is broken.
 */
const fs = require('fs');
const path = require('path');

const base = __dirname + '/..';
const files = fs.readdirSync(base).filter((f) => f.endsWith('.js'));
let bad = 0;
let checked = 0;

for (const f of files) {
  const src = fs.readFileSync(path.join(base, f), 'utf8');
  const re = /(?:from\s*|require\(\s*)['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    checked++;
    const p = path.join(base, f, '..', m[1]);
    const ok =
      fs.existsSync(p) ||
      fs.existsSync(p + '.js') ||
      fs.existsSync(path.join(p, 'index.js'));
    if (!ok) {
      bad++;
      console.log(`BROKEN  ${f} -> ${m[1]}`);
    }
  }
}
console.log(`checked=${checked} relative imports, broken=${bad}`);
process.exit(bad ? 1 : 0);
