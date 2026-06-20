// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { SITE_URL } from './src/data/site.ts';

// Static marketing site for noprofits.org.
// `site` feeds the sitemap integration and any absolute-URL helpers.
export default defineConfig({
  site: SITE_URL,
  output: 'static',
  integrations: [sitemap()],
});
