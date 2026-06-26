#!/usr/bin/env node
// Fetches recent listening (Last.fm), reading (Goodreads) and watching
// (Letterboxd) and writes two files:
//   src/data/now.json   - the single latest item per type (the *Now* section)
//   src/data/media.json - up to 5 per type within 3 months (the /before/ timeline)
//
// Designed to be run by a scheduled GitHub Action; on per-source failure it
// preserves the previous value rather than blanking the site.
//
// Required env (set as repo secrets in CI, or in a local .env for testing):
//   LASTFM_API_KEY      - https://www.last.fm/api/account/create
//   LASTFM_USERNAME     - your Last.fm handle
//   GOODREADS_USER_ID   - numeric portion of your goodreads.com/user/show/<id> URL
//   LETTERBOXD_USERNAME - your letterboxd.com/<username> handle
//   TRAKT_CLIENT_ID     - Trakt API app client id (https://trakt.tv/oauth/applications)
//   TRAKT_USERNAME      - your trakt.tv slug; profile history must be public
//   TMDB_API_KEY        - themoviedb.org API key, for series poster art (optional)
//
// Any missing key just disables that source.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', 'src', 'data');
const NOW_PATH = resolve(DATA_DIR, 'now.json');
const MEDIA_PATH = resolve(DATA_DIR, 'media.json');

const MEDIA_LIMIT = 5; // items kept per type in the timeline
const MEDIA_MAX_AGE_MONTHS = 3; // older items are dropped from the timeline

// The cutoff date: calendar months back from today, so "3 months ago" tracks
// the calendar (Mar 28 stays in-window on Jun 26) rather than a fixed 90 days.
function windowStart() {
  const d = new Date();
  d.setMonth(d.getMonth() - MEDIA_MAX_AGE_MONTHS);
  return d.getTime();
}

// True when `iso` is a real date within the window. Undated items (null) are
// out — except now-playing music, handled separately at its call site.
function withinWindow(iso) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t >= windowStart();
}

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
  // Return the full deduped list; the ~3-month window and per-type cap are
  // enforced centrally in clampMedia so every write obeys them.
  return dedupeConsecutive(tracks.map(normalizeTrack));
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
  // Return null only when the shelf itself came back empty (a failed fetch
  // keeps the previous data); window + cap are enforced centrally.
  return books.length ? books : null;
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
  // As with books: null means "keep previous data"; window + cap are central.
  return films.length ? films : null;
}

// ---------------------------------------------------------------------------
// Trakt — watched TV episodes (mirror your TV Time history here)
// ---------------------------------------------------------------------------

function normalizeEpisode(entry) {
  const show = entry.show;
  const ep = entry.episode;
  if (!show?.title) return null;
  const slug = show.ids?.slug;
  return {
    show: show.title,
    year: show.year ?? null,
    season: ep?.season ?? null,
    number: ep?.number ?? null,
    episode: ep?.title ?? null,
    // Trakt's history is canonical; link to the show page. Poster art comes from
    // a separate TMDB lookup keyed by this id (see withPosters).
    url: slug ? `https://trakt.tv/shows/${slug}` : null,
    tmdb: show.ids?.tmdb ?? null,
    image: null,
    watchedAt: entry.watched_at ? new Date(entry.watched_at).toISOString() : null,
  };
}

// History is newest-first; collapse a binge (consecutive episodes of the same
// show) into a single row so one evening doesn't fill the timeline.
function dedupeConsecutiveShows(eps) {
  const out = [];
  for (const e of eps) {
    const prev = out[out.length - 1];
    if (prev && prev.show === e.show) continue;
    out.push(e);
  }
  return out;
}

async function fetchSeriesList() {
  const clientId = process.env.TRAKT_CLIENT_ID;
  const user = process.env.TRAKT_USERNAME;
  if (!clientId || !user) {
    console.warn('[feeds] Trakt env missing; skipping series');
    return null;
  }
  const url = `https://api.trakt.tv/users/${encodeURIComponent(user)}/history/episodes?limit=40`;
  const res = await fetch(url, {
    headers: {
      'trakt-api-version': '2',
      'trakt-api-key': clientId,
      'content-type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Trakt ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json) || json.length === 0) return null;
  const eps = dedupeConsecutiveShows(json.map(normalizeEpisode).filter(Boolean));
  return eps.length ? eps : null;
}

// Trakt returns no artwork, so resolve a poster from TMDB by the show's tmdb id.
// w342 is a good balance for the ~3.5rem card thumb.
async function fetchTmdbPoster(tmdbId) {
  const key = process.env.TMDB_API_KEY;
  if (!key || !tmdbId) return null;
  const res = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${key}`);
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  const json = await res.json();
  return json.poster_path ? `https://image.tmdb.org/t/p/w342${json.poster_path}` : null;
}

// Add posters to the (already clamped) series list. Reuse posters from the
// previous snapshot by tmdb id, so we hit TMDB only for newly surfaced shows
// and a TMDB outage or rate limit can't blank art we already had.
async function withPosters(series, prevSeries) {
  const cache = new Map();
  for (const p of prevSeries ?? []) {
    if (p.tmdb && p.image) cache.set(p.tmdb, p.image);
  }
  for (const s of series) {
    if (s.image) continue;
    if (s.tmdb && cache.has(s.tmdb)) {
      s.image = cache.get(s.tmdb);
      continue;
    }
    try {
      s.image = await fetchTmdbPoster(s.tmdb);
    } catch (err) {
      console.error('[feeds] TMDB poster failed:', err.message);
      s.image = (s.tmdb && cache.get(s.tmdb)) ?? null;
    }
  }
  return series;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

// The single point of truth for the timeline rules: at most MEDIA_LIMIT items
// per type, none older than MEDIA_MAX_AGE_MS. Applied to the final lists right
// before writing, so it holds whether the data was freshly fetched or carried
// over from the previous snapshot on a failed fetch. Now-playing music has no
// timestamp yet, so it's kept regardless of the window.
function clampMedia(list, dateKey, { keepNowPlaying = false } = {}) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => (keepNowPlaying && item.nowPlaying) || withinWindow(item[dateKey]))
    .slice(0, MEDIA_LIMIT);
}

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
const seriesList = await safe('series', fetchSeriesList, prevMedia?.series ?? null);

// Posters are resolved after clamping so TMDB is queried only for the handful
// of shows that actually make the timeline.
const series = await safe(
  'posters',
  () => withPosters(clampMedia(seriesList, 'watchedAt'), prevMedia?.series),
  clampMedia(seriesList, 'watchedAt'),
);

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
  music: clampMedia(musicList, 'playedAt', { keepNowPlaying: true }),
  books: clampMedia(booksList, 'readAt'),
  films: clampMedia(filmsList, 'watchedAt'),
  series,
};

await writeFile(NOW_PATH, JSON.stringify(now, null, 2) + '\n');
await writeFile(MEDIA_PATH, JSON.stringify(media, null, 2) + '\n');
console.log('[feeds] wrote', NOW_PATH, 'and', MEDIA_PATH);
