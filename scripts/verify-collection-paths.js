/** verify-collection-paths.js — checks no raw-string collection paths remain */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const files = ['server/storage.js', 'server/clear-community.js', 'server/check-deploy.js'];
const collectionNames = ['qaPosts', 'communityPosts', 'contributions', 'comments', 'users', 'devices', 'reports'];

for (const rel of files) {
  const p = path.join(ROOT, rel);
  const c = fs.readFileSync(p, 'utf8');
  // syntax check
  try { require('vm').compileFunction(c, [], { filename: p }); }
  catch (e) { console.log(rel + ': ✗ SYNTAX ERROR: ' + e.message); continue; }

  // find raw string .collection('...') calls
  const rawMatches = [];
  const regex = /\.collection\(['"](qaPosts|communityPosts|contributions|comments|users|devices|reports)['"]\)/g;
  let m;
  while ((m = regex.exec(c)) !== null) rawMatches.push(m[0]);

  // find raw string db.doc(`users/...`) calls (template literal)
  const docTemplateRegex = /db\.doc\(`users\/[^`]+\)`/g;
  let dm;
  while ((dm = docTemplateRegex.exec(c)) !== null) rawMatches.push(dm[0]);

  if (rawMatches.length === 0) {
    console.log(rel + ': ✅ no raw collection strings found (all use C.* constants)');
  } else {
    console.log(rel + ': ⚠️  remaining raw strings:');
    for (const r of rawMatches) console.log('  → ' + r);
  }
}

// Also verify C is exported from storage.js
const storageSrc = fs.readFileSync(path.join(ROOT, 'server', 'storage.js'), 'utf8');
if (/module\.exports\s*=[\s\S]*?\bC\b\s*[:,]/.test(storageSrc)) {
  console.log('\nstorage.js: ✅ C is exported from module.exports');
} else {
  console.log('\nstorage.js: ⚠️  C is NOT exported from module.exports');
}

// Verify onCollectionSnapshot was added
if (storageSrc.indexOf('onCollectionSnapshot') >= 0) {
  console.log('storage.js: ✅ onCollectionSnapshot safe listener added');
} else {
  console.log('storage.js: ⚠️  onCollectionSnapshot NOT found');
}

// Count C.* usages
const cUsage = (storageSrc.match(/C\.[A-Z_]+/g) || []);
console.log('\nstorage.js: ' + cUsage.length + ' C.* constant references found');
console.log('  Unique constants used: ' + JSON.stringify([...new Set(cUsage)]));
