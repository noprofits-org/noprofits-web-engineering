// =============================================================================
// First-party, cookieless analytics beacon.
//
// Sends a few anonymous, aggregate events to our OWN Apps Script endpoint — the
// very same one the inquiry form POSTs to (one script, one Events tab in the
// leads sheet). That origin is already in the site CSP's connect-src, so no
// policy change is needed.
//
// No cookies, no third-party scripts, no PII. A random per-tab session id lives
// in sessionStorage (cleared when the tab closes), used only to distinguish
// pageviews from visits. If PUBLIC_FORM_ENDPOINT is unset (preview mode), every
// call here is a no-op, so the site runs identically with analytics off.
// =============================================================================
import { FORM_ENDPOINT, isRealEndpoint } from '../data/site.ts';

const SESSION_KEY = 'np_s';

/** Random per-tab id from sessionStorage (not a cookie; gone when tab closes). */
function sessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id =
        crypto?.randomUUID?.() ??
        Date.now().toString(36) + Math.random().toString(16).slice(2);
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    // sessionStorage blocked (private mode / settings) — count anonymously.
    return '';
  }
}

/** Referring site's HOST only; blank for internal navigation or no referrer. */
function referrerHost(): string {
  try {
    if (!document.referrer) return '';
    const host = new URL(document.referrer).host;
    return host === location.host ? '' : host;
  } catch {
    return '';
  }
}

/**
 * Record one event. Fire-and-forget; never throws, never blocks the page.
 * `keepalive` + no-cors mirrors the inquiry form's proven transport and lets
 * the request survive the page navigating away (e.g. a tel: link opening the
 * dialer on mobile).
 */
export function track(type: string, detail = ''): void {
  if (!isRealEndpoint) return;
  try {
    const body = new URLSearchParams({
      t: type,
      p: location.pathname,
      r: referrerHost(),
      d: detail,
      s: sessionId(),
    });
    fetch(FORM_ENDPOINT, {
      method: 'POST',
      mode: 'no-cors',
      keepalive: true,
      body,
    }).catch(() => {});
  } catch {
    // Analytics must never break the page.
  }
}

/**
 * Auto-wire the site-wide events: one pageview on load, plus a delegated
 * listener for clicks on any tel: link. Call once per page (from BaseLayout).
 * Form-submit tracking lives in InquiryForm where the success path already is.
 */
export function initAnalytics(): void {
  if (!isRealEndpoint) return;
  track('pageview');
  document.addEventListener('click', (e) => {
    const target = e.target as Element | null;
    const link = target?.closest?.('a[href^="tel:"]');
    if (link) {
      track('tel_click', (link.getAttribute('href') || '').replace(/^tel:/, ''));
    }
  });
}
