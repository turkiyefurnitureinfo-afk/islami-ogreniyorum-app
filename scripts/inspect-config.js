// Inspect file structures WITHOUT printing secret values.
// Usage: node scripts/inspect-config.js <file.json>
const fs = require('fs');
const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.log('missing file: ' + file); process.exit(1); }
const j = JSON.parse(fs.readFileSync(file, 'utf8'));

function summarize(k, v, depth) {
  const pad = '  '.repeat(depth);
  if (v === null) return console.log(`${pad}${k}: null`);
  if (Array.isArray(v)) {
    if (v.length === 0 || typeof v[0] !== 'object') return console.log(`${pad}${k}: array[${v.length}]`);
    console.log(`${pad}${k}: array[${v.length}] of {${Object.keys(v[0]).join(',')}}`);
    return;
  }
  if (typeof v === 'object') {
    console.log(`${pad}${k}: {`);
    for (const kk of Object.keys(v)) summarize(kk, v[kk], depth + 1);
    console.log(`${pad}}`);
    return;
  }
  const s = typeof v === 'string' ? v : String(v);
  if (k.toLowerCase().includes('key') || k.toLowerCase().includes('secret') || k.toLowerCase().includes('password') || k.toLowerCase().includes('token')) {
    console.log(`${pad}${k}: <str len=${s.length}>`);
  } else {
    console.log(`${pad}${k}: ${s.length > 60 ? s.slice(0, 60) + '...' : s}`);
  }
}
for (const k of Object.keys(j)) summarize(k, j[k], 0);