#!/usr/bin/env node
// Fetches "now reading" (Hardcover) and "now / last listening" (Last.fm) and
// writes the merged result to src/data/now.json. Designed to be run by a
// scheduled GitHub Action; on per-source failure it preserves the previous
// value rather than blanking the site.
//
// Required env (set as repo secrets in CI, or in a local .env for testing):
//   LASTFM_API_KEY      - https://www.last.fm/api/account/create
//   LASTFM_USERNAME     - your Last.fm handle
//   GOODREADS_USER_ID   - numeric portion of your goodreads.com/user/show/<id> URL
//   LETTERBOXD_USERNAME - your letterboxd.com/<username> handle
//
// Any missing key just disables that source.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = resolve(__dirname, '..', 'src', 'data', 'now.json');

async function readPrevious() {
  try {
    return JSON.parse(await readFile(DATA_PATH, 'utf8'));
  } catch {
    return null;
  }
}

async function fetchListening() {
  const apiKey = process.env.LASTFM_API_KEY;
  const user = process.env.LASTFM_USERNAME;
  if (!apiKey || !user) {
    console.warn('[now] Last.fm env missing; skipping listening');
    return null;
  }
  const url = new URL('https://ws.audioscrobbler.com/2.0/');
  url.searchParams.set('method', 'user.getrecenttracks');
  url.searchParams.set('user', user);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Last.fm ${res.status}`);
  const json = await res.json();
  const track = json?.recenttracks?.track?.[0];
  if (!track) return null;
  const nowPlaying = track['@attr']?.nowplaying === 'true';
  const playedAt = track.date?.uts
    ? new Date(Number(track.date.uts) * 1000).toISOString()
    : null;
  return {
    track: track.name ?? null,
    artist: track.artist?.['#text'] ?? null,
    album: track.album?.['#text'] || null,
    url: track.url ?? null,
    image: pickLastfmImage(track.image),
    playedAt,
    nowPlaying,
  };
}

// Last.fm returns an array of {'#text': url, size}. Prefer the largest, and
// drop the generic "no art" star placeholder so the card stays imageless
// rather than showing a meaningless grey star.
const LASTFM_PLACEHOLDER = '2a96cbd8b46e442fc41c2b86b821562f';
function pickLastfmImage(images) {
  if (!Array.isArray(images)) return null;
  for (const size of ['extralarge', 'large', 'medium', 'small']) {
    const found = images.find((i) => i.size === size && i['#text']);
    if (found) {
      return found['#text'].includes(LASTFM_PLACEHOLDER) ? null : found['#text'];
    }
  }
  return null;
}

// Pulls a single <item>...</item> field, with or without a CDATA wrapper.
// Goodreads RSS wraps most fields in CDATA but a few (like pubDate) aren't.
function rssField(itemXml, tag) {
  const re = new RegExp(
    `<${tag}>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*</${tag}>`,
  );
  const m = itemXml.match(re);
  if (!m) return null;
  const value = m[1].trim();
  return value.length ? value : null;
}

function toIso(rfc822) {
  if (!rfc822) return null;
  const d = new Date(rfc822);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function fetchReading() {
  const userId = process.env.GOODREADS_USER_ID;
  if (!userId) {
    console.warn('[now] Goodreads env missing; skipping reading');
    return null;
  }
  const url = `https://www.goodreads.com/review/list_rss/${userId}?shelf=currently-reading`;
  const res = await fetch(url, {
    // Goodreads sometimes 403s requests without a UA string.
    headers: { 'user-agent': 'pedrocastro.eu/1.0 (+https://pedrocastro.eu)' },
  });
  if (!res.ok) throw new Error(`Goodreads ${res.status}`);
  const xml = await res.text();
  const firstItem = xml.match(/<item>([\s\S]*?)<\/item>/);
  if (!firstItem) return null;
  const item = firstItem[1];
  const title = rssField(item, 'title');
  const author = rssField(item, 'author_name');
  const link = rssField(item, 'link');
  // Prefer the date the user started this book; fall back to date added.
  const startedAt =
    toIso(rssField(item, 'user_date_started')) ??
    toIso(rssField(item, 'user_date_added')) ??
    toIso(rssField(item, 'pubDate'));
  const cover =
    rssField(item, 'book_large_image_url') ??
    rssField(item, 'book_medium_image_url') ??
    rssField(item, 'book_small_image_url');
  if (!title) return null;
  return {
    title,
    author: author || null,
    url: link ? link.split('?')[0] : null,
    cover: cover || null,
    startedAt,
  };
}

// The Letterboxd RSS feed mixes diary entries, reviews and list activity, and
// is ordered by when each entry was *logged* — not when the film was watched.
// We want the film with the latest watchedDate, so a film logged today but
// watched years ago doesn't trump one actually watched more recently.
async function fetchWatching() {
  const user = process.env.LETTERBOXD_USERNAME;
  if (!user) {
    console.warn('[now] Letterboxd env missing; skipping watching');
    return null;
  }
  const url = `https://letterboxd.com/${user}/rss/`;
  const res = await fetch(url, {
    headers: { 'user-agent': 'pedrocastro.eu/1.0 (+https://pedrocastro.eu)' },
  });
  if (!res.ok) throw new Error(`Letterboxd ${res.status}`);
  const xml = await res.text();

  let best = null;
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRe.exec(xml)) !== null) {
    const item = match[1];
    const watchedDate = rssField(item, 'letterboxd:watchedDate');
    // Only diary entries carry a watchedDate; reviews/list edits don't.
    if (!watchedDate) continue;
    const watchedAt = toIso(watchedDate);
    if (!watchedAt) continue;
    if (best && watchedAt <= best.watchedAt) continue;

    const ratingRaw = rssField(item, 'letterboxd:memberRating');
    const rating = ratingRaw != null ? Number(ratingRaw) : null;
    // The poster is only available as an <img> inside the description HTML.
    const poster = rssField(item, 'description')?.match(/<img[^>]+src="([^"]+)"/)?.[1];
    best = {
      title: rssField(item, 'letterboxd:filmTitle'),
      year: rssField(item, 'letterboxd:filmYear'),
      rating: Number.isFinite(rating) ? rating : null,
      rewatch: rssField(item, 'letterboxd:rewatch') === 'Yes',
      url: rssField(item, 'link'),
      poster: poster || null,
      watchedAt,
    };
  }

  if (!best?.title) return null;
  return best;
}

async function safe(label, fn, fallback) {
  try {
    const value = await fn();
    return value ?? fallback;
  } catch (err) {
    console.error(`[now] ${label} failed:`, err.message);
    return fallback;
  }
}

const previous = await readPrevious();

const listening = await safe('listening', fetchListening, previous?.listening ?? null);
const reading = await safe('reading', fetchReading, previous?.reading ?? null);
const watching = await safe('watching', fetchWatching, previous?.watching ?? null);

const next = {
  updatedAt: new Date().toISOString(),
  listening: listening ?? {
    track: null, artist: null, album: null, url: null, image: null, playedAt: null, nowPlaying: false,
  },
  reading: reading ?? {
    title: null, author: null, url: null, cover: null, startedAt: null,
  },
  watching: watching ?? {
    title: null, year: null, rating: null, rewatch: false, url: null, poster: null, watchedAt: null,
  },
};

await writeFile(DATA_PATH, JSON.stringify(next, null, 2) + '\n');
console.log('[now] wrote', DATA_PATH);
