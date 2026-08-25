/**
 * News & Events Collector for "İslam nasıl öğrenilir"
 *
 * Collects real, verifiable Islamic news/event information from reliable
 * Turkish Muslim websites. Data is gathered from each source's public RSS/JSON
 * feed, normalized into the shape the app's News tab expects, and cached
 * in memory to avoid hammering the sources.
 *
 * Reliable Turkish Islamic sources currently used:
 *   1. Diyanet Haber (the official news outlet of Diyanet İşleri Başkanlığı)
 *        feed:  https://www.diyanethaber.com.tr/rss
 *        (verified working — returns up-to-date Diyanet news/events in Turkish)
 *   2. (You can add more feeds below, e.g. Türkiye Diyanet Vakfı at tdv.org)
 *
 * IMPORTANT legal/robots note:
 *   - Only public RSS/JSON feeds are used (the safe, standard way to reuse
 *     third-party content without violating terms of service).
 *   - Each item keeps a link back to the original article and is attributed
 *     to the source.
 */

// List of feeds to poll. Add or remove sources freely.
const SOURCES = [
  {
    id: 'diyanethaber',
    name: 'Diyanet Haber',
    feed: 'https://www.diyanethaber.com.tr/rss',
    accent: '#7BA7FF',
  },
  // Example extra source (uncomment once you confirm a public feed URL):
  // {
  //   id: 'tdv',
  //   name: 'Türkiye Diyanet Vakfı',
  //   feed: 'https://www.tdv.org/feed/',
  //   accent: '#5EBE88',
  // },
];

// Simple XML unescaping for CDATA / entities found in RSS.
function decodeEntities(str) {
  return String(str || '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

// Very small RSS parser (no external dependency). Extracts channel <item>s.
function parseRSS(xml) {
  const items = [];
  // Match each <item>...</item> block.
  const itemRegex = /<item[\s\S]*?<\/item>/gi;
  const tag = (block, name) => {
    const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
    return m ? decodeEntities(m[1].trim()) : '';
  };

  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[0];
    const title = tag(block, 'title');
    const link = tag(block, 'link');
    const description = tag(block, 'description');
    const pubDate = tag(block, 'pubDate');
    items.push({ title, link, description, pubDate });
  }
  return items;
}

// ---------------------------------------------------------------------------
// YouTube scholar channels ("live Islamic messages from great scholars")
//
// YouTube exposes a FREE public RSS feed per channel -- no API key required:
//     https://www.youtube.com/feeds/videos.xml?channel_id=<CHANNEL_ID>
// These are Atom feeds (<entry> + <link rel="alternate" href="..."/>), so we
// parse them with a small dedicated parser below.
//
// All channel IDs below were resolved from the official handle URLs and
// VERIFIED working (HTTP 200 + real entries) before being added here.
// ---------------------------------------------------------------------------
const YOUTUBE_CHANNELS = [
  // --- International ---
  { id: 'zakirnaik', name: 'Dr Zakir Naik', channelId: 'UC3YmP7nqf514I1zh1eVbzrA' },
  { id: 'omarsuleiman', name: 'Dr Omar Suleiman', channelId: 'UClQjVZ2fue6XYSSJAo86xQA' },
  { id: 'muftimenk', name: 'Mufti Menk', channelId: 'UCMnInhD_Azd2ICGMKbHMsCg' },
  { id: 'freequran', name: 'Free Quran Education', channelId: 'UCNdUFOtzSx3FS71pHkQLxhQ' },
  { id: 'oneislam', name: 'One Islam Productions', channelId: 'UCHee3lecooc33pfTtg_HB8w' },
  // --- Türk âlimler ---
  { id: 'nurettinyildiz', name: 'Nurettin Yıldız', channelId: 'UC5V_BTDvg_aOYZos9Cyb4Rg' },
  { id: 'mehmedyildiz', name: 'Mehmed Yıldız', channelId: 'UCXs8nFqUPQaJZxAt1b3Wblw' },
];

const MAX_VIDEOS_PER_CHANNEL = 3;

// Parse a YouTube Atom feed into [{ videoId, title, published, channel }].
function parseYouTubeFeed(xml, fallbackChannelName) {
  const entries = [];
  const entryRegex = /<entry[\s\S]*?<\/entry>/gi;
  const tag = (block, name) => {
    const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
    return m ? decodeEntities(m[1].trim()) : '';
  };
  let match;
  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[0];
    const videoId = tag(block, 'yt:videoId');
    const title = tag(block, 'title');
    const published = tag(block, 'published');
    // Per-entry author name (nested one level deeper than simple tags)
    const am = block.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/i);
    entries.push({
      videoId,
      title,
      published,
      channel: am ? decodeEntities(am[1].trim()) : fallbackChannelName,
    });
  }
  return entries.filter((e) => e.videoId && e.title);
}

const MONTHS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatDate(date, language) {
  const months = language === 'en' ? MONTHS_EN : MONTHS_TR;
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

// In-memory cache for scholar videos (same TTL strategy as news).
const videoCache = { items: [], lastFetched: 0 };

/**
 * Collect the latest videos from the configured Islamic scholar channels.
 * @param {string} language - 'tr' or 'en' (only affects date labels)
 * @returns {Promise<Array>} items shaped for the app's News tab
 */
async function collectScholarVideos(language = 'tr') {
  if (videoCache.items.length > 0 && Date.now() - videoCache.lastFetched < CACHE_TTL_MS) {
    return videoCache.items;
  }

  const all = [];
  for (const channel of YOUTUBE_CHANNELS) {
    try {
      const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.channelId}`;
      const response = await fetch(url, { headers: { Accept: 'application/atom+xml, text/xml, */*' } });
      if (!response.ok) {
        console.error(`YouTube feed error for ${channel.name}:`, response.status);
        continue;
      }
      const xml = await response.text();
      const entries = parseYouTubeFeed(xml, channel.name).slice(0, MAX_VIDEOS_PER_CHANNEL);
      for (const entry of entries) {
        const date = entry.published ? new Date(entry.published) : new Date();
        all.push({
          id: `yt-${channel.id}-${entry.videoId}`,
          kind: 'youtube',
          title: entry.title,
          meta: formatDate(date, language),
          href: `https://www.youtube.com/watch?v=${entry.videoId}`,
          channelHref: `https://www.youtube.com/channel/${channel.channelId}`,
          source: entry.channel || channel.name,
          accent: '#FF4E45', // YouTube red
          rawDate: date.getTime(),
        });
      }
    } catch (error) {
      console.error(`YouTube fetch failed for ${channel.name}:`, error.message);
    }
  }

  all.sort((a, b) => (b.rawDate || 0) - (a.rawDate || 0));

  videoCache.items = all;
  videoCache.lastFetched = Date.now();
  return all;
}

// Turn a raw feed item into the shape the app's News tab displays.
function normalizeItem(raw, source, index) {
  const title = raw.title || 'Duyuru';
  const date = raw.pubDate ? new Date(raw.pubDate) : new Date();
  const now = new Date();
  const isPast = date <= now;

  const day = date.getDate();
  const month = MONTHS_TR[date.getMonth()];
  const year = date.getFullYear();
  const dateStr = `${day} ${month} ${year}`;

  return {
    id: `${source.id}-${index}`,
    title,
    meta: `${isPast ? 'Haber' : 'Yaklaşan'} • ${dateStr} • ${source.name}`,
    accent: source.accent,
    place: 'Türkiye',
    isPast,
    href: raw.link || null,
    source: source.name,
    // keep the raw date so we can sort newest-first
    rawDate: date.getTime(),
  };
}

const MONTHS_TR = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

// In-memory cache with a time-to-live (ms). Refresh once per 10 minutes.
const cache = { items: [], lastFetched: 0 };
const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Fetch all configured feeds and return normalized news items.
 * Uses the cache so we don't hammer the sources on every request.
 * @returns {Promise<Array>}
 */
async function collectNews() {
  if (cache.items.length > 0 && Date.now() - cache.lastFetched < CACHE_TTL_MS) {
    return cache.items;
  }

  const all = [];

  for (const source of SOURCES) {
    try {
      const response = await fetch(source.feed, { headers: { Accept: 'application/rss+xml, text/xml, */*' } });
      if (!response.ok) {
        console.error(`News feed error for ${source.name}:`, response.status);
        continue;
      }
      const xml = await response.text();
      const items = parseRSS(xml).slice(0, 10); // take the latest 10 per source
      const normalized = items.map((item, i) => normalizeItem(item, source, i));
      all.push(...normalized);
    } catch (error) {
      console.error(`News fetch failed for ${source.name}:`, error.message);
    }
  }

  // Sort newest first by the raw publication date.
  all.sort((a, b) => (b.rawDate || 0) - (a.rawDate || 0));

  cache.items = all;
  cache.lastFetched = Date.now();
  return all;
}

module.exports = { collectNews, collectScholarVideos, parseRSS, parseYouTubeFeed };