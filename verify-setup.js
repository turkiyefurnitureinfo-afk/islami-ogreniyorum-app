const fs = require('fs');
const pkg = require('./package.json');
const failures = [];
const check = (name, ok) => {
  if (ok) {
    console.log('PASS: ' + name);
  } else {
    console.log('FAIL: ' + name);
    failures.push(name);
  }
};

console.log('=== App Store Readiness Check ===\n');

// 1. Dependencies
check('AsyncStorage installed', !!pkg.dependencies['@react-native-async-storage/async-storage']);

// 2. App config
const appJson = JSON.parse(fs.readFileSync('app.json', 'utf8'));
const easJson = JSON.parse(fs.readFileSync('eas.json', 'utf8'));

check('app.json valid', !!(appJson.expo && appJson.expo.name));
check('eas.json valid', !!(easJson.build && easJson.build.production));
check('Android package: ' + appJson.expo.android.package, true);
check('Version: ' + appJson.expo.version, !!appJson.expo.version);

// 3. Assets
console.log('\n[3] Assets');
for (const f of ['assets/icon.png', 'assets/adaptive-icon.png', 'assets/splash.png']) {
  check('Asset: ' + f, fs.existsSync(f));
}
check('app.json icon', !!appJson.expo.icon, 'missing');

// 4. EAS
console.log('\n[4] EAS');
check('production build', !!(easJson.build && easJson.build.production), 'missing');
check('submit android', !!(easJson.submit && easJson.submit.production && easJson.submit.production.android), 'missing');
check('projectId', !appJson.expo.extra.eas.projectId.includes('YOUR_PROJECT_ID_HERE'), 'run eas init');

// 5. Backend URL
console.log('\n[5] Backend');
const notifications = fs.readFileSync('notifications.js', 'utf8');
const appCode = fs.readFileSync('App.js', 'utf8');
const config = fs.readFileSync('config.js', 'utf8');
check('notifications uses config', notifications.includes("from './config.js'"), 'missing');
check('App uses config', appCode.includes("from './config.js'"), 'missing');
check('API_URL', config.includes('API_URL'), 'missing');
check('HTTPS', config.includes('https://'), 'must use HTTPS');
check('No IP in notifications', !notifications.includes('YOUR_COMPUTER_IP_ADDRESS'), 'placeholder remains');
check('No IP in App', !appCode.includes('YOUR_COMPUTER_IP_ADDRESS'), 'placeholder remains');

// 6. Privacy
console.log('\n[6] Privacy & Legal');
const settings = fs.readFileSync('SettingsTab.js', 'utf8');
const storage = fs.readFileSync('storage.js', 'utf8');
check('PrivacyPolicy', settings.includes('PRIVACY_POLICY_URL'), 'missing');
check('DeleteAccount', settings.includes('handleDeleteAccount'), 'missing');
check('clearAllData', storage.includes('clearAllData'), 'missing');

// 7. Persistence
console.log('\n[7] Persistence');
check('storage.js', fs.existsSync('storage.js'), 'missing');
check('loadAccount', appCode.includes('loadAccount'), 'missing');
check('saveSettings', appCode.includes('saveSettings'), 'missing');

// 8. UGC moderation
console.log('\n[8] UGC Moderation');
const community = fs.readFileSync('CommunityTab.js', 'utf8');
check('ReportPost', community.includes('handleReportPost'), 'missing');
check('BlockUser', community.includes('handleBlockUser'), 'missing');
check('ModNotice', community.includes('moderationNotice'), 'missing');

// 9. Google OAuth
console.log('\n[9] Google OAuth');
const google = fs.readFileSync('googleAuth.js', 'utf8');
check('Google config', google.includes('Google Cloud Console'), 'missing');
check('makeRedirectUri', google.includes('makeRedirectUri'), 'missing');

// Summary
console.log('\n=== ' + failures.length + ' failures ===');
if (failures.length > 0) {
  console.log('FAILED: ' + failures.join(', '));
  process.exitCode = 1;
} else {
  console.log('ALL CHECKS PASSED');
}