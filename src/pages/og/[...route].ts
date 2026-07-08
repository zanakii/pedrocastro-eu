import { OGImageRoute } from 'astro-og-canvas';
import { getSortedPosts, formatDate } from '../../lib/posts';

// Build-time OG cards, one per post. The library appends `.png` to each pages
// key, so key `posts/<id>` is emitted at `/og/posts/<id>.png`. The design
// mirrors the site: dark green-tinted paper, Fraunces title, Inter byline —
// no runtime, no network.
const posts = await getSortedPosts();

const pages = Object.fromEntries(
  posts.map((post) => [
    `posts/${post.id}`,
    {
      title: post.data.title,
      description: `${formatDate(post.data.pubDate)} · pedrocastro.eu`,
    },
  ]),
);

export const { getStaticPaths, GET } = await OGImageRoute({
  pages,
  getImageOptions: (_path, page) => ({
    title: page.title,
    description: page.description,
    bgGradient: [[13, 15, 14]], // --bg #0d0f0e
    border: { color: [77, 179, 137], width: 12, side: 'inline-start' }, // --accent
    padding: 72,
    font: {
      title: {
        color: [237, 237, 237], // --fg
        size: 68,
        lineHeight: 1.1,
        weight: 'SemiBold',
        families: ['Fraunces'],
      },
      description: {
        color: [134, 141, 136], // --muted
        size: 30,
        lineHeight: 1.4,
        families: ['Inter'],
      },
    },
    fonts: [
      './src/assets/og-fonts/fraunces-600.ttf',
      './src/assets/og-fonts/inter-400.ttf',
      './src/assets/og-fonts/inter-600.ttf',
    ],
  }),
});
