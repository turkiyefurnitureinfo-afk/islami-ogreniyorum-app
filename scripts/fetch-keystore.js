// Fetch Android build credentials (keystore + passwords) from EAS servers
// using the locally cached Expo session. Writes the keystore to
// android/app/eas-keystore.jks and prints the credential details.
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECT_FULL_NAME = 'joshua93/islami-ogreniyorum';
const APPLICATION_IDENTIFIER = 'com.joshua.islamiogreniyorum';

async function main() {
  const statePath = path.join(os.homedir(), '.expo', 'state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const sessionSecret = state.auth && state.auth.sessionSecret;
  if (!sessionSecret) throw new Error('No Expo session found — run `eas login` first.');

  const query = `
    query KeystoreForLocalBuild($projectId: String!, $applicationIdentifier: String) {
      app {
        byId(appId: $projectId) {
          id
          fullName
          androidAppCredentials(filter: { applicationIdentifier: $applicationIdentifier }) {
            id
            applicationIdentifier
            isLegacy
            androidAppBuildCredentialsList {
              id
              name
              isDefault
              isLegacy
              androidKeystore {
                id
                keystore
                keystorePassword
                keyAlias
                keyPassword
                sha1CertificateFingerprint
              }
            }
          }
        }
      }
    }`;

  const res = await fetch('https://api.expo.dev/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'expo-session': sessionSecret,
    },
    body: JSON.stringify({
      query,
      variables: {
        projectId: 'aafa9d62-b062-475a-9f27-4d88e0b8c6cc',
        applicationIdentifier: APPLICATION_IDENTIFIER,
      },
    }),
  });

  const json = await res.json();
  if (json.errors || !json.data || !json.data.app || !json.data.app.byId) {
    console.error('Raw response:', JSON.stringify(json, null, 2).slice(0, 1200));
    process.exit(1);
  }

  const appData = json.data.app.byId;
  console.log('Project:', appData.fullName);
  const credsList = appData.androidAppCredentials || [];
  if (credsList.length === 0) {
    console.error('No Android app credentials found for', APPLICATION_IDENTIFIER);
    process.exit(1);
  }

  for (const appCred of credsList) {
    for (const bc of appCred.androidAppBuildCredentialsList || []) {
      const ks = bc.androidKeystore;
      if (!ks) continue;
      console.log('--- build credentials:', bc.name, bc.isDefault ? '(default)' : '', bc.isLegacy ? '(legacy)' : '');
      console.log('  keyAlias:        ', ks.keyAlias);
      console.log('  keystorePassword:', ks.keystorePassword);
      console.log('  keyPassword:     ', ks.keyPassword);
      console.log('  sha1:            ', ks.sha1CertificateFingerprint);

      // Save the keystore file for Gradle to use.
      const outPath = path.join(__dirname, '..', 'android', 'app', 'eas-keystore.jks');
      fs.writeFileSync(outPath, Buffer.from(ks.keystore, 'base64'));
      console.log('  saved keystore ->', outPath);

      // Write a properties file the gradle config can consume.
      const propsPath = path.join(__dirname, '..', 'android', 'eas-credentials.properties');
      fs.writeFileSync(
        propsPath,
        [
          'EAS_UPLOAD_STORE_FILE=eas-keystore.jks',
          `EAS_UPLOAD_STORE_PASSWORD=${ks.keystorePassword}`,
          `EAS_UPLOAD_KEY_ALIAS=${ks.keyAlias}`,
          `EAS_UPLOAD_KEY_PASSWORD=${ks.keyPassword}`,
          '',
        ].join('\n')
      );
      console.log('  saved props    ->', propsPath);
    }
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
