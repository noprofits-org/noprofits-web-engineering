# Pre-Launch UI/UX Re-Review — noprofits.org (Round 3)

_Generated 2026-06-20 · follow-up to UIUX-REVIEW-ROUND2.md_

## 1. Scope

The implementation team worked the Round-2 outstanding list. This round re-verifies each carried-forward item against the current working tree (not against the team's claims) and runs a fresh adversarial regression sweep over the files touched this round: `apps-scripts/leads_sheet/Code.js`, `src/components/{Header,InquiryForm,GuideFooterCta}.astro`, `src/data/site.ts`, `src/layouts/BaseLayout.astro`, `src/pages/{index,privacy}.astro`, `guides/*.astro`, `src/styles/global.css`, `firebase.json`, `scripts/gen-csp.mjs`, and the new `public/og-image.png`. Every claim below was confirmed by reading current code; nothing was taken on faith because a file was "touched."

## 2. Round-2 Carry-Forward Scorecard

| ID | Severity | Title | Status | Residual |
|----|----------|-------|--------|----------|
| SEO-OG | HIGH | OG/Twitter image was an SVG scrapers drop | ✅ Fixed | Stray `og-image.svg` ships unused (see New #2) — cosmetic |
| FORM-SERVER-DROP | MED | Success shown for server-side rejections; leads dropped | ✅ Fixed | Opaque no-cors response still can't branch on server `'error'`/`'ignored'` — unreachable via the form today |
| FORM-HONEYPOT | MED | `company` honeypot autofilled by password managers | ✅ Fixed | None material |
| VIS-HERO-SUB | MED | Hero subhead 17px never steps to 19px desktop | ✅ Fixed | None |
| PERF-HERO-LCP | MED | Above-the-fold LCP element animates opacity from 0 | ✅ Fixed | None material |
| FORM-LOADING | LOW | No in-flight loading state during POST | ✅ Fixed | True-hang (no timeout/AbortController) leaves button stuck — rare edge, not the rated gap |
| FORM-DATA-ENDPOINT | LOW | Dead `data-endpoint` attrs leak /exec into HTML | ✅ Fixed | None (endpoint still in bundled JS — unavoidable, expected) |
| PERF-FONT-CACHE | LOW | Stable-named fonts served immutable 1yr | ✅ Fixed | Stale-font window now ~7d; stale comment in global.css (see New #1) |
| PERF-FONT-PRELOAD | LOW | Body/LCP font (Hanken) not preloaded | ✅ Fixed | None |
| A11Y-GUIDECTA | LOW | "More free guides" a styled `<p>`; aside unnamed | ✅ Fixed | Two sibling `<h2>`s; stricter audit might want `<h3>` — cosmetic |
| A11Y-NAV-FOCUS | LOW | Same-page nav anchors don't move keyboard focus | ✅ Fixed | None for in-scope targets |
| A11Y-REQ | LOW | Required-field legend missing | ✅ Fixed | None |
| RESP-PHONE | LOW | Header phone pill can wrap on small phones | 🟡 Partial | Internal wrap fixed, but rigid pill now overflows the bar / wraps the brand wordmark on ≤~390px phones |
| VIS-CARD6 | LOW | Sixth feature card copy longer than siblings | ❌ Open | Copy untouched (106 chars vs ~100); no height equalization |
| PERF-BACKDROP | LOW | Sticky header backdrop-blur repaints each scroll frame | ❌ Open (wontfix-acceptable) | Untouched; deliberate accept at LOW |

**Tally:** 12 ✅ Fixed · 1 🟡 Partial · 2 ❌ Open (one is an accepted wontfix) · 0 ⛔ Regressed. Every HIGH and MED item is closed.

## 3. Still-Open & Partial

**`RESP-PHONE` [LOW]** Header phone pill can wrap on small phones
**Current state:** `src/components/Header.astro:88-89` adds `white-space: nowrap; flex: none;` to `.np-header__phone`, so the number `206-532-6395` can no longer wrap mid-digit and the pill won't shrink — the literal Round-2 symptom is closed. But the bar (`.np-header__bar`, Header.astro:47-53) is a no-wrap flex row `brand | phone | toggle` with `gap:16px` and the only media query is `min-width:900px` (Header.astro:161) — there is **no small-phone branch**. `.np-container` padding is `2×20px` (global.css:158-159), giving 350px content on a 390px iPhone and 280px on a 320px phone. The intrinsic row (brand ~165px + pill ~153px + 44px toggle + 32px gaps ≈ 394px) exceeds both. With the pill now rigid and nothing else allowed to yield, the overflow is forced onto the brand wordmark (no `nowrap`/`flex:none`, Header.astro:76-81 — it wraps to two lines) or into horizontal overflow of the sticky header. There is **no `overflow-x` guard** on `html`/`body` (the only `overflow:hidden` in global.css is on `.np-visually-hidden`, line 144).
**Still needs:** Below a small breakpoint, either shrink phone `padding`/`font-size`, allow the brand wordmark to `nowrap` + shrink, or hide the inline pill on the narrowest phones (still reachable via the menu CTA). Add `overflow-x:hidden` on the root as a safety net.

**`VIS-CARD6` [LOW]** Sixth feature card copy longer than siblings
**Current state:** `src/pages/index.astro:164` — the "Printable forms & flyers" body is still "Host intake forms, sign-ups, and flyers on your site — anyone can print a clean, current copy on demand." (106 chars vs siblings at ~96–101). Byte-identical to HEAD; no trim, and no equalizing CSS — `.np-feature__p` (index.astro:460) has no `min-height`/`line-clamp` and the grid auto-sizes.
**Still needs:** Trim card-4 to ~100 chars to match siblings, OR formally downgrade to won't-fix — impact is minimal because `.np-feature` cards have no border/background chrome, so the uneven height reads only as a slightly larger gap under shorter siblings.

**`PERF-BACKDROP` [LOW]** Sticky header backdrop-blur repaints each scroll frame
**Current state:** `Header.astro:39-46` is unchanged — `position:sticky; top:0` with `backdrop-filter: blur(10px)` over `rgba(247,244,238,0.85)`. No `will-change` anywhere in `src/`. Per-frame re-blur on scroll persists.
**Still needs:** Nothing for launch — this is the Round-2 accepted wontfix. If future profiling shows jank on low-end devices, reduce blur radius or drop `backdrop-filter` for a translucent solid.

## 4. New Issues This Round

The regression sweep surfaced two LOW issues, both downstream of the (correct) font-cache and OG fixes. Neither is a launch blocker. No new MED/HIGH regressions were introduced by any Round-2 change — the form backend, head tags, animations, focus targets, and CSP all verified clean.

### [LOW] global.css font-refresh comment now contradicts the cache header
**File:** `src/styles/global.css:3` (paired with `firebase.json:20-27`)
**Dimension:** fonts + head/docs consistency
**Problem:** This round changed `/fonts/**` from immutable to `public, max-age=604800, stale-while-revalidate=2592000` (firebase.json:24). The font URLs are **not** content-hashed (`/fonts/bricolage-grotesque.woff2`, `/fonts/hanken-grotesk.woff2`), and the global.css comment (line 3-4) still says the fonts are "cached immutable via firebase.json … overwrite the two woff2 files." That instruction is now factually wrong on the immutable claim, and following it (overwrite in place) leaves returning visitors on a stale font for up to ~7 days hard (and up to ~37 days under SWR) with no cache-bust. Functionally fine for launch (fonts rarely change), but the doc and the header now disagree.
**Fix:** Either keep stable filenames + SWR and correct the comment to "cached 7 days with 30-day stale-while-revalidate; a font swap requires a filename bump (e.g. `…-v2.woff2`, updating the `@font-face src` and both preload hrefs together) to be immediately visible," or restore the immutable policy and version the filename on every refresh.

### [LOW] Editable `og-image.svg` source ships into dist/ as unused public payload
**File:** `public/og-image.svg` (1,520 bytes → copied to `dist/og-image.svg`)
**Dimension:** assets / scraper hygiene
**Problem:** `OG_IMAGE_PATH` correctly points at `/og-image.png` (site.ts:27), verified self-consistent with `og:image:type=image/png` + `1200×630` meta (BaseLayout.astro:94-96) and the real raster on disk (`file`: PNG 1200×630, 88,023 bytes). The original editable SVG is retained in `public/` as source-of-truth, but anything under `public/` is copied verbatim into `dist/`, so `/og-image.svg` is publicly fetchable yet referenced by no page or meta tag (only a code comment at site.ts:25). Harmless, but it's dead deploy weight and an over-eager SVG-preferring scraper could still pick it up.
**Fix:** Move the editable SVG out of `public/` (e.g. into `design-reference/`) so it isn't copied into `dist/`, and update the comment at `src/data/site.ts:25` to point at the new location. Only the PNG needs to ship.

## 5. Updated Launch Verdict

**GO.**

Every HIGH and MED issue from Round 2 is verified fixed against current code: the OG image is a genuine 1200×630 PNG with matching meta, the Apps Script backend always persists a usable lead and only gates the notification email (no silent drops), the honeypot is renamed off identity-like names with matching client/server tokens and visible-success feedback, the hero subhead steps to 19px on desktop, and the LCP copy block animates transform-only. The only residue is three LOW items (one partial, two open — one of which is an accepted wontfix) plus two new LOW asset/doc-hygiene nits.

Nothing on that list blocks a public launch. Recommended (not required) fast-follows, in priority order:
1. **RESP-PHONE** — add a small-phone breakpoint (shrink/hide the pill or let the wordmark yield) + root `overflow-x:hidden`. This is the one with real on-device visual fallout (brand-wordmark wrap / header overflow on ≤~390px phones) and is the strongest candidate to fix before launch.
2. Correct the stale "immutable" font comment in `global.css:3` (New #1).
3. Move `og-image.svg` out of `public/` (New #2); trim or accept VIS-CARD6.