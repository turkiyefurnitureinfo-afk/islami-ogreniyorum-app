/**
 * AI Answer Module for "İslam nasıl öğrenilir" (How to Learn Islam)
 *
 * Provides two answer sources, in priority order:
 *   1. Google Custom Search JSON API (when GOOGLE_API_KEY + GOOGLE_CX are set in .env)
 *      — answers are built from real, up-to-date Google results with source links.
 *   2. Built-in Islamic knowledge engine (offline fallback)
 */

const { searchGoogle } = require('./google-search');
const { getGeminiAnswer } = require('./gemini-answer');

// ---------- Turkish character normalization for keyword matching ----------
function normalize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[çÇ]/g, 'c')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[ıİ]/g, 'i')
    .replace(/[öÖ]/g, 'o')
    .replace(/[şŞ]/g, 's')
    .replace(/[üÜ]/g, 'u')
    .replace(/[âÂ]/g, 'a') // e.g. "Zekât" -> "zekat"
    .replace(/[îÎ]/g, 'i')
    .replace(/[ûÛ]/g, 'u')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- Built-in knowledge base ----------
const KNOWLEDGE_BASE = [
  {
    keywords: ['namaz', 'prayer', 'salat', 'vakit', 'time', 'kaza', 'sunnah', 'sunnet', 'huşu', 'khushu', 'secde', 'ruku', 'abdest', 'teyemmum'],
    tr: 'Namaz, İslam’ın beş şartından biridir ve günde beş vakit farz kılınmıştır. Namazın kabulü için temizlik (abdest), kıbleye yönelmek, setr-i avret (örtünme), vakit, niyet, iftitah tekbiri, kıyam, kıraat, rükû ve secde gibi şartlar gereklidir. Namazda huşuyu artırmak için namaza başlamadan önce zihni dünyevi düşüncelerden arındırmak, okunan surelerin manasını düşünmek ve Allah ile baş başa olduğunu hissetmek tavsiye edilir. Kaynak: Diyanet İşleri Başkanlığı.',
    en: 'Prayer (Salah) is one of the five pillars of Islam and is obligatory five times a day. Valid prayer requires purification (wudu), facing the qibla, covering the awrah, proper time, intention (niyyah), the opening takbir, standing (qiyam), recitation, bowing (ruku), and prostration (sujud). To increase khushu (concentration), clear your mind of worldly concerns before beginning, reflect on the meaning of the verses you recite, and feel that you are alone with Allah. Source: Diyanet.',
  },
  {
    keywords: ['oruç', 'fasting', 'ramazan', 'ramadan', 'sahur', 'iftar', 'kefaret', 'fidye'],
    tr: 'Oruç, İslam’ın beş şartından biridir ve Ramazan ayında farz kılınmıştır. Oruç, insanı nefsini kontrol etmeye, sabra, şükre ve Allah’a olan muhtaçlığı derinden hissetmeye yönlendirir. Aynı zamanda toplumda merhamet, dayanışma ve fedakârlık duygusunu güçlendirir. Sahur, oruca niyetle birlikte bereket vesilesi kabul edilir. Kaynak: Diyanet İşleri Başkanlığı.',
    en: 'Fasting (Sawm) is one of the five pillars of Islam and is obligatory during the month of Ramadan. Fasting trains the believer to control desires, cultivate patience, gratitude, and deep dependence on Allah. It also strengthens mercy, unity, and compassion in society. Suhoor, along with intention (niyyah), is considered a source of blessing. Source: Diyanet.',
  },
  {
    keywords: ['zekat', 'zakat', 'sadaka', 'sadaqah', 'infak', 'nisap', 'vergi'],
    tr: 'Zekâtın farz olması için kişinin Müslüman, aklı başında, hür ve nisap miktarına ulaşan mal sahibi olması gerekir. Malın üzerinden bir yıl geçmiş olması da önemli bir şarttır. Zekât, malı arındırır ve toplumda sosyal adaleti sağlar. Sadaka ise kişinin imkânına göre kendiliğinden verdiği gönüllü bir yardımdır. Kaynak: Diyanet İşleri Başkanlığı.',
    en: 'For Zakat to be obligatory, a person must be Muslim, sound in mind, free, and possess wealth reaching the nisab threshold. The wealth must also have remained for one lunar year. Zakat purifies wealth and establishes social justice. Sadaqah (charity) is voluntary giving according to one’s means. Source: Diyanet.',
  },
  {
    keywords: ['cuma', 'friday', 'hutbe', 'khutbah', 'jumua'],
    tr: 'Cuma namazı, Müslüman erkeklere haftada bir kez farz kılınmıştır. Cuma günü abdest almak, temiz giyinmek, erken gelmek, camiye gitmeden önce gusül almak ve hutbeyi dikkatle dinlemek önemli sünnetlerdendir. Cuma namazı, toplumsal birlik ve ibadet bilinci için büyük bir fırsattır. Kaynak: Diyanet İşleri Başkanlığı.',
    en: 'Friday (Jumu\'ah) prayer is obligatory weekly for Muslim men. Recommended Sunnahs include taking a shower (ghusl), wearing clean clothes, arriving early, and listening attentively to the khutbah (sermon). The Friday prayer is a great opportunity for community unity and worship awareness. Source: Diyanet.',
  },
  {
    keywords: ['kuran', 'quran', 'kur an', 'kuran-ı kerim', 'tefsir', 'tafsir', 'ayet', 'ayah', 'sure', 'surah', 'tilavet', 'kıraat'],
    tr: 'Kur\'an-ı Kerim, Allah’ın insanlığa gönderdiği son ilahi kitaptır. Okunması, anlaşılması ve hayata uygulanması ibadettir. Anlamını bilerek okumak ve tefsir kaynaklarından öğrenmek tavsiye edilir. Kur\'an\'a temiz bir şekilde el sürmek için abdest almak gerekir. Kaynak: Diyanet İşleri Başkanlığı.',
    en: 'The Holy Quran is the final divine book sent by Allah to humanity. Reciting, understanding, and applying it to life are acts of worship. It is recommended to read with understanding and learn from tafsir (exegesis) sources. Wudu (ablution) is required to touch the Quran. Source: Diyanet.',
  },
  {
    keywords: ['hadis', 'hadith', 'sünnet', 'sunnah', 'peygamber', 'prophet', 'hz muhammed'],
    tr: 'Hadis, Peygamber Efendimiz Hz. Muhammed’in (s.a.v.) söz, fiil ve onaylarını kapsayan dini kaynaklardır. Sünnet, Kur\'an\'ın uygulamalı yaşam biçimidir ve Müslümanların hayatında rehberdir. Hadislerin güvenilirliği, sened ve metin tenkidiyle değerlendirilir. Kaynak: Diyanet Hadis Külliyatı.',
    en: 'Hadith refers to the sayings, actions, and approvals of Prophet Muhammad (peace be upon him). The Sunnah is the practical application of the Quran and serves as a guide for Muslims. The reliability of hadiths is assessed through chains of transmission and textual criticism. Source: Diyanet Hadith Collections.',
  },
  {
    keywords: ['abdest', 'wudu', 'gusül', 'ghusl', 'taharet', 'temizlik', 'teyemmüm', 'tayammum'],
    tr: 'Abdest, namaz gibi ibadetlerden önce yapılan temizliktir. Yüzü, elleri dirseklerle birlikte yıkamak, başı mesh etmek ve ayakları topuklarla birlikte yıkamak farzdır. Gusül (boy abdesti), cünüplük hali gibi durumlarda farz olur. Su bulunamayan durumlarda teyemmüm ile ibadet yapılabilir. Kaynak: Diyanet İşleri Başkanlığı.',
    en: 'Wudu (ablution) is the purification performed before acts of worship such as prayer. It is obligatory to wash the face, arms to the elbows, wipe the head, and wash the feet to the ankles. Ghusl (full ablution) is required in states of major impurity. When water is unavailable, tayammum (dry ablution) may be performed. Source: Diyanet.',
  },
  {
    keywords: ['komşu', 'neighbor', 'komşu hakkı', 'rights of neighbors', 'akraba', 'aile', 'family', 'ebeveyn', 'parents', 'evlilik', 'marriage'],
    tr: 'İslam’da komşuluk hakları çok önemlidir. Peygamberimiz (s.a.v.) komşusu açken tok yatan kimseyi tam mümin olarak görmemiştir. Komşuya iyilik etmek, zarar vermemek, hastalığında ziyaret etmek ve ihtiyaçlarında yardımcı olmak temel görevlerdendir. Aile ve akraba bağlarını korumak da büyük sevaptır. Kaynak: Diyanet İşleri Başkanlığı.',
    en: 'Neighbor rights are highly important in Islam. The Prophet (peace be upon him) did not consider one who sleeps full while his neighbor is hungry a complete believer. Being kind to neighbors, not harming them, visiting them when sick, and helping them in need are fundamental duties. Maintaining family and kinship ties is also greatly rewarded. Source: Diyanet.',
  },
  {
    keywords: ['hac', 'hajj', 'umre', 'umrah', 'kabe', 'kaaba', 'tavaf', 'tawaf'],
    tr: 'Hac, gücü yeten Müslümanlara ömürde bir kez farz kılınmıştır. Hac döneminde ihram giyilir, Kâbe tavaf edilir, Safa ile Merve arasında sa\'y yapılır ve Arafat\'ta vakfe durulur. Umre ise yılın herhangi bir zamanında yapılabilen ziyaret ibadetidir. Kaynak: Diyanet İşleri Başkanlığı.',
    en: 'Hajj is obligatory once in a lifetime for Muslims who are physically and financially able. During Hajj, pilgrims wear ihram, circumambulate the Kaaba (tawaf), perform sa\'y between Safa and Marwah, and stand at Arafat. Umrah is a visitation worship that can be performed at any time of the year. Source: Diyanet.',
  },
  {
    keywords: ['dua', 'supplication', 'dilek', 'istek', 'zikir', 'dhikr', 'tesbih', 'salavat'],
    tr: 'Dua, kulun Allah ile iletişim kurma yoludur. İbadetlerin özü kabul edilir. Duanın kabulü için samimiyet, içtenlik ve ısrarcı olmak önemlidir. Zikir, Allah adını anmak ve kalbi Allah ile bağlamaktır. Sabah-akşam çekilen tesbihler ve salavatlar Müslümanların günlük hayatında büyük yere sahiptir. Kaynak: Diyanet İşleri Başkanlığı.',
    en: 'Du\'a (supplication) is the believer\'s means of communication with Allah and is considered the essence of worship. Sincerity, earnestness, and persistence are important for acceptance. Dhikr is the remembrance of Allah that connects the heart to Him. Daily tasbih (glorification) and salawat (blessings upon the Prophet) hold a great place in the daily life of Muslims. Source: Diyanet.',
  },
  {
    keywords: ['tesettür', 'hijab', 'hicab', 'örtünme', 'kadın', 'woman', 'kadın hakları'],
    tr: 'Tesettür, İslam\'da hem kadın hem erkek için edep ve örtünme kurallarını kapsar. Kadınlar için yüz ve eller dışındaki bedenin örtülmesi farzdır. Tesettür, dış görünüşten önce bir tevazu ve edep bilincidir; kişinin toplum içinde saygınlığını korur. Kaynak: Diyanet İşleri Başkanlığı.',
    en: 'Hijab (modest dress) in Islam covers guidelines of modesty and covering for both men and women. For women, covering the body except the face and hands is obligatory. Modest dress is first a consciousness of humility and propriety, preserving one\'s dignity in society. Source: Diyanet.',
  },
  {
    keywords: ['ölüm', 'death', 'cenaze', 'funeral', 'taziye', 'vefat', 'kabir'],
    tr: 'İslam\'da ölüm, dünya hayatının sonu ve ahiret hayatının başlangıcıdır. Cenaze namazı, Müslüman toplumun farz-ı kifaye görevidir. Cenaze yıkanır, kefenlenir ve namazı kılınarak defnedilir. Taziyede sabır tavsiye edilir, ölünün arkasından dua edilir ve hayır işleri yapılır. Kaynak: Diyanet İşleri Başkanlığı.',
    en: 'In Islam, death is the end of worldly life and the beginning of the afterlife. The funeral prayer (Salat al-Janazah) is a communal obligation (fard kifayah). The deceased is washed, shrouded, prayed over, and buried. Patience is advised in condolence, prayers are made for the deceased, and good deeds are performed on their behalf. Source: Diyanet.',
  },
];

const GENERIC_TR =
  'İslam nasıl öğrenilir asistanı olarak bu konuda net bir kaynağa ulaşamadım. ' +
  'En doğru bilgi için Diyanet İşleri Başkanlığı\'na danışabilir veya soruyu toplulukla paylaşabilirsin. ' +
  'Namaz vakitleri, zekât, oruç ve temel ibadetler hakkında da soru sorabilirsin.';

const GENERIC_EN =
  'As an assistant for How to Learn Islam, I could not find a definitive source on this topic. ' +
  'For the most accurate guidance, please consult Diyanet (Turkish Presidency of Religious Affairs) or share ' +
  'your question with the community. You can also ask me about prayer times, zakat, fasting, and basic worship.';

// ---------- Built-in answer engine ----------
function builtInAnswer(question, language) {
  const normalizedQuestion = normalize(question);

  let bestMatch = null;
  let bestScore = 0;

  for (const entry of KNOWLEDGE_BASE) {
    let score = 0;
    for (const keyword of entry.keywords) {
      const normalizedKeyword = normalize(keyword);
      if (normalizedKeyword.length <= 2) continue;
      if (normalizedQuestion.includes(normalizedKeyword)) {
        score += normalizedKeyword.length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = entry;
    }
  }

  if (!bestMatch || bestScore < 5) {
    return language === 'tr' ? GENERIC_TR : GENERIC_EN;
  }

  return language === 'tr' ? bestMatch.tr : bestMatch.en;
}

// ---------- Google Custom Search integration ----------
async function getGoogleAnswer(question, language) {
  const result = await searchGoogle(question, language);
  if (!result) return null;

  return {
    answer: result.answer,
    source: result.source,
    href: result.href,
  };
}

/**
 * Get the best available AI answer for a community question.
 *
 * Answers are fetched from the Google Programmable Search Engine JSON API
 * (real, verifiable web sources with links). If Google is not configured or
 * the request fails, we fall back to the built-in oracle engine.
 *
 * @param {string} question - the user's question
 * @param {string} language - 'tr' or 'en'
 * @returns {Promise<{answer: string, source?: string, href?: string, provider: 'google'|'builtin'}>}
 */
async function getAIAnswer(question, language = 'tr') {
  // Input validation and sanitization
  if (!question || typeof question !== 'string') {
    throw new Error('Question must be a non-empty string');
  }
  
  // Validate language parameter
  const validLanguages = ['tr', 'en'];
  if (!validLanguages.includes(language)) {
    language = 'tr'; // default to Turkish
  }
  
  const sanitizedQuestion = question.trim();
  if (sanitizedQuestion.length < 2) {
    throw new Error('Question is too short');
  }

  // Priority 1: Google Gemini (free-tier generative AI, best quality)
  let geminiAnswer = null;
  try {
    geminiAnswer = await getGeminiAnswer(sanitizedQuestion, language);
  } catch (error) {
    console.error('[getAIAnswer] Gemini failed:', error.message);
    // Continue to Google fallback
  }

  if (geminiAnswer) {
    return {
      answer: geminiAnswer.answer,
      provider: geminiAnswer.provider,
    };
  }

  // Priority 2: Google Custom Search (real, sourced results)
  let googleAnswer = null;
  try {
    googleAnswer = await getGoogleAnswer(sanitizedQuestion, language);
  } catch (error) {
    console.error('[getAIAnswer] Google search failed:', error.message);
    // Continue to built-in fallback
  }

  if (googleAnswer) {
    return {
      answer: googleAnswer.answer,
      source: googleAnswer.source,
      href: googleAnswer.href,
      provider: 'google',
    };
  }

  // Priority 3: offline knowledge engine
  return {
    answer: builtInAnswer(sanitizedQuestion, language),
    provider: 'builtin',
  };
}

module.exports = { getAIAnswer, builtInAnswer };