// @ts-check
import { defineConfig } from 'astro/config';
import { loadEnv } from 'vite';
import sitemap from '@astrojs/sitemap';
import { SITE_URL } from './src/data/site.ts';

// Build guard: refuse to produce a production build while the lead form points
// at the placeholder endpoint — a dead form that lies "we got your details" is
// the worst failure for a lead-gen site. Reads PUBLIC_FORM_ENDPOINT from the
// environment directly (the value site.ts injects at build time); checking
// process.env here is reliable in the config-load context. Runs only in the
// build process (never shipped to the client). Escape hatch for local
// verification builds:  ALLOW_PLACEHOLDER_ENDPOINT=true npm run build
const formEndpointGuard = {
  name: 'np:form-endpoint-guard',
  hooks: {
    'astro:build:start': () => {
      // Read OS env AND .env files (loadEnv), matching what Astro/Vite inject
      // into import.meta.env — so a local prod build that sets the endpoint via
      // a .env file isn't falsely blocked.
      const fileEnv = loadEnv(process.env.NODE_ENV || 'production', process.cwd(), 'PUBLIC_');
      const endpoint = process.env.PUBLIC_FORM_ENDPOINT || fileEnv.PUBLIC_FORM_ENDPOINT || '';
      const isRealEndpoint = endpoint.startsWith('https://script.google.com');
      if (!isRealEndpoint && process.env.ALLOW_PLACEHOLDER_ENDPOINT !== 'true') {
        throw new Error(
          '\n[form-endpoint-guard] PUBLIC_FORM_ENDPOINT is not set to a real /exec URL.\n' +
            'Deploy the Apps Script web app and set the PUBLIC_FORM_ENDPOINT repo\n' +
            'variable (or a local .env) before building for production. To build\n' +
            'locally in preview mode, run: ALLOW_PLACEHOLDER_ENDPOINT=true npm run build\n'
        );
      }
    },
  },
};

// Static marketing site for noprofits.org.
// `site` feeds the sitemap integration and any absolute-URL helpers.
export default defineConfig({
  site: SITE_URL,
  output: 'static',
  integrations: [sitemap(), formEndpointGuard],
});
