import { getCollection, type CollectionEntry } from 'astro:content';

export type Scrap = CollectionEntry<'scraps'>;

/**
 * Published scraps, newest first. Drafts show in dev and drop from the
 * production build, mirroring posts — so a half-formed thought stays local.
 */
export async function getSortedScraps(): Promise<Scrap[]> {
  const scraps = await getCollection('scraps', (scrap) =>
    import.meta.env.PROD ? !scrap.data.draft : true,
  );
  return scraps.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

/** Absolute date, e.g. `20 Jul 2026`. Uppercased by CSS into the accent label. */
export function formatScrapDate(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
