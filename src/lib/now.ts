import nowData from '../data/now.json';

/**
 * A single scrobbled track: shuffle listening, a single, or an album played too
 * little for the fetcher to group. `kind` is optional so snapshots written
 * before album grouping existed still read as tracks.
 */
export interface ListeningTrack {
  kind?: 'track';
  track: string | null;
  artist: string | null;
  album: string | null;
  url: string | null;
  image: string | null;
  playedAt: string | null;
  nowPlaying: boolean;
}

/** A run of tracks off one record, collapsed by the fetcher into a single row. */
export interface ListeningAlbum {
  kind: 'album';
  album: string | null;
  artist: string | null;
  /** Distinct tracks heard off the album, not total plays. */
  trackCount: number;
  url: string | null;
  image: string | null;
  playedAt: string | null;
  nowPlaying: false;
}

export type ListeningNow = ListeningTrack | ListeningAlbum;

export interface ReadingNow {
  title: string | null;
  author: string | null;
  url: string | null;
  cover: string | null;
  startedAt: string | null;
}

export interface WatchingNow {
  title: string | null;
  year: string | null;
  rating: number | null;
  rewatch: boolean;
  url: string | null;
  poster: string | null;
  watchedAt: string | null;
}

export interface Now {
  updatedAt: string | null;
  listening: ListeningNow;
  reading: ReadingNow;
  watching: WatchingNow;
}

export function getNow(): Now {
  return nowData as Now;
}

// Letterboxd ratings are 0.5–5.0 in half-star steps. Render as filled/half
// stars, e.g. 3.5 -> "★★★½". Returns null when there's no rating.
export function formatStars(rating: number | null): string | null {
  if (rating == null || !Number.isFinite(rating) || rating <= 0) return null;
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return '★'.repeat(full) + (half ? '½' : '');
}

export function formatRelative(iso: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const diff = Date.now() - then;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < hour) return `${Math.max(1, Math.round(diff / minute))}m ago`;
  if (diff < day) return `${Math.round(diff / hour)}h ago`;
  if (diff < 30 * day) return `${Math.round(diff / day)}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

function joinDot(parts: (string | null | undefined)[]): string | undefined {
  const s = parts.filter(Boolean).join(' · ');
  return s.length ? s : undefined;
}

/**
 * Card text for a listening row, in the one place both the homepage Now section
 * and the /before/ timeline read it from — the two must not drift. Album rows
 * lead with the record and count its tracks; track rows keep the song out front.
 * Returns null when the row has no name to show, i.e. there's nothing to render.
 */
export function describeListening(
  item: ListeningNow,
): { title: string; subtitle?: string; meta?: string } | null {
  const when = item.nowPlaying ? 'now playing' : formatRelative(item.playedAt);
  if (item.kind === 'album') {
    if (!item.album) return null;
    const tracks = `${item.trackCount} track${item.trackCount === 1 ? '' : 's'}`;
    return {
      title: item.album,
      subtitle: item.artist ?? undefined,
      meta: joinDot([tracks, when]),
    };
  }
  if (!item.track) return null;
  return {
    title: item.track,
    subtitle: joinDot([item.artist, item.album]),
    meta: when ?? undefined,
  };
}
