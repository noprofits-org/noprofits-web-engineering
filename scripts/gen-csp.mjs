// Regenerate the Content-Security-Policy in firebase.json from the built dist/.
//
// Astro inlines the small client scripts directly into each HTML page, so a
// strict CSP must allowlist each inline script by sha256 hash. Those bytes
// change whenever a bundled constant changes (e.g. FORM_ENDPOINT flipping from
// the placeholder to the real /exec URL), so hardcoded hashes would silently
// break the form after deploy. This script runs after `astro build` (see the
// build npm script) and rewrites the policy to match what actually shipped, so
// the CSP can never go stale. Idempotent: re-running with no dist change is a
// no-op.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const DIST = 'dist';
const FIREBASE_JSON = 'firebase.json';

/** Recursively list all .html files under a directory. */
function htmlFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...htmlFiles(p));
    else if (entry.name.endsWith('.html')) out.push(p);
  }
  return out;
}

/** Collect sha256 hashes of every executable inline <script> in dist/. */
function inlineScriptHashes() {
  const hashes = new Set();
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
  for (const file of htmlFiles(DIST)) {
    const html = readFileSync(file, 'utf8');
    let m;
    while ((m = re.exec(html))) {
      const [, attrs, body] = m;
      if (/\ssrc=/.test(attrs)) continue; // external — covered by 'self'
      if (/application\/ld\+json/.test(attrs)) continue; // data, not executable
      if (body.trim() === '') continue;
      const h = createHash('sha256').update(body, 'utf8').digest('base64');
      hashes.add(`'sha256-${h}'`);
    }
  }
  return [...hashes].sort();
}

/** Build the full CSP string for the given script hashes. */
function buildCsp(scriptHashes) {
  const google = 'https://script.google.com https://script.googleusercontent.com';
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "font-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' ${scriptHashes.join(' ')}`.trim(),
    `connect-src 'self' ${google}`,
    `form-action 'self' ${google}`,
  ].join('; ');
}

const config = JSON.parse(readFileSync(FIREBASE_JSON, 'utf8'));
const headerEntries = config.hosting.headers || [];
const catchAll = headerEntries.find((h) => h.source === '**');
if (!catchAll) {
  throw new Error('gen-csp: no "**" headers entry in firebase.json to attach the CSP to.');
}
const cspHeader = catchAll.headers.find((h) => h.key === 'Content-Security-Policy');
if (!cspHeader) {
  throw new Error('gen-csp: no Content-Security-Policy header in the "**" entry.');
}

const csp = buildCsp(inlineScriptHashes());
if (cspHeader.value !== csp) {
  cspHeader.value = csp;
  writeFileSync(FIREBASE_JSON, JSON.stringify(config, null, 2) + '\n');
  console.log('[gen-csp] firebase.json CSP updated.');
} else {
  console.log('[gen-csp] CSP already up to date.');
}
