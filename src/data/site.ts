// =============================================================================
// Site-wide configuration — single source of truth.
// =============================================================================

/** Canonical public origin. Used for sitemap + Open Graph absolute URLs. */
export const SITE_URL = 'https://site.noprofits.org';

export const SITE_NAME = 'noprofits.org';

export const SITE_DESCRIPTION =
  'Free and low-cost professional websites for non-profits across greater Seattle — designed and built well, hosted free on the Google Workspace you already have, and owned entirely by you.';

/** Contact details, defined once and reused across header, footer, forms. */
export const PHONE_DISPLAY = '206-532-6395';
export const PHONE_TEL = '+12065326395';
export const EMAIL = 'hello@noprofits.org';

/** Service area — reused in homepage copy and JSON-LD areaServed. */
export const AREA_SERVED = 'Greater Seattle and the Puget Sound region';

/**
 * Social-share card path (emitted as an absolute URL in og:image/twitter:image).
 *
 * PNG (1200×630) because Facebook/LinkedIn/X silently drop SVG og:images.
 * Editable source lives in `design-reference/og-image.svg` (kept OUT of public/
 * so only the PNG ships). To regenerate:
 *   rsvg-convert -w 1200 -h 630 design-reference/og-image.svg -o public/og-image.png
 */
export const OG_IMAGE_PATH = '/og-image.png';

// -----------------------------------------------------------------------------
// FORM_ENDPOINT — the single shared submission target for BOTH forms.
//
// Injected at BUILD TIME from the PUBLIC_FORM_ENDPOINT env var (a GitHub Actions
// repo *variable* in CI; a local .env for dev) — deliberately NOT hardcoded here.
// The /exec URL ships in the client bundle anyway (the browser POSTs to it), so
// it is not a secret; keeping it out of the public repo / forks / git history
// just closes the bot-harvest path. See HANDOFF-form-endpoint.md.
//
// When unset it falls back to the placeholder and the forms run in preview mode
// (client-side validation + an inline "not connected" notice, NO network call).
// The production build guard in astro.config.mjs refuses to build while it is
// the placeholder, so a dead form can never ship live.
// -----------------------------------------------------------------------------
export const FORM_ENDPOINT =
  import.meta.env.PUBLIC_FORM_ENDPOINT ?? '[CONFIRM: Apps Script /exec URL]';

/**
 * True only when FORM_ENDPOINT points at a real deployed Apps Script web app.
 * Drives whether the forms actually POST or just show the preview notice.
 */
export const isRealEndpoint = FORM_ENDPOINT.startsWith('https://script.google.com');
