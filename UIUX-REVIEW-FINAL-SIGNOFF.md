# Pre-Deploy Sign-Off — noprofits.org (Final Pass)

_Generated 2026-06-20 · final follow-up to UIUX-REVIEW-ROUND3.md_

## Scope

This is the deploy-gate pass. I re-verified the three LOW residuals carried out of Round 3 (RESP-PHONE, the global.css font-cache comment, the stray `og-image.svg`) against the current tree, then ran a production deploy-readiness sweep focused on the things that actually break a launch: the CSP allowing the lead-form POST and self-hosted fonts, the built `<head>`/OG/canonical/sitemap/routing, and the form round-trip (endpoint injection + build guard + CSP-hash generation). I read current files and reproduced the build behavior empirically (placeholder build, real-endpoint build, and the guard-fail path) rather than trusting the committed `firebase.json` as a static artifact.

## Last-residuals table

| ID | Title | Status | Note |
|----|-------|--------|------|
| RESP-PHONE | Small-phone header overflow (rigid pill pushed brand wordmark to wrap) | 🟡 | Literal residual (two-line wrap) is **fixed**: `.np-wordmark` now has `white-space: nowrap` (Header.astro:82), a `@media (max-width:400px)` compaction tier exists (Header.astro:87–92), and `body{overflow-x:hidden}` guards the viewport (global.css:123). But at 320/360px the bar's intrinsic width still exceeds `100vw−40px`; the nowrap wordmark has no `text-overflow:ellipsis`/`overflow:hidden` and the phone pill is `flex:none` (Header.astro:100), so the squeezed brand box visually overlaps the pill. Cosmetic, smallest-phone-only, no page horizontal scroll. Does not block deploy. |
| PERF-FONT-CACHE-DOC | global.css font-refresh comment contradicted the cache header | ✅ | Comment (global.css:1–7) says "7-day max-age + 30-day stale-while-revalidate (NOT immutable)"; firebase.json `/fonts/**` header is `max-age=604800, stale-while-revalidate=2592000` (=7d/30d exactly), no `immutable`. Filenames are non-content-hashed (global.css:13) and both preload hrefs exist (BaseLayout.astro:113,120). Documentation now matches the header. |
| ASSET-OG-SVG | Editable `og-image.svg` shipped into dist/ unused | ✅ | `public/` holds only `og-image.png` + `favicon.svg` (no SVG og source). Editable source relocated to `design-reference/og-image.svg`; site.ts:25–27 comment and regen command updated to point there. All `og:image`/`twitter:image` resolve to `/og-image.png` in built `dist/index.html`. |

## Deploy-readiness sweep

The sweep is **clean** — nothing blocks deploy. Detail on the one item the prior review flagged as a blocker, plus the confirmations:

### [RESOLVED — reviewer blocker invalid] "CSP pins a placeholder hash → dead form"

- **File:** firebase.json (committed `script-src`) / scripts/gen-csp.mjs / package.json / .github/workflows/deploy.yml
- **Finding:** The prior reviewer treated `firebase.json`'s `script-src` as a hand-pinned, hand-maintained hash and concluded the production form script would be CSP-blocked. **That premise is false.** `package.json` build is `astro build && node scripts/gen-csp.mjs`. `gen-csp.mjs` walks the freshly built `dist/`, hashes every executable inline `<script>` (correctly skipping `src=` externals and `application/ld+json` data blocks, lines 51–52), and **rewrites the `script-src` in `firebase.json` to match what actually shipped**. CI (deploy.yml:58–63) runs `npm run build` with the real `PUBLIC_FORM_ENDPOINT` repo variable, then `firebase deploy` — so the deployed CSP carries the hash of the real-endpoint form script, not the committed placeholder.
- **Empirically verified (this pass):**
  - Placeholder build (`ALLOW_PLACEHOLDER_ENDPOINT=true`) → gen-csp emits exactly the committed `'sha256-436MhGPs…'`. So the committed value is just a preview-build artifact.
  - Real-endpoint build (`PUBLIC_FORM_ENDPOINT=https://script.google.com/.../exec`) → gen-csp **rewrites** `script-src` to a new form-script hash (`'sha256-aX6FS//4…'` for my test URL), with the two endpoint-independent hashes (`g4LhE4Gg…` nav, `ydLWXD2H…` print) carried through unchanged. The hash being endpoint-dependent is exactly why it is generated, not pinned.
  - Build guard works: a no-endpoint `npm run build` exits non-zero with the `[form-endpoint-guard]` error (astro.config.mjs:24–31), so a preview/dead-form build can never ship.
- **Net:** the very fix the reviewer recommended ("CI computes CSP hashes from built dist") already exists and is wired into the default build. No action required.

### Confirmed correct (no issues)

- **CSP allows the form POST + fonts.** `connect-src 'self' https://script.google.com https://script.googleusercontent.com` and `form-action` likewise — covers the `fetch(FORM_ENDPOINT, {mode:'no-cors'})` POST (InquiryForm.astro:276). `font-src 'self'` matches the self-hosted `/fonts/*.woff2`. `img-src 'self' data:` covers the OG PNG and inline data URIs. The form script itself is allowlisted via the auto-generated hash (above).
- **Head / OG / canonical correct.** BaseLayout.astro emits absolute `canonical` and `og:image`/`twitter:image` (built `dist/index.html` shows `https://noprofits.org/` and `https://noprofits.org/og-image.png`), full OG dimension/type/alt set, `summary_large_image` Twitter card, and Organization JSON-LD as a non-executed `ld+json` block (correctly excluded from `script-src`). Pre-launch `noindex` is commented out (this is a live indexable site). All referenced head assets exist in `public/`: `logo.png`, `favicon.svg`, `favicon-32.png`, `apple-touch-icon.png`, `og-image.png`.
- **Sitemap / routing correct.** `@astrojs/sitemap` with `site: https://noprofits.org` produced `dist/sitemap-index.xml` + `dist/sitemap-0.xml` listing all 5 public routes (home, 3 guides, privacy) with absolute `<loc>`s.
- **Form round-trips.** Endpoint injected at build from `PUBLIC_FORM_ENDPOINT` (site.ts:45–46); `isRealEndpoint` gates real-POST vs. honest preview notice; honeypot, native validation, in-flight button state, network-error retry path, and inline `role="status"` success are all present (InquiryForm.astro:236–288).

## DEPLOY DECISION

**CLEAR TO DEPLOY.**

Optional fast-follows (post-deploy, none gating):
- **RESP-PHONE polish (LOW):** below ~360px, add `overflow:hidden; text-overflow:ellipsis` to `.np-wordmark` (or hide `.np-wordmark__tld`, or let the phone pill shrink) so the bar fits cleanly at 320/360px instead of relying on `overflow-x:hidden` to clip the overlap. Cosmetic, smallest-phone-only.
- **Operational reminder (not a code change):** the live deploy depends on the `PUBLIC_FORM_ENDPOINT` repo *variable* being set to the deployed Apps Script `/exec` URL — if it is unset/placeholder in CI, the build guard correctly **fails the deploy** rather than shipping a dead form. Confirm that variable (plus the WIF `GCP_WIF_PROVIDER` / `GCP_DEPLOY_SA` one-time setup in deploy.yml) is configured before the first push to `main`.