// Central configuration for the app.
// ============================================================
// PRODUCTION CONFIGURATION
// ---------- IMPORTANT ----------
// Deploy the backend server first, then point these URLs at your
// live deployment. For the default domain learningislamapp.com:
//   - API backend  -> https://api.learningislamapp.com
//   - Privacy page -> https://learningislamapp.com/privacy
//   - Support email-> info@learningislamapp.com
// ============================================================

// The main backend API (push notifications, AI answers, events).
// Live on Render (free tier) at islami-ogreniyorum-server.onrender.com
export const API_URL = 'https://islami-ogreniyorum-server.onrender.com';

// Privacy policy URL - required by Apple App Store & Google Play.
// This serves the page built in /website and hosted at learningislamapp.com.
export const PRIVACY_POLICY_URL = 'https://learningislamapp.com/privacy';

// Support / contact email shown in Settings.
export const SUPPORT_EMAIL = 'info@learningislamapp.com';