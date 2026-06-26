import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import MarkdownIt from 'markdown-it';
import sanitizeHtml from 'sanitize-html';
import { getSortedPosts, postPath } from '../lib/posts';

const parser = new MarkdownIt();

// Root-relative URLs (e.g. an embedded image at `/images/chart.png`) don't
// resolve inside a feed reader, which has no notion of the site origin. Rewrite
// them to absolute against `site` so images and links work everywhere.
function absolutize(attr: string, site: URL) {
  return (tagName: string, attribs: Record<string, string>) => {
    const value = attribs[attr];
    if (value && value.startsWith('/')) {
      attribs[attr] = new URL(value, site).href;
    }
    return { tagName, attribs };
  };
}

export async function GET(context: APIContext) {
  const site = context.site!; // from `site` in astro.config.mjs; required for absolute links
  const posts = await getSortedPosts();

  return rss({
    title: 'Pedro Castro',
    description: 'Writing by Pedro Castro.',
    site,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      link: postPath(post),
      // Full post body so subscribers can read the whole thing in their reader —
      // the feed *is* the subscription, not a teaser back to the site.
      content: sanitizeHtml(parser.render(post.body ?? ''), {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
        allowedAttributes: {
          ...sanitizeHtml.defaults.allowedAttributes,
          img: ['src', 'alt', 'title', 'width', 'height'],
        },
        transformTags: {
          img: absolutize('src', site),
          a: absolutize('href', site),
        },
      }),
    })),
  });
}
