// Temporary: scans an EAS build log (URL or local path) for failure details.
const fs = require('fs');

async function load(src) {
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    return res.text();
  }
  return fs.readFileSync(src, 'utf8');
}

(async () => {
  const src = process.argv[2];
  const raw = await load(src);
  const lines = raw.split(/\r?\n/);

  // EAS logs are JSON-lines; extract the human-readable "msg" of each line.
  const msgs = lines.map((l) => {
    try { const o = JSON.parse(l); return String(o.msg || ''); } catch { return l; }
  });

  const pats = [
    /What went wrong/i,
    /FAILURE:/,
    /Execution failed for task/i,
    /Caused by:/i,
    /\berror:\s/i,
    /Duplicate class/i,
    /Manifest merger/i,
    /AAPT/,
    /Task :.*FAILED/,
  ];

  const hitIdx = [];
  msgs.forEach((m, i) => {
    if (m && pats.some((p) => p.test(m))) hitIdx.push(i);
  });

  // Print merged windows around hits (dedup overlapping ranges).
  const printed = new Set();
  let out = [];
  for (const i of hitIdx.sort((a, b) => a - b)) {
    for (let j = Math.max(0, i - 3); j <= Math.min(msgs.length - 1, i + 8); j++) {
      if (!printed.has(j)) {
        printed.add(j);
        out.push(`${j}: ${msgs[j].slice(0, 500)}`);
      }
    }
    out.push('   ---');
  }
  console.log(out.length ? out.join('\n') : 'NO FAILURE MARKERS FOUND');
  console.log(`\n[total log lines: ${lines.length}]`);

  // Always show the final 25 messages (contains the closing FAILURE block).
  console.log('\n=== LAST 25 MESSAGES ===');
  console.log(
    msgs.slice(-25).map((m, i) => `${lines.length - 25 + i}: ${String(m).slice(0, 400)}`).join('\n')
  );
})();