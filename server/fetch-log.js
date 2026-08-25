// Temporary: saves a remote EAS log to build-log.txt for local scanning.
const fs = require('fs');

(async () => {
  const url = process.argv[2];
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const text = await res.text();
  fs.writeFileSync('build-log.txt', text);
  console.log(`saved build-log.txt (${text.length} bytes, ${text.split('\n').length} lines)`);
})();