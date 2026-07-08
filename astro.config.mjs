// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  // Required for absolute URLs in the RSS feed, canonical/OG tags, and sitemap.
  site: 'https://pedrocastro.eu',
  integrations: [sitemap()],
});
