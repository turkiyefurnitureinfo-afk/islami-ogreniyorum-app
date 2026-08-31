# İslam nasıl öğrenilir Push Notification Server

This backend server enables **real cross-user push notifications** for the İslam nasıl öğrenilir app. When one user posts a question, comments, or likes a comment, other users receive a push notification on their devices — even when the app is closed.

## Features

- **New Question** → notifies all other registered users
- **New Comment** → notifies the question author
- **New Like** → notifies the comment author
- **Upcoming Event** → broadcasts to all users

## Setup

### 1. Get an Expo Access Token

1. Go to [https://expo.dev/settings/access-tokens](https://expo.dev/settings/access-tokens)
2. Create a new token (you must have an Expo account)
3. Copy the token

### 2. Configure the server

1. Copy `.env.example` to `.env`:
   ```
   cp .env.example .env
   ```
2. Edit `.env` and paste your Expo access token:
   ```
   EXPO_ACCESS_TOKEN=your-expo-access-token-here
   PORT=3000
   ```

### 3. Install dependencies

```
npm install
```

### 4. Start the server

```
npm start
```

The server will run at `http://localhost:3000`.

## Deploying to Production

For a real production server, you'll need to:

1. **Deploy to a cloud host** — options:
   - [Render](https://render.com) (free tier available)
   - [Heroku](https://heroku.com)
   - [AWS EC2](https://aws.amazon.com/ec2/)
   - [Google Cloud Run](https://cloud.google.com/run)

2. **Use a real database** — replace the in-memory `Map` stores with:
   - [MongoDB](https://mongodb.com) (Atlas free tier)
   - [PostgreSQL](https://postgresql.org)
   - [Firebase Firestore](https://firebase.google.com/products/firestore)

3. **Update the app's API URL** — in `config.js`, change:
   ```js
   export const API_URL = 'https://islami-ogreniyorum-server.onrender.com';
   ```
   to your deployed server URL, e.g.:
   ```js
   export const API_URL = 'https://your-server.onrender.com';
   ```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/register` | Register a device token for a user |
| `POST` | `/api/unregister` | Remove a user's device |
| `POST` | `/api/posts` | Post a new question (notifies all other users) |
| `POST` | `/api/posts/:postId/contributions` | Add a comment (notifies question author) |
| `POST` | `/api/posts/:postId/contributions/:contribId/like` | Like a comment (notifies comment author) |
| `POST` | `/api/events/notify` | Broadcast an upcoming event to all users |
| `POST` | `/api/community/posts` | Register a community post for comment/like routing |
| `POST` | `/api/community/posts/:postId/comments` | Comment on a community post (notifies post author) |
| `POST` | `/api/community/posts/:postId/like` | Like a community post (notifies post author) |
| `POST` | `/api/community/posts/:postId/comments/:commentId/like` | Like a community comment (notifies comment author) |
| `POST` | `/api/ai/answer` | AI answer for a Q&A question (Gemini / Google / built-in) |
| `GET` | `/api/news` | Live news & events collected from Turkish Muslim website feeds |
| `GET` | `/api/youtube/videos` | Latest videos from verified Islamic scholar YouTube channels (free RSS feeds) |
| `GET` | `/api/health` | Health check with device/post counts |
| `GET` | `/privacy`, `/` | Public website (privacy policy + landing page) |

## AI Answer (Q&A) — Gemini only

The AI answer endpoint (`POST /api/ai/answer`) answers questions with **Google Gemini** (free tier — get a key at https://aistudio.google.com/apikey, set `GEMINI_API_KEY` in `.env`).

- If Gemini is available, it returns its answer.
- If Gemini is unavailable (no key, network down, quota), the endpoint returns `success:false`, and the app shows a friendly *"could not generate an answer right now"* message — there is no offline canned-answer engine anymore.

The separate Google Programmable Search path (`GOOGLE_API_KEY` + `GOOGLE_CX`) and the built-in offline knowledge engine were removed to keep a single, consistent answer source.

## News & Events

The `GET /api/news` endpoint collects real, up-to-date Islamic news/events from reliable **Turkish Muslim RSS feeds** (Diyanet Haber, the official news outlet of Diyanet İşleri Başkanlığı). Results are cached for 10 minutes to avoid over-fetching. Add or remove sources in `server/news-collector.js` (`SOURCES` array).

## How Push Notifications Work

1. **App startup**: The app gets an Expo push token via `expo-notifications`
2. **Sign-in**: The app registers the token with this server (`/api/register`)
3. **User action**: When a user posts/comments/likes, the app calls the server
4. **Server**: The server uses the Expo Server SDK to send a push notification to the relevant user's device token
5. **Device**: The user receives the notification via Expo's push service (APNs for iOS, FCM for Android)

## Security Notes

- The current server has **no authentication** — anyone can call the API. For production, add:
  - JWT or session-based auth
  - Rate limiting
  - HTTPS (required by Expo push service)
- The in-memory store resets on server restart. Use a real database for production.