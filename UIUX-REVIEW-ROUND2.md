# Pre-Launch UI/UX Re-Review — noprofits.org (Round 2)

_Generated 2026-06-20 · follow-up to UIUX-REVIEW.md_

## 1. Intro

The implementation team worked the Round-1 punch list against `UIUX-REVIEW.md` (20 findings). This round re-verifies all 20 prior findings against the **current working tree** (not the touched-file list — actual code), and runs a fresh adversarial regression sweep on what changed: the inquiry form + Apps Script backend, the self-hosted fonts + CSP, the new `privacy.astro` / `GuideFooterCta.astro` surfaces, and the SEO/icons/routing head. Every claim below is cited to `file:line` in the current tree and was checked against the source — a touched file was not assumed fixed. Two prior HIGH-severity gaps remain open, and the regression sweep surfaced nine new issues (one HIGH, three MED, five LOW), several of which converge on the same two root causes (an SVG OG card and an opaque `no-cors` form that cannot see server-side drops).

## 2. Punch-list scorecard

| ID | Severity | Title | Status | Residual |
|----|----------|-------|--------|----------|
| FORM-01 | HIGH | Network failure shows success — lead silently lost | ✅ Fixed | Server-error (non-network) drops still show success — see new MED |
| FORM-02 | HIGH | Demo endpoint shows "logged and emailed" + can ship live | ✅ Fixed | None — build guard empirically aborts |
| A11Y-STEP4 | HIGH | Step-4 accent body text 3.49:1 | ✅ Fixed | None (now #fff = 4.58:1) |
| CONTENT-GUIDES | HIGH | Guides drop Header/Footer — dead ends | ✅ Fixed | Top-nav parity absent by design (np-guidebar covers nav-back/CTA/contact) |
| SEO-OG | HIGH | OG/Twitter image is SVG — scrapers drop it | ❌ Open | Rasterize to 1200×630 PNG, flip `OG_IMAGE_PATH` |
| PERF-FONTS | HIGH | Render-blocking Google Fonts | ✅ Fixed | None — fully self-hosted woff2 |
| A11Y-ACCENT-TEXT | MED | Accent #2F7DA3 fails AA on light bg | ✅ Fixed | None (now `--accent-deep` #1C5572) |
| RESP-FOOTER-TAP | MED | Footer links 24px — below 44px | ✅ Fixed | None |
| VIS-HERO-SUB | MED | Hero subhead 17px, never steps to 19px | ❌ Open | Add desktop media-query step to 19px |
| IA-ANCHORS | MED | Bare `#contact` dead on 404/guides | ✅ Fixed | None — root-absolute `/#…` everywhere |
| PERF-HERO-LCP | MED | Hero LCP animates opacity from 0 | 🟡 Partial | Default render path still fades LCP H1; only reduced-motion mitigated |
| A11Y-NAV-FOCUS | LOW | Same-page anchors don't move focus | ❌ Open | Add `tabindex="-1"` to section targets or focus JS |
| A11Y-REQ | LOW | Required asterisk sub-AA + no legend | 🟡 Partial | Contrast fixed (#B0551F); no `*` legend |
| RESP-PHONE | LOW | Header phone pill can wrap | ❌ Open | Add `white-space:nowrap` to `.np-header__phone` |
| VIS-CARD6 | LOW | Sixth feature card ~3× longer | ❌ Open | Trim card-6 body to ~100 chars |
| IA-GUIDE-XLINK | LOW | Guides don't cross-link / no index | ✅ Fixed | None (GuideFooterCta cross-links) |
| CONTENT-DEMO-COPY | LOW | Demo success copy over-promises | ✅ Fixed | None |
| SEO-404 | LOW | 404 indexable, no noindex | ✅ Fixed | None (noindex emitted, sitemap excludes) |
| SEO-ICONS | LOW | Only favicon.svg | ✅ Fixed | None (apple-touch + PNG + theme-color) |
| PERF-BACKDROP | LOW | Sticky header backdrop-blur repaints | ❌ Open | Defer/wontfix acceptable; blur is load-bearing |

**Tally: 12 fixed · 3 partial · 5 open · 0 regressed.**

## 3. Still-open & partial items

**`SEO-OG` [HIGH] OG/Twitter share image is an SVG.**
**Current state:** `src/data/site.ts:29` still `export const OG_IMAGE_PATH = '/og-image.svg';`. `public/` contains only `og-image.svg` (1520 B) — no PNG/JPG raster exists. `src/layouts/BaseLayout.astro:93` and `:100` emit that SVG into `og:image` and `twitter:image`, while `:94-95` hard-assert `og:image:width=1200`/`height=630` and `:97` declares `twitter:card=summary_large_image`. The site is PRE-LAUNCH; the in-file comment defers this as a "LAUNCH UPGRADE," but launch is now.
**Still needs:** Rasterize `public/og-image.svg` → `public/og-image.png` at exactly 1200×630, set `OG_IMAGE_PATH = '/og-image.png'`, optionally add `<meta property="og:image:type" content="image/png">`. Verify with a real scraper (opengraph.xyz / FB Sharing Debugger) post-deploy.

**`VIS-HERO-SUB` [MED] Hero subhead never reaches spec 19px desktop.**
**Current state:** `src/pages/index.astro:304-311` sets `.np-h1-sub { font-size:17px; }` with no responsive override. The two hero media queries (`:351` min-width 600px, `:357` min-width 1200px) touch grid/card rules only, never `.np-h1-sub`. File is byte-identical to HEAD — never touched.
**Still needs:** Step `.np-h1-sub` to 19px inside the desktop breakpoint.

**`PERF-HERO-LCP` [MED] Above-the-fold hero fades opacity 0→1 on the LCP element.**
**Current state:** `.np-hero__copy` (which wraps the LCP `<h1>`, `index.astro:49/54`) still carries `animation: npFadeUp 0.7s ease both;` (`index.astro:289`); the keyframe `from { opacity:0 }` (`global.css:125-128`) with `both` fill paints the H1 transparent until first frame. A new `prefers-reduced-motion` block (`global.css:76-85`) collapses duration — a real a11y win — but Lighthouse/CrUX measure the default path, which still animates.
**Still needs:** Drop `opacity` from `npFadeUp` (animate transform only) or exclude `.np-h1` from the fade.

**`A11Y-NAV-FOCUS` [LOW] Same-page anchors don't move keyboard focus.**
**Current state:** No section target (`#top/#how/#features/#guides/#contact`, `index.astro:47/109/139/211/253`) carries `tabindex="-1"`; no hashchange/focus JS exists. Keyboard/SR users scroll but focus stays on the link.
**Still needs:** Add `tabindex="-1"` to each in-page target, or a small focus-on-hashchange handler.

**`A11Y-REQ` [LOW] Required asterisk — contrast fixed, legend missing.**
**Current state:** Contrast half FIXED — `--req: #B0551F` (`global.css:46`) on white = 5.04:1, clears AA. Asterisk is a live text node (not `aria-hidden`) and every input carries native `required`. Legend half OPEN — no "* = required" key anywhere in `InquiryForm.astro`.
**Still needs:** A short legend (e.g. "Fields marked * are required"). LOW; mitigated by native `required`, acceptable to ship.

**`RESP-PHONE` [LOW] Header phone pill can wrap.**
**Current state:** `Header.astro:84-97` `.np-header__phone` has no `white-space:nowrap` / `flex-shrink:0`; the hyphenated `206-532-6395` can break at ~320px. File unchanged from HEAD.
**Still needs:** `white-space:nowrap;` (+ `flex-shrink:0;`) on `.np-header__phone`.

**`VIS-CARD6` [LOW] Sixth feature card ~1.75× longest sibling.**
**Current state:** `index.astro:163` body is 175 chars vs ~96-101 for siblings; no equalizing CSS on `.np-feature`. Title's "~3×" is overstated but the ragged-row imbalance is real and untouched.
**Still needs:** Trim to ~100 chars or add `min-height`/equalizing CSS.

**`PERF-BACKDROP` [LOW] Sticky header backdrop-blur repaints each scroll frame.**
**Current state:** `Header.astro:39-46` still `position:sticky` + `backdrop-filter:blur(10px)` over `rgba(247,244,238,0.85)`; no `will-change`/GPU hint. Untouched.
**Still needs:** Nothing required — blur is visually load-bearing (translucent bg) and modern browsers GPU-promote sticky+backdrop-filter. Defer/wontfix is reasonable for a static marketing site.

## 4. New issues introduced (regression sweep)

### [HIGH] og:image ships as SVG while the head asserts a 1200×630 raster card
**File:** `src/data/site.ts:29` → consumed `src/layouts/BaseLayout.astro:35`, emitted `:93-100`
**Dimension:** SEO + head + icons + routing
**Problem:** `OG_IMAGE_PATH = '/og-image.svg'` is the literal value placed into both `og:image` and `twitter:image` on every page, alongside hard-coded `og:image:width=1200`/`height=630` (`:94-95`) and `twitter:card=summary_large_image` (`:97`). Facebook, LinkedIn, Twitter/X, iMessage, Slack, and Discord all reject `image/svg+xml` OG cards, so the head promises a large raster card that doesn't exist as a shipped raster — shared links render with no preview, the worst case for a lead-gen site built to be shared. (This is the regression-sweep restatement of the still-open SEO-OG; it is the single most consequential pre-launch gap.)
**Fix:** Rasterize `public/og-image.svg` → `public/og-image.png` at 1200×630, set `OG_IMAGE_PATH = '/og-image.png'`, add `<meta property="og:image:type" content="image/png">`. If it truly must wait, at minimum drop the `og:image:width/height` meta so the head stops asserting a card that isn't served. CSP needs no change.

### [MED] Success is shown for Apps Script server-side rejections (rate-limit / validation)
**File:** `src/components/InquiryForm.astro:238-249` (client) / `apps-scripts/leads_sheet/Code.js:56-58, 73-75`
**Dimension:** forms + Apps Script
**Problem:** The submit uses `mode:'no-cors'`, so the response is opaque — `fetch` resolves (`.then → showSuccess`, `:243-244`) for **every** HTTP outcome and only rejects on a true network failure. But `Code.js` has reject paths that return a 200 body of `'error'` or `'ignored'` without throwing: the per-minute rate limit (`Code.js:57`, returns `'error'`) and the minimal-validation gate when no name or no valid email/phone survives (`Code.js:74`, returns `'ignored'`). In all those cases the visitor still sees the success panel while **nothing was saved and no email was sent**. A throttled lead during a burst, or a phone-only/imperfect-email submission, is silently lost behind a success screen — the same "form that lies about capturing the lead" class the build guard exists to prevent, relocated to runtime.
**Fix:** Close on the server, since the opaque response can't distinguish these client-side: (a) for the rate limit, still `appendRow` the lead when throttled and only skip the email (mirror the existing daily-email-cap pattern at `Code.js:94-115`) instead of returning `'error'` with no persistence; (b) loosen the `'ignored'` gate so a phone-only/imperfect-email lead is stored rather than dropped. For true success/failure signalling you'd need a CORS-readable response, but at minimum stop the server from dropping leads on paths the client reports as success.

### [MED] `name="company"` honeypot can be autofilled, false-flagging legit leads as bots
**File:** `src/components/InquiryForm.astro:26-31` (client) / `apps-scripts/leads_sheet/Code.js:48-49`
**Dimension:** forms + Apps Script
**Problem:** The honeypot is an off-screen text input named `company` with `tabindex=-1` and `autocomplete="off"`. Despite the hint, 1Password / LastPass / Bitwarden and several browsers populate fields named `company`/`organization` from saved identity data — and the user never sees it because it's off-screen. If filled, the client silently no-ops (`:225`) and, if it posts anyway, `Code.js:49` silently drops it. A non-profit staffer with an org name in their password manager submits, sees nothing happen (silent `return`), and never reaches you — indistinguishable from a broken form. `company` is one of the most commonly autofilled identity fields and is the worst possible honeypot name.
**Fix:** Rename the honeypot to a non-identity token (e.g. `website_url` or `np_hp`), keep `autocomplete="off"`, and update `Code.js:49` to read the renamed field. Additionally, if the honeypot trips on the client, give the user *some* outcome rather than a silent `return` so a false positive doesn't look like a dead form.

### [LOW] No loading state during the in-flight POST
**File:** `src/components/InquiryForm.astro:237-249`
**Dimension:** forms + Apps Script
**Problem:** On a real submit the only feedback is `submitBtn.disabled = true` (`:237`). The button keeps its original label, gets no `aria-busy`, no spinner. On a slow connection the visitor sees a greyed-out button with no signal anything is happening — inviting a confused reload that abandons the submit. SR users get nothing announced between submit and the success region appearing.
**Fix:** On submit set `submitBtn.setAttribute('aria-busy','true')`, stash the label and swap to "Sending…", then clear `aria-busy` in `.catch` (already re-enables) and on success.

### [LOW] Dead `data-endpoint` / `data-real-endpoint` attributes leak the /exec URL into static HTML
**File:** `src/components/InquiryForm.astro:21-22`
**Dimension:** forms + Apps Script
**Problem:** The `<form>` renders `data-endpoint={FORM_ENDPOINT}` and `data-real-endpoint={String(isRealEndpoint)}`, but the script (`:185, :238`) imports `FORM_ENDPOINT`/`isRealEndpoint` from `site.ts` and never reads either attribute — they are dead markup. Worse, `data-endpoint` hard-codes the live `/exec` URL into the rendered static HTML of every form page, directly contradicting `site.ts:36-38`, which justifies the env-var indirection specifically to keep the URL "out of the public repo… close the bot-harvest path." Echoing it into a stable, scrapeable attribute undercuts that intent.
**Fix:** Delete lines 21-22. The script already has what it needs from the `site.ts` import.

### [LOW] Self-hosted fonts use stable filenames but are served `Cache-Control: immutable` for 1 year
**File:** `firebase.json:20-27`
**Dimension:** fonts + perf + CSP
**Problem:** `/fonts/**` is `public, max-age=31536000, immutable`, but the files are named `bricolage-grotesque.woff2` / `hanken-grotesk.woff2` with no content hash (unlike fingerprinted `/_astro/**`). `global.css:1-4` documents the refresh path as "overwrite the two woff2 files." `immutable` tells the browser never to revalidate, so a client that cached the old subset keeps it for up to a year after you overwrite it — no cache-busting because the URL never changes.
**Fix:** Fingerprint the font filenames (and the `@font-face src` at `global.css:10/18`) so `immutable` is safe; or drop `immutable`/lower `max-age` for `/fonts/**`. Cleanest: import the fonts through Astro/Vite so they land in `/_astro` with a content hash.

### [LOW] Body/LCP font (Hanken Grotesk) is not preloaded — only the heading font is
**File:** `src/layouts/BaseLayout.astro:110-116`
**Dimension:** fonts + perf + CSP
**Problem:** Only `/fonts/bricolage-grotesque.woff2` is preloaded. Hanken Grotesk renders all above-the-fold body text — hero subhead, lead paragraph, CTA buttons, form labels — but its `@font-face` lives in the render-blocking stylesheet, so its URL isn't discovered until that CSS parses; combined with `font-display:swap`, every above-fold body string paints in fallback then visibly swaps. The body font drives more above-fold pixels than the single H1, so the most visible swap is the un-preloaded one.
**Fix:** Add a second `<link rel="preload" href="/fonts/hanken-grotesk.woff2" as="font" type="font/woff2" crossorigin>`. Both subsets are tiny (Hanken 34 KB, Bricolage 75 KB).

### [LOW] GuideFooterCta "More free guides" is a styled `<p>`, not a heading, and the aside has no accessible name
**File:** `src/components/GuideFooterCta.astro:31` (aside), `:42` (label)
**Dimension:** a11y + visual + new pages
**Problem:** The cross-link label uses `<p class="np-guidecta__morehead">More free guides</p>` (`:42`), styled uppercase/accent-deep so it visually reads as a heading, but as a `<p>` it's skipped by SR heading navigation and the link list (`:43-52`) has no programmatic label. The wrapping `<aside>` (`:31`) is a complementary landmark with no `aria-label`/`aria-labelledby`, so it announces as an unnamed region. (Token contrast here was verified AA-clean — muted #5A665F on cream 5.46:1, accent-deep morehead on white 8.10:1 — so this is purely structural.)
**Fix:** Make the label a real heading (`<h2 class="np-guidecta__morehead">`, styled down) so it enters the heading tree and labels the list; give the `<aside>` an accessible name via `aria-labelledby` pointing at the existing CTA `<h2>` (`:33`) or a plain `aria-label`.

## 5. Updated launch verdict

**GO-WITH-FIXES.** The two HIGH-impact lead-integrity systems (the form's network-failure honesty and the preview/build guard, FORM-01/FORM-02) are genuinely closed, and 12 of 20 prior findings are fully fixed with no regressions. But the site cannot launch as-is because (1) **every shared link renders with no preview card** (SEO-OG / new HIGH — SVG OG image the head advertises as a 1200×630 PNG), and (2) **the form can still silently lose leads** on Apps Script's rate-limit and validation reject paths while showing the success screen (new MED), and (3) the **`company` honeypot can be autofilled** by password managers, dropping legitimate non-profit leads with no feedback (new MED).

**Must happen before public launch:**
1. Rasterize the OG card to a 1200×630 PNG and point `OG_IMAGE_PATH` at it (SEO-OG / HIGH).
2. Make `Code.js` persist every accepted lead on the rate-limit and validation paths so a throttled/phone-only lead isn't dropped behind a success screen (new MED).
3. Rename the honeypot off `company` to a non-identity token and update `Code.js:49` (new MED).

**Strongly recommended (cheap, ship same pass):** delete the dead `data-endpoint` attributes (LOW, leaks the /exec URL); add an "in-flight/Sending…" state (LOW). The remaining open items — hero subhead 19px step, hero-LCP fade, nav focus, required-field legend, phone-pill nowrap, card-6 length, font cache headers, second font preload, GuideFooterCta heading/landmark naming, header backdrop-blur — are all LOW/MED polish and may follow as a fast-follow without blocking launch.