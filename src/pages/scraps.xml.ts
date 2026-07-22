import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import MarkdownIt from 'markdown-it';
import sanitizeHtml from 'sanitize-html';
import { getSortedScraps } from '../lib/scraps';

const parser = new MarkdownIt();

// Root-relative links don't resolve inside a feed reader (no site origin), so
// rewrite them to absolute against `site`. Same approach as the Posts feed.
function absolutizeHref(site: URL) {
  return (tagName: string, attribs: Record<string, string>) => {
    const value = attribs.href;
    if (value && value.startsWith('/')) {
      attribs.href = new URL(value, site).href;
    }
    return { tagName, attribs };
  };
}

export async function GET(context: APIContext) {
  const site = context.site!; // from `site` in astro.config.mjs; required for absolute links
  const scraps = await getSortedScraps();

  return rss({
    title: 'Pedro Castro — Scraps',
    description: 'Short thoughts and passing notes by Pedro Castro.',
    site,
    items: scraps.map((scrap) => {
      // Scraps are title-less, so the item leads with its body. `content` is the
      // full HTML; `description` is a plain-text version for readers that want it.
      const html = sanitizeHtml(parser.render(scrap.body ?? ''), {
        allowedTags: sanitizeHtml.defaults.allowedTags,
        transformTags: { a: absolutizeHref(site) },
      });
      return {
        // No title field — a microblog entry has none; the text carries it.
        description: sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }),
        pubDate: scrap.data.date,
        // Anchor into the archive so a reader can jump to the exact scrap.
        link: new URL(`/scraps/#${scrap.id}`, site).href,
        content: html,
      };
    }),
  });
}
