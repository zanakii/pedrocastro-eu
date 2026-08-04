import nowData from '../data/now.json';

export interface ListeningNow {
  track: string | null;
  artist: string | null;
  album: string | null;
  url: string | null;
  image: string | null;
  playedAt: string | null;
  nowPlaying: boolean;
}

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
