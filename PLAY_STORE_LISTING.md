# Google Play Store Listing Draft — İslamı öğreniyorum

Package: `com.joshua.islamiogreniyorum` · Version 1.0.x · Owner: joshua93
Support email: `info@learningislamapp.com`

---

## 🚨 Before you submit (compliance checklist)

| # | Item | Status |
|---|------|--------|
| 1 | **Target API 35** — Play blocks new releases targeting ≤34 after **31 Aug 2026**. ✅ FIXED: `gradle.properties` now sets compile+target to **35**, with an edge-to-edge opt-out in `AppTheme`. Verify by installing the versionCode ≥4 APK on a device/emulator before store submission; plan the SDK 53 upgrade for proper insets support later. | 🔶 Fixed pending device check |
| 2 | **Privacy policy URL live** — use `https://islami-ogreniyorum-server.onrender.com/privacy` until learningislamapp.com is connected. Verified HTTP 200. | ✅ Ready (swap later) |
| 3 | **UGC reporting must actually work** — ✅ FIXED: ⚑ on every question/answer/post/comment opens a Report / Block-user dialog; reports persist server-side (`reports` collection via `POST /api/reports`), blocking hides the author locally. | ✅ |
| 4 | Account deletion exists in-app (Settings → Danger Zone). Keep it. | ✅ |
| 5 | Data safety form below mirrors real data flows. | ✅ Use as-is |

> Fix #1 either by upgrading to Expo SDK 53 (recommended; handles edge-to-edge),
> or short-term add `android.targetSdkVersion=35` to `android/gradle.properties`
> and test the enforced edge-to-edge layout carefully.

---

## 1️⃣ Store listing (Turkish — primary market)

### App adı (≤30 karakter)
```
İslamı öğreniyorum
```

### Kısa açıklama (≤80 karakter)
```
Namaz vakitleri, soru-cevap, İslami haberler ve topluluk — hepsi bir arada.
```

### Tam açıklama
```
🕌 İslamı öğreniyorum — manevi yolculuğunuza eşlik eden tüm rehber

Namaz vakitlerinden topluluk soru-cevabına, İslami haberlerden alim video-
mesajlarına kadar ihtiyacınız olan her şey tek, sade ve hızlı uygulamada.

⏰ NAMAZ VAKİTLERİ
• Diyanet İşleri Başkanlığı kriterlerine göre vakitler (çevrimiçi)
• Konumunuzu otomatik algılar — dünyanın her yerinden çalışır
• Sonraki namaza canlı geri sayım
• Hesaplama yöntemi seçimi: Diyanet, MWL, ISNA, Mısır, Mekke, Karaçi
• Namaz vakti bildirimleri: sesli alarm, standart veya sessiz

🤖 SORU-CEVAP
• Dinî sorularınızı sorun, topluluktan cevap alın
• Yapay zekâ destekli, kaynak gösterilen anında cevaplar
• Soruları ve cevapları beğenin; kendi içeriğinizi düzenleyin veya silin

📰 HABERLER & ETKİNLİKLER
• Diyanet Haber kaynaklı güncel İslami haberler
• Yaklaşan dini günler için hatırlatıcılar
• Seçkin âlimlerden YouTube video mesajları

🌍 TOPLULUK
• Soru sorun, gönderi paylaşın, yorum yapın
• Gerçek zamanlı bildirimler: sorunuza cevap, gönderinize beğeni
• Kendi içeriğiniz üzerinde tam kontrol: düzenleme ve silme

✨ DİĞER ÖZELLİKLER
• Türkçe / English çift dil desteği
• Koyu & açık tema
• E-posta veya Google ile hızlı giriş
• Profilinizi kişiselleştirin (fotoğraf, meslek, hakkımda)

🔒 GİZLİLİK
Konum yalnızca namaz vakitleri için, sizin izninizle kullanılır.
https://islami-ogreniyorum-server.onrender.com/privacy
Destek: info@learningislamapp.com
Esselâmu aleyküm — yolculuğuna hoş geldiniz! 🌙
```

---

## 2️⃣ Store listing (English — secondary)

### App title
Keep the Turkish brand `İslamı öğreniyorum` (18 chars); put English wording in the feature graphic instead.

### Short description (≤80 chars)
```
Prayer times, Q&A with AI, Islamic news & community — all in one app.
```

### Full description
```
🕌 İslamı öğreniyorum — your companion for the spiritual journey

From accurate prayer times to community Q&A, Islamic news and scholar video
messages — everything you need in one simple, fast app.

⏰ PRAYER TIMES
• Times follow the official Diyanet (Turkey) criteria — worldwide
• Automatic GPS detection: works wherever you are
• Live countdown to the next prayer
• Choose your convention: Diyanet, MWL, ISNA, Egypt, Makkah, Karachi
• Prayer alerts: loud alarm, standard or silent

🤖 Q&A
• Ask religious questions; get answers from the community
• Instant AI-assisted answers with sources
• Like questions & answers; edit or delete your own contributions

📰 NEWS & EVENTS
• Fresh Islamic news from Diyanet Haber feeds
• Reminders for upcoming religious days and events
• Video messages from renowned scholars on YouTube

🌍 COMMUNITY
• Ask questions, share posts, comment and like
• Real-time push notifications for answers and likes
• Full control over your own content: edit or delete anytime

✨ MORE
• Turkish / English bilingual interface
• Dark & light themes
• Sign in with email or Google
• Personalize your profile (photo, occupation, bio)

🔒 PRIVACY
Location is used only for prayer times and always with your permission.
https://islami-ogreniyorum-server.onrender.com/privacy
Support: info@learningislamapp.com
As-salamu alaykum — welcome to your journey! 🌙
```

---

## 3️⃣ Graphic assets checklist

| Asset | Spec | Notes |
|---|---|---|
| App icon | 512×512 PNG ≤1 MB | Export from existing 1024² `assets/icon.png` |
| Feature graphic | 1024×500 JPG/PNG | Crescent + mosque silhouette, gold `#d8b56a` on navy `#060b12`, TR+EN tagline |
| Phone screenshots | ≥2 · 16:9/9:16 · 320–3840px | ① Prayer countdown (dark) ② Q&A + AI answer ③ Community feed ④ News ⑤ Settings/language — TR set primary, EN secondary |

Free tools: emulator screenshots framed via shots.so / previewed.app; feature graphic in Canva preset.

## 4️⃣ Category & tags
- **Category:** Lifestyle (where Muslim Pro/Athan live); alternative Education
- **Tags:** Prayer times · Islam · Community · Religion
- Ads: No · IAP: No · In-app accounts: Yes

## 5️⃣ Content rating (IARC)
- None of the objectionable categories.
- **User-generated content: YES** (Q&A posts + community) → answer UGC questions honestly; requires working report/moderation (see checklist #3).
- Expected: Everyone / PEGI 3.

## 6️⃣ Data safety form (mirrors real behavior)

| Data type | Collected | Purpose | Shared |
|---|---|---|---|
| Precise location | Yes | App functionality | No |
| Name | Yes | Functionality/personalization | Display name visible on posts |
| Email | Yes | Account management | No (also anonymous push-routing id) |
| User content (posts/Q&A/comments) | Yes | App functionality | Public to other users |
| Photos/video | Optional | Shared content | URI stored server-side; files stay on-device (cross-device display is text-only today) |
| Push token / device ID | Yes | Messaging | Expo push service |

- Encrypted in transit: **Yes** · Deletion request: **Yes** (in-app Delete Account + support email)
- Families policy: N/A (not child-directed; target 13+)

## 7️⃣ Target audience & countries
- Age **13+** (accounts + UGC). Countries: Türkiye primary, worldwide secondary.

---
*Draft 25 Aug 2026 — re-check character counts inside Play Console; it truncates silently.*

