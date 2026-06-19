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

export const collections = { posts };
