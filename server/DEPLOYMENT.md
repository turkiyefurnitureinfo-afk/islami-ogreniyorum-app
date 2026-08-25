# Deploying to Render (Persistent Firestore) — Step-by-Step

This guide walks through deploying the backend (`server/`) to Render and turning on
persistent Firestore storage.

- Live health check: `https://islami-ogreniyorum-server.onrender.com/api/health`
- After Firestore is enabled it should return `"storage":"firestore"` (not `"memory"`).

---

## 1. First deploy (from the Render Blueprint)

1. Push this repo to GitHub (including `render.yaml` **at the repo root**).
2. Render → **New → Blueprint** → select the repo.
   Render auto-detects `render.yaml`, creates the service `islami-ogreniyorum-server`
   (free tier, root directory `server`, start command `npm start`).
3. Click **Deploy** and wait until it's `Live`.

> Note: right after the first deploy the backend uses in-memory storage
> (`"storage":"memory"`) until you set the Firestore secret (Step 3).

---

## 2. Gather the values you need (do this once)

You will paste 3 values into Render. Collect them now:

| Env var (in Render) | Where the value comes from |
|---|---|
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | base64 of `server/serviceAccountKey.json` |
| `EXPO_ACCESS_TOKEN` | from `server/.env` |
| `GEMINI_API_KEY` | from `server/.env` |

⚠️ Never commit `server/.env` or `server/serviceAccountKey.json` — they are already
excluded by `.gitignore`. You are only copying their contents **into Render's dashboard**.

---

## 3. Generate the base64 string (Windows PowerShell)

The key file lives at `server/serviceAccountKey.json`. Use an **absolute path** so it
works no matter which folder your terminal is in:

```powershell
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\islami-ogreniyorum-app\islami-ogreniyorum-app\server\serviceAccountKey.json"))
Set-Clipboard $b64   # copies to clipboard
Write-Output $b64    # also prints it
```

If your project lives at a different path, paste that instead (the file is the one
called `serviceAccountKey.json` inside the `server` folder of this repo).

**The output must be one long, unbroken string** (≈3,100 chars) starting with
`ewogICJ0eXBlIjogInNlcnZpY2Vf...`. If it contains `-----BEGIN CERTIFICATE-----` lines
or line breaks, the encoding was wrong — do not use it.

> Linux/macOS equivalent: `base64 -w0 server/serviceAccountKey.json`

---

## 4. Add the environment variables in Render

1. dashboard.render.com → open **islami-ogreniyorum-server**.
2. Open the **Environment** tab.
3. Add each variable and mark it a secret (values are hidden with dots):

   - `GOOGLE_APPLICATION_CREDENTIALS_JSON`  = the base64 string from Step 3
   - `EXPO_ACCESS_TOKEN`                     = `iTdkI7shfdyG46XOXe65hplqsinoKFCnnJjxZwG-`
   - `GEMINI_API_KEY`                        = `AQ.Ab8RN6KUtDdSGZYM5pwQ46arGDNs5_8z-0TaotyGXD9AjP2SWVA`

   Double-check the name is exactly `GOOGLE_APPLICATION_CREDENTIALS_JSON`
   (the `_JSON` suffix matters — it is the "contents", not the file-path version).
4. **Save Changes**.

---

## 5. Redeploy so the new vars take effect

1. Service → **Manual Deploy** → **Clear build cache & deploy**.
2. Wait for it to reach `Live` (watch the event/build logs).
3. Check the health endpoint:

   ```
   https://islami-ogreniyorum-server.onrender.com/api/health
   ```

   You are looking for:
   ```json
   {"status":"ok","storage":"firestore","deviceCount":0,...}
   ```
   `"firestore"` (not `"memory"`) = success.

If it still says `memory`, open the service **Logs** tab and check the startup line:
- `[storage] ✅ Connected to Firestore` → success
- `NOT_FOUND` error → you need to create the Firestore database (Step 6).

---

## 6. First-time Firestore setup (only if there is a Firebase error)

If the logs show `NOT_FOUND` (no Firestore database yet):
1. https://console.firebase.google.com → open the project.
2. **Firestore Database → Create database** → choose **production mode** (or test for dev) → pick a location → Done.
3. Back in Render → **Manual Deploy → Clear build cache & deploy** again.

For a `PERMISSION_DENIED`, confirm **Cloud Firestore API** is enabled for the GCP
project in Google Cloud Console (APIs & Services).

---

## 7. Point the app at the live backend

`config.js` at the repo root already sets:
```js
export const API_URL = 'https://islami-ogreniyorum-server.onrender.com';
```
Because `API_URL` is baked into the app's JS bundle, **rebuild/redeploy** the app
(e.g. EAS Build) for installed copies to pick up the new URL. Suggested EAS command:

```bash
npm run build:android     # production profile, auto-increments internal build number
```