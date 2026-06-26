import mediaData from '../data/media.json';
import { formatRelative, formatStars } from './now';

export interface MusicItem {
  track: string | null;
  artist: string | null;
  album: string | null;
  url: string | null;
  image: string | null;
  playedAt: string | null;
  nowPlaying: boolean;
}

export interface BookItem {
  title: string | null;
  author: string | null;
  url: string | null;
  cover: string | null;
  readAt: string | null;
}

export interface FilmItem {
  title: string | null;
  year: string | null;
  rating: number | null;
  rewatch: boolean;
  url: string | null;
  poster: string | null;
  watchedAt: string | null;
}

export interface SeriesItem {
  show: string | null;
  year: number | null;
  season: number | null;
  number: number | null;
  episode: string | null;
  url: string | null;
  tmdb: number | null;
  image: string | null;
  watchedAt: string | null;
}

export interface Media {
  updatedAt: string | null;
  music: MusicItem[];
  books: BookItem[];
  films: FilmItem[];
  series: SeriesItem[];
}

export type MediaKind = 'Music' | 'Book' | 'Film' | 'Series';

/** Normalised row for the timeline — maps directly onto <NowCard>. */
export interface TimelineItem {
  kind: MediaKind;
  title: string;
  subtitle?: string;
  href?: string;
  image?: string;
  meta?: string;
  /** Sort key in epoch ms; nulls sort last. */
  sortAt: number;
}

export function getMedia(): Media {
  return mediaData as Media;
}

function ms(iso: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function joinDot(parts: (string | null | undefined)[]): string | undefined {
  const s = parts.filter(Boolean).join(' · ');
  return s.length ? s : undefined;
}

/**
 * The single place display order is decided: normalise each kind to a common
 * row, then merge into one reverse-chronological timeline. A *now playing* track
 * has no playedAt, so it sorts to the top using the current time.
 */
export function getMediaTimeline(): TimelineItem[] {
  const media = getMedia();
  const items: TimelineItem[] = [];

  for (const m of media.music) {
    if (!m.track) continue;
    items.push({
      kind: 'Music',
      title: m.track,
      subtitle: joinDot([m.artist, m.album]),
      href: m.url ?? undefined,
      image: m.image ?? undefined,
      meta: m.nowPlaying ? 'now playing' : formatRelative(m.playedAt) ?? undefined,
      sortAt: m.nowPlaying ? Date.now() : ms(m.playedAt),
    });
  }

  for (const b of media.books) {
    if (!b.title) continue;
    const rel = formatRelative(b.readAt);
    items.push({
      kind: 'Book',
      title: b.title,
      subtitle: b.author ?? undefined,
      href: b.url ?? undefined,
      image: b.cover ?? undefined,
      meta: rel ? `finished ${rel}` : undefined,
      sortAt: ms(b.readAt),
    });
  }

  for (const f of media.films) {
    if (!f.title) continue;
    const rel = formatRelative(f.watchedAt);
    items.push({
      kind: 'Film',
      title: f.year ? `${f.title} (${f.year})` : f.title,
      subtitle: joinDot([formatStars(f.rating), f.rewatch ? 'rewatch' : null]),
      href: f.url ?? undefined,
      image: f.poster ?? undefined,
      meta: rel ? `watched ${rel}` : undefined,
      sortAt: ms(f.watchedAt),
    });
  }

  // `series` is optional on older data snapshots that predate the Trakt feed.
  for (const s of media.series ?? []) {
    if (!s.show) continue;
    const rel = formatRelative(s.watchedAt);
    const ep = s.season && s.number ? `S${s.season}E${s.number}` : null;
    items.push({
      kind: 'Series',
      title: s.year ? `${s.show} (${s.year})` : s.show,
      subtitle: joinDot([ep, s.episode]),
      href: s.url ?? undefined,
      image: s.image ?? undefined,
      meta: rel ? `watched ${rel}` : undefined,
      sortAt: ms(s.watchedAt),
    });
  }

  return items.sort((a, b) => b.sortAt - a.sortAt);
}
