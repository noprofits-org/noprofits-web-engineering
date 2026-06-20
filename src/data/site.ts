// =============================================================================
// Site-wide configuration — single source of truth.
// =============================================================================

/** Canonical public origin. Used for sitemap + Open Graph absolute URLs. */
export const SITE_URL = 'https://noprofits.org';

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
 * Currently points at the SVG so a REAL, resolvable file ships today (better
 * than a 404 PNG). LAUNCH UPGRADE: rasterize `public/og-image.svg` →
 * `public/og-image.png` (1200×630) and flip this to '/og-image.png' — a few
 * scrapers (Facebook, some LinkedIn) prefer/require PNG/JPG over SVG.
 */
export const OG_IMAGE_PATH = '/og-image.svg';

// -----------------------------------------------------------------------------
// FORM_ENDPOINT — the single shared submission target for BOTH forms.
//
// Replace the placeholder below with the deployed Google Apps Script web-app
// `/exec` URL when it is ready (a later step). Until then it stays a clearly
// marked placeholder and the forms run in concept-demo mode (client-side
// validation + inline success, NO network call). See `isRealEndpoint`.
// -----------------------------------------------------------------------------
export const FORM_ENDPOINT = '[CONFIRM: Apps Script /exec URL]';

/**
 * True only when FORM_ENDPOINT points at a real deployed Apps Script web app.
 * Drives whether the forms actually POST or just demo the success state.
 */
export const isRealEndpoint = FORM_ENDPOINT.startsWith('https://script.google.com');
