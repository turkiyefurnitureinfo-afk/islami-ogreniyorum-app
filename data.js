export const CITIES = {
  istanbul: { lat: 41.0082, lng: 28.9784, tz: 3, name: 'Istanbul' },
  ankara: { lat: 39.9334, lng: 32.8597, tz: 3, name: 'Ankara' },
  izmir: { lat: 38.4237, lng: 27.1428, tz: 3, name: 'Izmir' },
  bursa: { lat: 40.1826, lng: 29.0584, tz: 3, name: 'Bursa' },
  london: { lat: 51.5074, lng: -0.1278, tz: 1, name: 'London' },
  paris: { lat: 48.8566, lng: 2.3522, tz: 2, name: 'Paris' },
  berlin: { lat: 52.52, lng: 13.405, tz: 2, name: 'Berlin' },
  dubai: { lat: 25.2048, lng: 55.2708, tz: 4, name: 'Dubai' },
};

export const Q_AND_A = {
  tr: [
    {
      id: 1,
      question: 'Zekâtın farz olması için gerekli şartlar nelerdir?',
      answer: 'Zekâtın farz olması için kişinin Müslüman, aklı başında, hür ve nisap miktarına ulaşan mal sahibi olması gerekir. Bunun yanında malın üzerinden bir yıl geçmiş olması da nisap bakımından önemli bir şarttır.',
      source: 'Diyanet İşleri Başkanlığı',
      href: 'https://www.diyanet.gov.tr/tr-TR/icerik/zekat/19743',
      likes: 24,
      likedByMe: false,
      answers: [
        { id: 1001, user: { name: 'Uzm. Dr. Ahmet Yılmaz', avatar: '🧔🏻‍♂️' }, text: 'Nisap miktarı altın için 80.18 gram, gümüş için 561 gramdır. Malın üzerinden bir hicri yıl geçmesi gerekir.', timestamp: '2 gün önce', likes: 8, likedByMe: false },
        { id: 1002, user: { name: 'Fatma S.', avatar: '👩‍🦰' }, text: 'Ayrıca borçlu olan kişinin borcunu düştükten sonra nisaba ulaşması gerekir.', timestamp: '1 gün önce', likes: 3, likedByMe: false },
      ],
    },
    {
      id: 2,
      question: 'Namazda secde sırasında hangi dualar okunur?',
      answer: 'Secdede “Subhane Rabbiyel A’la” duası okunur. Bu, sevap ve huzur için önemli bir ibadettir. Secdeyi uzun tutmak ve samimi şekilde zikretmek ibadetin kıymetini artırır.',
      source: 'Diyanet Yıllığı / Diyanet namaz rehberi',
      href: 'https://www.diyanet.gov.tr/tr-TR/Konusmaci/namaz',
      likes: 18,
      likedByMe: false,
      answers: [
        { id: 2001, user: { name: 'Hasan C.', avatar: '👨‍🎓' }, text: 'Secdede en az üç kez "Subhane Rabbiyel A\'la" demek sünnettir.', timestamp: '3 gün önce', likes: 5, likedByMe: false },
      ],
    },
    {
      id: 3,
      question: 'Ramazanda oruç tutmanın temel hikmeti nedir?',
      answer: 'Oruç, insanı nefsini kontrol etmeye, sabra, şükre ve Allah’a olan muhtaçlığı daha derin hissetmeye yönlendirir. Aynı zamanda toplumda merhamet, dayanışma ve fedakârlık duygusunu güçlendirir.',
      source: 'Diyanet Kur’an-ı Kerim Açıklaması',
      href: 'https://www.diyanet.gov.tr/tr-TR/kuran',
      likes: 31,
      likedByMe: false,
      answers: [
        { id: 3001, user: { name: 'Ayşe Y.', avatar: '🧕' }, text: 'Oruç aynı zamanda takvayı kazandırır. Kur\'an\'da "Oruç sizden öncekilere farz kılındığı gibi size de farz kılındı" buyrulur.', timestamp: '5 gün önce', likes: 12, likedByMe: false },
        { id: 3002, user: { name: 'Mehmet K.', avatar: '👨‍💻' }, text: 'Oruç, empati duygusunu güçlendirir ve ihtiyaç sahiplerini anlamamıza yardımcı olur.', timestamp: '4 gün önce', likes: 7, likedByMe: false },
      ],
    },
    {
      id: 4,
      question: 'Cuma namazı için hutbe öncesi yapılması gereken sünnetler nelerdir?',
      answer: 'Abdest almak, temiz giyinmek, erken gelmek, temiz ve güzel bir yer edinmek ve hutbeyi dikkatle dinlemek önemli sünnetlerdendir. Cuma namazı toplumsal birlik ve ibadet bilinci için büyük bir fırsattır.',
      source: 'Diyanet Cuma Hutbesi / İslam Ansiklopedisi',
      href: 'https://www.diyanet.gov.tr/tr-TR/icerik/cuma-namazinin-hukmu/2871',
      likes: 9,
      likedByMe: false,
      answers: [],
    },
  ],
  en: [
    {
      id: 1,
      question: 'What are the conditions for Zakat to become obligatory?',
      answer: 'For Zakat to become obligatory, a person must be Muslim, sound in mind, free, and possess the nisab threshold in wealth. The wealth must also have remained with him for one lunar year, depending on the type of asset.',
      source: 'Diyanet (Turkish Presidency of Religious Affairs)',
      href: 'https://www.diyanet.gov.tr/en-EN',
      likes: 24,
      likedByMe: false,
      answers: [
        { id: 1001, user: { name: 'Uzm. Dr. Ahmet Yılmaz', avatar: '🧔🏻‍♂️' }, text: 'The nisab threshold is 80.18 grams of gold or 561 grams of silver. The wealth must have been held for one lunar year.', timestamp: '2 days ago', likes: 8, likedByMe: false },
        { id: 1002, user: { name: 'Fatma S.', avatar: '👩‍🦰' }, text: 'Also, a person who is in debt must reach the nisab after deducting their debts.', timestamp: '1 day ago', likes: 3, likedByMe: false },
      ],
    },
    {
      id: 2,
      question: 'Which supplications are recited during prostration in prayer?',
      answer: 'During sujud, the phrase “Subhāna Rabbiyal-A’lâ” is recited. This is a deeply meaningful supplication that brings humility, peace, and remembrance of Allah.',
      source: 'Diyanet Prayer Guide',
      href: 'https://www.diyanet.gov.tr/en-EN',
      likes: 18,
      likedByMe: false,
      answers: [
        { id: 2001, user: { name: 'Hasan C.', avatar: '👨‍🎓' }, text: 'It is Sunnah to say "Subhana Rabbiyal A\'la" at least three times during sujud.', timestamp: '3 days ago', likes: 5, likedByMe: false },
      ],
    },
    {
      id: 3,
      question: 'What is the central wisdom behind fasting in Ramadan?',
      answer: 'Fasting trains the believer to control desires, cultivate patience, gratitude, and dependence on Allah. It also strengthens mercy, unity, and compassion in society.',
      source: 'Diyanet Qur’an Explanations',
      href: 'https://www.diyanet.gov.tr/en-EN',
      likes: 31,
      likedByMe: false,
      answers: [
        { id: 3001, user: { name: 'Ayşe Y.', avatar: '🧕' }, text: 'Fasting also instills taqwa. The Quran says "Fasting is prescribed for you as it was prescribed for those before you."', timestamp: '5 days ago', likes: 12, likedByMe: false },
        { id: 3002, user: { name: 'Mehmet K.', avatar: '👨‍💻' }, text: 'Fasting strengthens empathy and helps us understand those in need.', timestamp: '4 days ago', likes: 7, likedByMe: false },
      ],
    },
    {
      id: 4,
      question: 'What are the Sunnah practices before Friday prayer?',
      answer: 'Washing, wearing clean clothes, arriving early, finding a clean place, and listening attentively to the khutbah are important Sunnah practices before Jumu’ah.',
      source: 'Diyanet Friday Prayer Guidance',
      href: 'https://www.diyanet.gov.tr/en-EN',
      likes: 9,
      likedByMe: false,
      answers: [],
    },
  ],
};

export const PROJECT_EVENTS = {
  tr: [
    { version: '0.20.0', date: '2026-08-20', notes: ['`upcoming` etkinlik özelliği eklendi', 'Bulut kaynaklarından akış desteği eklendi', 'Bağımlılıklar güncellendi: http-errors@~3.0.0, statuses@~3.0.0'] },
    { version: '0.19.3', date: '2026-04-01', notes: ['Bağımlılıktaki güvenlik açığı düzeltildi', 'Bağımlılık güncellendi: mime@~2.0.0'] },
    { version: '0.19.2', date: '2025-12-15', notes: ['Bağımlılıklar için tilde gösterimi kullanıldı', 'Bağımlılıklar güncellendi: http-errors@~2.0.1, statuses@~2.0.2'] },
    { version: '0.19.1', date: '2024-10-09', notes: ['Bağımlılık güncellendi: encodeurl@~2.0.0'] },
    { version: '0.19.0', date: '2024-09-10', notes: ['Yönlendirme sırasında HTML\'de link oluşturma kaldırıldı'] },
  ],
  en: [
    { version: '0.20.0', date: '2026-08-20', notes: ['Add `upcoming` event feature', 'Add support for streaming from cloud sources', 'deps: http-errors@~3.0.0, statuses@~3.0.0'] },
    { version: '0.19.3', date: '2026-04-01', notes: ['Fix security vulnerability in dependency', 'deps: mime@~2.0.0'] },
    { version: '0.19.2', date: '2025-12-15', notes: ['deps: use tilde notation for dependencies', 'deps: http-errors@~2.0.1, statuses@~2.0.2'] },
    { version: '0.19.1', date: '2024-10-09', notes: ['deps: encodeurl@~2.0.0'] },
    { version: '0.19.0', date: '2024-09-10', notes: ['Remove link renderization in html while redirecting'] },
  ],
};

export const NEWS_ITEMS = {
 tr: [
    { title: 'Türkiye geneli Cuma hutbesi sohbetleri tamamlandı', meta: 'Geçmiş • 12 Ağustos 2026 • Diyanet', accent: '#7BA7FF', place: 'Türkiye', isPast: true },
    { title: 'Ramazan hazırlık programı başladı', meta: 'Geçmiş • 10 Ağustos 2026 • İstanbul', accent: '#F29E6E', place: 'İstanbul', isPast: true },
    { title: 'İstanbul\'da Kur\'an hafızlık sınavları', meta: 'Yaklaşan • 20 Ağustos 2026 • Fatih', accent: '#D9B460', place: 'İstanbul' },
    { title: 'Ankara gençlik ibadet kampı', meta: 'Yaklaşan • 25 Ağustos 2026 • Keçiören', accent: '#5EBE88', place: 'Ankara' },
    { title: 'İzmir namaz ve meditasyon atölyesi', meta: 'Yaklaşan • 1 Eylül 2026 • Konak', accent: '#6DBFFF', place: 'İzmir' },
 ],
 en: [
    { title: 'National Friday sermon discussions completed', meta: 'Past • August 12, 2026 • Diyanet', accent: '#7BA7FF', place: 'Turkey', isPast: true },
    { title: 'Ramadan preparation program launched', meta: 'Past • August 10, 2026 • Istanbul', accent: '#F29E6E', place: 'Istanbul', isPast: true },
    { title: 'Quran hafiz exams in Istanbul', meta: 'Upcoming • August 20, 2026 • Fatih', accent: '#D9B460', place: 'Istanbul' },
    { title: 'Ankara youth worship camp', meta: 'Upcoming • August 25, 2026 • Keçiören', accent: '#5EBE88', place: 'Ankara' },
    { title: 'Prayer and meditation workshop in Izmir', meta: 'Upcoming • September 1, 2026 • Konak', accent: '#6DBFFF', place: 'Izmir' },
 ],
};

// Static fallback for the "Scholars on YouTube" section (used when the
// backend is unreachable). These point at the scholars' CHANNEL pages,
// which always show their latest uploads -- deliberately no per-video IDs
// here so the fallback can never go stale.
export const SCHOLAR_VIDEOS_FALLBACK = [
  { id: 'fb-zakirnaik', kind: 'youtube', title: 'Dr Zakir Naik', source: 'YouTube • Dr Zakir Naik', href: 'https://www.youtube.com/@zakirnaikofficial', accent: '#FF4E45' },
  { id: 'fb-omarsuleiman', kind: 'youtube', title: 'Dr Omar Suleiman', source: 'YouTube • Dr Omar Suleiman', href: 'https://www.youtube.com/@DrOmarSuleiman', accent: '#FF4E45' },
  { id: 'fb-muftimenk', kind: 'youtube', title: 'Mufti Menk', source: 'YouTube • Mufti Menk', href: 'https://www.youtube.com/@MuftiMenk', accent: '#FF4E45' },
  { id: 'fb-freequran', kind: 'youtube', title: 'Free Quran Education', source: 'YouTube • FreeQuranEducation', href: 'https://www.youtube.com/@FreeQuranEducation', accent: '#FF4E45' },
  { id: 'fb-oneislam', kind: 'youtube', title: 'One Islam Productions', source: 'YouTube • One Islam Productions', href: 'https://www.youtube.com/@OneIslamProductions', accent: '#FF4E45' },
  { id: 'fb-nurettinyildiz', kind: 'youtube', title: 'Nurettin Yıldız', source: 'YouTube • Nurettin Yıldız', href: 'https://www.youtube.com/@nureddinyildiz', accent: '#FF4E45' },
  { id: 'fb-mehmedyildiz', kind: 'youtube', title: 'Mehmed Yıldız', source: 'YouTube • Hayalhanem', href: 'https://www.youtube.com/@hayalhanem', accent: '#FF4E45' },
];

export const SCHOLARS = {
  tr: [
    { name: 'Uzm. Dr. Ahmet Yılmaz', role: 'Fıkıh ve ibadet uzmanı', status: 'Çevrimiçi', city: 'İstanbul', speciality: 'Namaz • Zekât', href: 'https://www.diyanet.gov.tr/tr-TR' },
    { name: 'Hoca Mustafa Aslan', role: 'Kur’an ve tefsir eğitmeni', status: 'Hazır', city: 'Ankara', speciality: 'Kıraat • Tefsir', href: 'https://www.diyanet.gov.tr/tr-TR' },
    { name: 'Uzm. Hatice Demir', role: 'Aile ve ibadet danışmanı', status: 'Sohbette', city: 'İzmir', speciality: 'Aile • Dua', href: 'https://www.diyanet.gov.tr/tr-TR' },
  ],
  en: [
    { name: 'Uzm. Dr. Ahmet Yılmaz', role: 'Fiqh and worship specialist', status: 'Online', city: 'Istanbul', speciality: 'Prayer • Zakat', href: 'https://www.diyanet.gov.tr/en-EN' },
    { name: 'Hoca Mustafa Aslan', role: 'Quran and tafsir teacher', status: 'Available', city: 'Ankara', speciality: 'Recitation • Tafsir', href: 'https://www.diyanet.gov.tr/en-EN' },
    { name: 'Uzm. Hatice Demir', role: 'Family and worship advisor', status: 'In session', city: 'Izmir', speciality: 'Family • Du’a', href: 'https://www.diyanet.gov.tr/en-EN' },
  ],
};

export const COMMUNITY_FEATURES = {
  tr: [
    'Türk Müslüman topluluğu üyeliği',
    'Dünya genelindeki Türk ve Türk kökenli Müslümanlar için canlı sohbet',
    'Namaz, ibadet ve sosyal dayanışma takibi',
    'Yerel etkinlik ve iftar buluşmaları',
  ],
  en: [
    'Turkish Muslim community membership',
    'Live chats for Turkish and Turkic Muslims worldwide',
    'Prayer, worship and social support tracking',
    'Local iftar and community events',
  ],
};

export const SOUND_OPTIONS = {
  tr: ['Yüksek Alarm (30 dk)', 'Sistem Varsayılanı', 'Sessiz'],
  en: ['High Alarm (up to 30 min)', 'System Default', 'Silent'],
};

export const COMMUNITY_POSTS = {
  tr: [
    {
      id: 1,
      user: { name: 'Ayşe Y.', avatar: '🧕' },
      text: 'Bu sabah namazında gerçekten huzur buldum. Hepinize tavsiye ederim, namazdan önce 5 dakika sessizce oturup nefesinize odaklanın. 🌅',
      timestamp: '3 saat önce',
      likes: 15,
      likedByMe: false,
      media: null,
      comments: [
        { id: 1001, user: { name: 'Hasan C.', avatar: '👨‍🎓' }, text: 'Harika bir tavsiye! Ben de deneyeceğim.', timestamp: '2 saat önce', likes: 3, likedByMe: false },
        { id: 1002, user: { name: 'Fatma S.', avatar: '👩‍🦰' }, text: 'Aynen katılıyorum, çok faydalı bir uygulama.', timestamp: '1 saat önce', likes: 2, likedByMe: false },
      ],
    },
    {
      id: 2,
      user: { name: 'Mehmet K.', avatar: '👨‍💻' },
      text: 'Cami ziyaretimden bir kare. İstanbul\'daki Süleymaniye Camii\'nin ihtişamı gerçekten büyüleyici. 🕌',
      timestamp: '8 saat önce',
      likes: 32,
      likedByMe: false,
      media: { type: 'image', uri: 'https://images.unsplash.com/photo-1542816417-0983c9c9ad53?w=800' },
      comments: [
        { id: 2001, user: { name: 'Ayşe Y.', avatar: '🧕' }, text: 'Muhteşem bir fotoğraf!', timestamp: '7 saat önce', likes: 5, likedByMe: false },
      ],
    },
    {
      id: 3,
      user: { name: 'Zeynep T.', avatar: '👩‍🎨' },
      text: 'Ramazan ayında yaptığım iftar sofrasından kısa bir video. Hepinize hayırlı iftarlar! 🌙',
      timestamp: '1 gün önce',
      likes: 21,
      likedByMe: false,
      media: { type: 'video', uri: 'https://www.w3schools.com/html/mov_bbb.mp4' },
      comments: [],
    },
  ],
  en: [
    {
      id: 1,
      user: { name: 'Aisha Y.', avatar: '🧕' },
      text: 'I found real peace in this morning\'s prayer. I recommend to all of you, sit quietly for 5 minutes and focus on your breath before prayer. 🌅',
      timestamp: '3 hours ago',
      likes: 15,
      likedByMe: false,
      media: null,
      comments: [
        { id: 1001, user: { name: 'Hasan C.', avatar: '👨‍🎓' }, text: 'Great advice! I will try it too.', timestamp: '2 hours ago', likes: 3, likedByMe: false },
        { id: 1002, user: { name: 'Fatma S.', avatar: '👩‍🦰' }, text: 'I agree, it\'s a very useful practice.', timestamp: '1 hour ago', likes: 2, likedByMe: false },
      ],
    },
    {
      id: 2,
      user: { name: 'Mehmet K.', avatar: '👨‍💻' },
      text: 'A snapshot from my mosque visit. The grandeur of the Süleymaniye Mosque in Istanbul is truly mesmerizing. 🕌',
      timestamp: '8 hours ago',
      likes: 32,
      likedByMe: false,
      media: { type: 'image', uri: 'https://images.unsplash.com/photo-1542816417-0983c9c9ad53?w=800' },
      comments: [
        { id: 2001, user: { name: 'Aisha Y.', avatar: '🧕' }, text: 'A magnificent photo!', timestamp: '7 hours ago', likes: 5, likedByMe: false },
      ],
    },
    {
      id: 3,
      user: { name: 'Zeynep T.', avatar: '👩‍🎨' },
      text: 'A short video from my iftar table during Ramadan. Blessed iftar to all of you! 🌙',
      timestamp: '1 day ago',
      likes: 21,
      likedByMe: false,
      media: { type: 'video', uri: 'https://www.w3schools.com/html/mov_bbb.mp4' },
      comments: [],
    },
  ],
};