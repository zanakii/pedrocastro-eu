import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getSortedPosts, postPath } from '../lib/posts';

export async function GET(context: APIContext) {
  const posts = await getSortedPosts();
  return rss({
    title: 'Pedro Castro',
    description: 'Writing by Pedro Castro.',
    // context.site comes from `site` in astro.config.mjs; required for absolute links.
    site: context.site!,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      link: postPath(post),
    })),
  });
}
