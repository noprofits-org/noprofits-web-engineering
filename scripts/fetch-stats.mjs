// Bake the public stats dashboard's data at build time.
//
// Fetches aggregated analytics JSON from the Apps Script endpoint (the SAME
// /exec the form + beacon use) using the private DASH_TOKEN, and writes it to
// src/data/stats.json. The stats page server-renders charts from that file, so
// the page itself makes ZERO client-side calls — no CSP change, no tracking
// script, nothing for an ad-blocker to trip on.
//
// Runs automatically before every build via the npm "prebuild" hook. It is
// FAIL-SOFT on purpose: if the endpoint/token aren't configured (local dev, a
// PR build, the endpoint down), it leaves the committed src/data/stats.json
// in place and exits 0 so the build never breaks. The committed file ships a
// clearly-labelled `source: "seed"` sample until the first real bake replaces
// it with `source: "live"`.
//
// Env (set on the CI build step):
//   PUBLIC_FORM_ENDPOINT — the deployed Apps Script /exec URL (a repo Variable)
//   DASH_TOKEN           — the dashboard read secret (a repo Secret)
// The token is sent in the POST BODY, never the URL query string, so it can't
// leak through request-line access logs.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join('src', 'data', 'stats.json');
const endpoint = process.env.PUBLIC_FORM_ENDPOINT;
const token = process.env.DASH_TOKEN;

function skip(reason) {
  // Not an error — the committed seed/last-good file stays in place.
  console.log(`[fetch-stats] ${reason} — keeping existing ${OUT}.`);
  process.exit(0);
}

if (!endpoint || !endpoint.startsWith('https://script.google.com')) {
  skip('PUBLIC_FORM_ENDPOINT not set to a real /exec URL');
}
if (!token) {
  skip('DASH_TOKEN not set');
}

try {
  // POST with the token in the body (Apps Script reads it via e.parameter.token).
  // Apps Script answers /exec with a 302 to its result URL; redirect:'follow'
  // retrieves the computed JSON.
  const res = await fetch(endpoint, {
    method: 'POST',
    body: new URLSearchParams({ token }),
    redirect: 'follow',
  });
  if (!res.ok) skip(`endpoint returned HTTP ${res.status}`);

  const data = await res.json();
  if (!data || data.error || !Array.isArray(data.daily)) {
    skip('endpoint returned no usable data (bad token or empty)');
  }

  data.source = 'live';
  writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n', 'utf8');
  const t = data.totals || {};
  console.log(
    `[fetch-stats] wrote live data → ${OUT} ` +
      `(${data.daily.length} days · ${t.visits ?? 0} visits · ${t.pageview ?? 0} pageviews).`
  );
} catch (err) {
  // Network hiccup, JSON parse error, anything — never break the build.
  skip(`fetch failed (${err && err.message ? err.message : err})`);
}
