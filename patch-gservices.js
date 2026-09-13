const fs = require('fs');
const files = ['google-services.json', 'android/app/google-services.json'];
const WEB = '817195380589-bofg4l9c97uostv2jt51htcuj97v0mnj.apps.googleusercontent.com';
for (const p of files) {
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const c = j.client[0];
  if (!c.oauth_client.some((o) => o.client_type === 3)) {
    c.oauth_client.push({ client_id: WEB, client_type: 3 });
    fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
    console.log('PATCHED', p);
  } else {
    console.log('ALREADY_HAS_WEB', p);
  }
}