// index.js — Cloud Function glue: HTTPS entry, Firebase Auth enforcement,
// admin UI serving. All CMS logic lives in cms-core.mjs (unit-tested); all
// GitHub access in github.mjs; all parsing in engine.mjs.
//
// Security boundaries enforced HERE:
//   - every /api/* request must carry a valid Firebase ID token whose email is
//     verified AND on the EDITOR_ALLOWLIST (fail-closed: empty list = nobody)
//   - the GitHub PAT lives in Secret Manager, is scoped to this one repo, and
//     never reaches the browser
//   - same-origin only: no CORS headers are emitted, and auth rides in the
//     Authorization header (not cookies), so cross-site requests are inert
//   - the served admin page gets its own strict CSP (hash-pinned inline script)

import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createGithub } from './github.mjs';
import { createCmsCore } from './cms-core.mjs';
import * as engine from './engine.mjs';

const githubToken = defineSecret('CMS_GITHUB_TOKEN');

initializeApp();

const OWNER = process.env.CMS_REPO_OWNER || 'noprofits-org';
const REPO = process.env.CMS_REPO_NAME || 'noprofits-web-engineering';
// Comma-separated verified emails allowed to edit. Empty/unset = nobody.
const ALLOWLIST = (process.env.EDITOR_ALLOWLIST || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
// Web-app config for the sign-in UI (from Firebase console ▸ project settings).
const WEB_API_KEY = process.env.CMS_WEB_API_KEY || '';
const AUTH_DOMAIN = process.env.CMS_AUTH_DOMAIN
  || `${process.env.GCLOUD_PROJECT}.firebaseapp.com`;

// ---- admin UI: one static page, config injected, inline script hash-pinned
// CRLF→LF up front: browsers hash inline scripts AFTER the HTML parser
// normalizes line endings, so serving CRLF would break the hash-pinned CSP.
const rawHtml = readFileSync(new URL('./admin.html', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');
const adminHtml = rawHtml.replace('"__FB_CONFIG__"', JSON.stringify({
  apiKey: WEB_API_KEY,
  authDomain: AUTH_DOMAIN,
  projectId: process.env.GCLOUD_PROJECT,
}));
const scriptHashes = [...adminHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((m) => `'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
const ADMIN_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  // apis.google.com: gapi iframe loader, required by signInWithPopup
  `script-src ${scriptHashes.join(' ')} https://www.gstatic.com https://apis.google.com`,
  "style-src 'unsafe-inline'",
  "img-src 'self' data: https://*.googleusercontent.com",
  "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com",
  `frame-src https://${AUTH_DOMAIN}`,
].join('; ');

async function requireEditor(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) { const e = new Error('missing token'); e.code = 401; throw e; }
  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(m[1]);
  } catch {
    const e = new Error('invalid token'); e.code = 401; throw e;
  }
  const email = (decoded.email || '').toLowerCase();
  if (!decoded.email_verified || !ALLOWLIST.includes(email)) {
    const e = new Error('this account is not authorized to edit'); e.code = 403; throw e;
  }
  return email;
}

export const cms = onRequest(
  {
    region: 'us-central1',
    secrets: [githubToken],
    // Public at the HTTP layer by design — every request is auth-gated in-app
    // via Firebase ID token + allowlist (see requireEditor). Requires the
    // project-level org-policy exception on iam.allowedPolicyMemberDomains.
    invoker: 'public',
    maxInstances: 2,
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async (req, res) => {
    res.set('x-content-type-options', 'nosniff');
    res.set('referrer-policy', 'no-referrer');
    try {
      const path = req.path.replace(/\/+$/, '') || '/';

      if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
        res.set('content-type', 'text/html; charset=utf-8');
        res.set('content-security-policy', ADMIN_CSP);
        res.set('cache-control', 'no-store');
        res.status(200).send(adminHtml);
        return;
      }

      if (!path.startsWith('/api/')) { res.status(404).json({ error: 'not found' }); return; }

      const editor = await requireEditor(req);
      const core = createCmsCore({
        gh: createGithub({ token: githubToken.value(), owner: OWNER, repo: REPO }),
        engine,
      });

      if (req.method === 'GET' && path === '/api/graph') {
        res.json(await core.graph()); return;
      }
      if (req.method === 'GET' && path === '/api/page') {
        res.json(await core.page(String(req.query.route || ''))); return;
      }
      if (req.method === 'POST' && path === '/api/save') {
        const { route, fileSha, edits } = req.body || {};
        res.json(await core.save({ route, fileSha, edits, editor })); return;
      }
      res.status(404).json({ error: 'not found' });
    } catch (err) {
      const code = Number(err.code) >= 400 && Number(err.code) < 600 ? Number(err.code)
        : (err.status >= 400 ? err.status : 500);
      if (code >= 500) console.error(err);
      res.status(code).json({ error: err.message || 'error' });
    }
  }
);
