import nowData from '../data/now.json';

export interface ListeningNow {
  track: string | null;
  artist: string | null;
  album: string | null;
  url: string | null;
  playedAt: string | null;
  nowPlaying: boolean;
}

export interface ReadingNow {
  title: string | null;
  author: string | null;
  url: string | null;
  startedAt: string | null;
}

export interface Now {
  updatedAt: string | null;
  listening: ListeningNow;
  reading: ReadingNow;
}

export function getNow(): Now {
  return nowData as Now;
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
