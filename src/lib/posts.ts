import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'posts'>;

/**
 * Published posts, newest first. Drafts are shown in dev and dropped from the
 * production build, so work-in-progress is previewable locally without leaking.
 */
export async function getSortedPosts(): Promise<Post[]> {
  const posts = await getCollection('posts', (post) =>
    import.meta.env.PROD ? !post.data.draft : true,
  );
  return posts.sort(
    (a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime(),
  );
}

/**
 * The canonical URL path for a post: `/posts/YYYY/MM/DD/<slug>/`. Date segments
 * come from `pubDate` (UTC) so the date lives in one place. Defined once here so
 * the index links and the RSS feed can never disagree.
 */
export function postPath(post: Post): string {
  const d = post.data.pubDate;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `/posts/${yyyy}/${mm}/${dd}/${post.id}/`;
}

/** Absolute date, e.g. `19 Jun 2026`. Posts are dated artifacts, not "3d ago". */
export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
