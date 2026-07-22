import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const posts = defineCollection({
  // Astro content layer: load Markdown from disk.
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    description: z.string(), // one-liner; used on the index and in <meta> + RSS
    pubDate: z.coerce.date(), // sort key + URL date segments; coerce so `2026-06-19` parses
    updatedDate: z.coerce.date().optional(),
    draft: z.boolean().default(false), // hidden in prod, shown in dev
  }),
});

// Flashes: a browse-only photolog (no RSS, by decision), kept entirely separate
// from posts. Each entry is one image plus light metadata. The image is a path
// under /uploads served straight from public/, so it's a plain string here
// rather than an astro:content image().
const flashes = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/flashes' }),
  schema: z.object({
    image: z.string(), // e.g. /uploads/lisbon-rooftops.jpg
    alt: z.string().default(''), // accessibility / fallback caption
    date: z.coerce.date(),
    caption: z.string().optional(),
    location: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

// Scraps: a microblog stream — short, dated, title-less thoughts (text + inline
// links only). Deliberately the opposite of a Post: if it needs a title it's a
// Post, if it doesn't it's a Scrap. Body is plain Markdown; no images (photos
// are Flashes' job). Has its own feed at /scraps.xml.
const scraps = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/scraps' }),
  schema: z.object({
    date: z.coerce.date(), // sort key + the accent label under each scrap
    draft: z.boolean().default(false), // hidden in prod, shown in dev
  }),
});

export const collections = { posts, flashes, scraps };
