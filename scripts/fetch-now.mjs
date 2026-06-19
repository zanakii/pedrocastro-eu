#!/usr/bin/env node
// Fetches recent listening (Last.fm), reading (Goodreads) and watching
// (Letterboxd) and writes two files:
//   src/data/now.json   - the single latest item per type (the *Now* section)
//   src/data/media.json - the most recent ~20 per type (the /media/ timeline)
//
// Designed to be run by a scheduled GitHub Action; on per-source failure it
// preserves the previous value rather than blanking the site.
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
const DATA_DIR = resolve(__dirname, '..', 'src', 'data');
const NOW_PATH = resolve(DATA_DIR, 'now.json');
const MEDIA_PATH = resolve(DATA_DIR, 'media.json');

const MEDIA_LIMIT = 20; // items kept per type in the timeline

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Last.fm — recent listening
// ---------------------------------------------------------------------------

// Last.fm's API returns track/artist URLs with `+` for spaces, but their web
// server returns 406 Not Acceptable for `+` in the URL *path* (in a path, `+`
// is a literal plus, not a space). Re-encoding `+` as `%20` makes the links
// resolve. Literal pluses in names come back as `%2B`, so this is safe.
function fixLastfmUrl(url) {
  return url ? url.replace(/\+/g, '%20') : null;
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

function normalizeTrack(track) {
  const nowPlaying = track['@attr']?.nowplaying === 'true';
  const playedAt = track.date?.uts
    ? new Date(Number(track.date.uts) * 1000).toISOString()
    : null;
  return {
    track: track.name ?? null,
    artist: track.artist?.['#text'] ?? null,
    album: track.album?.['#text'] || null,
    url: fixLastfmUrl(track.url),
    image: pickLastfmImage(track.image),
    playedAt,
    nowPlaying,
  };
}

// Collapse runs of the same track played back-to-back into a single entry, so
// a song looped five times doesn't fill the timeline.
function dedupeConsecutive(tracks) {
  const out = [];
  for (const t of tracks) {
    const prev = out[out.length - 1];
    if (prev && prev.track === t.track && prev.artist === t.artist) continue;
    out.push(t);
  }
  return out;
}

async function fetchMusicList() {
  const apiKey = process.env.LASTFM_API_KEY;
  const user = process.env.LASTFM_USERNAME;
  if (!apiKey || !user) {
    console.warn('[feeds] Last.fm env missing; skipping listening');
    return null;
  }
  const url = new URL('https://ws.audioscrobbler.com/2.0/');
  url.searchParams.set('method', 'user.getrecenttracks');
  url.searchParams.set('user', user);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '30'); // headroom for dedupe down to MEDIA_LIMIT
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Last.fm ${res.status}`);
  const json = await res.json();
  const tracks = json?.recenttracks?.track;
  if (!Array.isArray(tracks) || tracks.length === 0) return null;
  return dedupeConsecutive(tracks.map(normalizeTrack)).slice(0, MEDIA_LIMIT);
}

// ---------------------------------------------------------------------------
// RSS helpers (Goodreads + Letterboxd)
// ---------------------------------------------------------------------------

// Pulls a single field out of an <item>...</item> block, with or without a
// CDATA wrapper. Goodreads wraps most fields in CDATA but a few (like pubDate)
// aren't.
function rssField(itemXml, tag) {
  const re = new RegExp(
    `<${tag}>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*</${tag}>`,
  );
  const m = itemXml.match(re);
  if (!m) return null;
  const value = m[1].trim();
  return value.length ? value : null;
}

function eachItem(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
}

function toIso(rfc822) {
  if (!rfc822) return null;
  const d = new Date(rfc822);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ---------------------------------------------------------------------------
// Goodreads — currently reading (Now) + read shelf (Media)
// ---------------------------------------------------------------------------

function goodreadsBook(item) {
  const title = rssField(item, 'title');
  if (!title) return null;
  // The RSS <link> points at the *review* page; link to the book itself instead,
  // built from book_id. Fall back to the review link if book_id is ever absent.
  const bookId = rssField(item, 'book_id');
  const url = bookId
    ? `https://www.goodreads.com/book/show/${bookId}`
    : rssField(item, 'link')?.split('?')[0] ?? null;
  const cover =
    rssField(item, 'book_large_image_url') ??
    rssField(item, 'book_medium_image_url') ??
    rssField(item, 'book_small_image_url');
  return { title, author: rssField(item, 'author_name') || null, url, cover: cover || null };
}

async function fetchGoodreadsShelf(shelf) {
  const userId = process.env.GOODREADS_USER_ID;
  if (!userId) {
    console.warn('[feeds] Goodreads env missing; skipping', shelf);
    return null;
  }
  const url = `https://www.goodreads.com/review/list_rss/${userId}?shelf=${shelf}`;
  const res = await fetch(url, {
    // Goodreads sometimes 403s requests without a UA string.
    headers: { 'user-agent': 'pedrocastro.eu/1.0 (+https://pedrocastro.eu)' },
  });
  if (!res.ok) throw new Error(`Goodreads ${res.status}`);
  return res.text();
}

// Now: the one book currently being read.
async function fetchReading() {
  const xml = await fetchGoodreadsShelf('currently-reading');
  if (xml == null) return null;
  const item = eachItem(xml)[0];
  if (!item) return null;
  const book = goodreadsBook(item);
  if (!book) return null;
  const startedAt =
    toIso(rssField(item, 'user_date_started')) ??
    toIso(rssField(item, 'user_date_added')) ??
    toIso(rssField(item, 'pubDate'));
  return { ...book, startedAt };
}

// Media: the most recently finished books, dated by completion.
async function fetchBooksList() {
  const xml = await fetchGoodreadsShelf('read');
  if (xml == null) return null;
  const books = eachItem(xml)
    .map((item) => {
      const book = goodreadsBook(item);
      if (!book) return null;
      const readAt =
        toIso(rssField(item, 'user_read_at')) ??
        toIso(rssField(item, 'user_date_added'));
      return { ...book, readAt };
    })
    .filter(Boolean)
    .sort((a, b) => (b.readAt ?? '').localeCompare(a.readAt ?? ''));
  return books.length ? books.slice(0, MEDIA_LIMIT) : null;
}

// ---------------------------------------------------------------------------
// Letterboxd — watched films
// ---------------------------------------------------------------------------

// The RSS <link> is the user's diary entry (e.g. .../zanakii/film/<slug>/ or
// .../zanakii/film/<slug>/2/ for a rewatch). Rewrite to the canonical film page
// (.../film/<slug>/) so the link lands on the movie, not the personal log entry.
function letterboxdFilmUrl(entryLink) {
  if (!entryLink) return null;
  const m = entryLink.match(/letterboxd\.com\/[^/]+\/film\/([^/]+)/);
  return m ? `https://letterboxd.com/film/${m[1]}/` : entryLink;
}

// The feed mixes diary entries, reviews and list activity, ordered by when each
// entry was *logged* — not when the film was watched. We sort by watchedDate so
// a film logged today but watched years ago doesn't trump a recent watch.
async function fetchFilmsList() {
  const user = process.env.LETTERBOXD_USERNAME;
  if (!user) {
    console.warn('[feeds] Letterboxd env missing; skipping watching');
    return null;
  }
  const res = await fetch(`https://letterboxd.com/${user}/rss/`, {
    headers: { 'user-agent': 'pedrocastro.eu/1.0 (+https://pedrocastro.eu)' },
  });
  if (!res.ok) throw new Error(`Letterboxd ${res.status}`);
  const xml = await res.text();

  const films = [];
  for (const item of eachItem(xml)) {
    const watchedAt = toIso(rssField(item, 'letterboxd:watchedDate'));
    // Only diary entries carry a watchedDate; reviews/list edits don't.
    if (!watchedAt) continue;
    const ratingRaw = rssField(item, 'letterboxd:memberRating');
    const rating = ratingRaw != null ? Number(ratingRaw) : null;
    // The poster is only available as an <img> inside the description HTML.
    const poster = rssField(item, 'description')?.match(/<img[^>]+src="([^"]+)"/)?.[1];
    const title = rssField(item, 'letterboxd:filmTitle');
    if (!title) continue;
    films.push({
      title,
      year: rssField(item, 'letterboxd:filmYear'),
      rating: Number.isFinite(rating) ? rating : null,
      rewatch: rssField(item, 'letterboxd:rewatch') === 'Yes',
      url: letterboxdFilmUrl(rssField(item, 'link')),
      poster: poster || null,
      watchedAt,
    });
  }
  films.sort((a, b) => b.watchedAt.localeCompare(a.watchedAt));
  return films.length ? films.slice(0, MEDIA_LIMIT) : null;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function safe(label, fn, fallback) {
  try {
    const value = await fn();
    return value ?? fallback;
  } catch (err) {
    console.error(`[feeds] ${label} failed:`, err.message);
    return fallback;
  }
}

const prevNow = await readJson(NOW_PATH);
const prevMedia = await readJson(MEDIA_PATH);

const musicList = await safe('music', fetchMusicList, prevMedia?.music ?? null);
const reading = await safe('reading', fetchReading, prevNow?.reading ?? null);
const booksList = await safe('books', fetchBooksList, prevMedia?.books ?? null);
const filmsList = await safe('films', fetchFilmsList, prevMedia?.films ?? null);

const updatedAt = new Date().toISOString();

const now = {
  updatedAt,
  listening: musicList?.[0] ??
    prevNow?.listening ?? {
      track: null, artist: null, album: null, url: null, image: null, playedAt: null, nowPlaying: false,
    },
  reading: reading ?? {
    title: null, author: null, url: null, cover: null, startedAt: null,
  },
  watching: filmsList?.[0] ??
    prevNow?.watching ?? {
      title: null, year: null, rating: null, rewatch: false, url: null, poster: null, watchedAt: null,
    },
};

const media = {
  updatedAt,
  music: musicList ?? [],
  books: booksList ?? [],
  films: filmsList ?? [],
};

await writeFile(NOW_PATH, JSON.stringify(now, null, 2) + '\n');
await writeFile(MEDIA_PATH, JSON.stringify(media, null, 2) + '\n');
console.log('[feeds] wrote', NOW_PATH, 'and', MEDIA_PATH);
