# Pre-Launch SEO Re-Review — noprofits.org (Pass 2)

**Site:** noprofits.org — free marketing websites for Seattle non-profits
**Stack:** Static Astro 5 → Firebase Hosting; forms POST to a Google Apps Script web app
**Scope:** Second-pass re-review after the implementation team worked the 11-item punch list (18 files changed). Covers head/meta, structured data, crawl/index, content/semantics, Astro config, and GAS form integration.
**Review date:** _[YYYY-MM-DD]_
**Auditor:** Lead pre-launch SEO

---

## 1. Executive Summary

**Launch verdict: GO-WITH-FIXES.**

The punch list moved the needle substantially. The previous **blocker** (Item 1 — a form that claimed success while POSTing nowhere) is genuinely **fixed**: `FORM_ENDPOINT` is now build-time injected from `PUBLIC_FORM_ENDPOINT`, gated behind `isRealEndpoint`, and a build guard in `astro.config.mjs` refuses to ship the placeholder. No dishonest-success-with-no-endpoint path remains. The render-blocking Google Fonts dependency is gone (self-hosted, `font-display: swap`, preloaded, immutable-cached). The 404 canonical, title/meta trims, the orgLd `logo.png` ImageObject, the new privacy page (correctly in the sitemap), and lateral guide CTAs are all done correctly.

**Scorecard: 7 of 11 prior items fixed, 3 partial, 1 not-fixed.**

There are **no remaining blockers**. There is **one High** item that has now carried across two reviews and should not launch unfixed:

**Must-fix before launch:**
1. **🔁-adjacent / carried-over (High):** Rasterize `og-image.svg` → `og-image.png` (1200×630) and flip `OG_IMAGE_PATH`. The share card is still an SVG, which Facebook/LinkedIn/X silently drop — every shared link renders a blank preview card on the primary distribution channel for a lead-gen site. (Resolving this also unblocks the Article-`image` JSON-LD tail of Item 5.)

**Should-fix (cheap, real):**
2. **(Medium)** Add recovery copy to the form success state (silent-drop window under Apps Script rate-limit / validation rejection — opaque `no-cors` can't see it).
3. **(Low)** Rewrite the `robots.txt` pre-launch comment as EITHER/OR (Item 8).

Everything else open is Nit-level cosmetic.

---

## 2. Prior Punch List — Status

| # | Item | Status | Proof |
|---|------|--------|-------|
| 1 | Wire real `FORM_ENDPOINT` (blocker) | ✅ fixed | `src/data/site.ts:44-46` reads `import.meta.env.PUBLIC_FORM_ENDPOINT`; `:52` `isRealEndpoint` gate; build guard in `astro.config.mjs`; real `/exec` lives in GitHub repo Variables, not the repo |
| 2 | Rasterize og-image → PNG + flip `OG_IMAGE_PATH` | ❌ not-fixed | `src/data/site.ts:29` still `OG_IMAGE_PATH = '/og-image.svg'`; `public/og-image.png` absent (`ls public/`); built `dist/index.html` og:image = `…/og-image.svg` |
| 3 | Fix 404 canonical | ✅ fixed | `src/pages/404.astro:10` `path="/404.html"` + `noindex`; resolves to canonical `/404.html` and emits `robots noindex` (`BaseLayout.astro:85`) |
| 4 | Trim titles (~60) + meta descriptions (~155) | ✅ fixed | Home title 58 chars (`index.astro:13`); guides 54–56; privacy/404 ~30; descriptions 139–152 chars, all unique |
| 5 | Article author / datePublished / dateModified (+ image) | ⚠️ partial | Author + dates present (`guides/seo-basics-for-nonprofits.astro:19-22`); `image` property still absent on all three guide LDs — correctly deferred until the PNG exists |
| 6 | `logo.png` ImageObject in orgLd | ✅ fixed | `BaseLayout.astro:42-48` emits `ImageObject url=/logo.png width:512 height:512`; the real `public/logo.png` is exactly 512×512 — dimensions accurate |
| 7 | Lateral related-guides + `/#contact` CTA + back link | ✅ fixed | `GuideFooterCta.astro:38` `/#contact`, `:46` `/guides/{slug}/`; wired into all 3 guides; back link `/#guides` in each guidebar |
| 8 | Rewrite robots.txt de-index comment as EITHER/OR | ❌ not-fixed | `public/robots.txt:2-3` still says replace Allow→Disallow **AND** uncomment noindex — the counterproductive combo |
| 9 | Non-render-blocking fonts (self-host + trim) | ✅ fixed | `global.css:5-19` `@font-face` + `font-display:swap` + `/fonts/*.woff2`; `BaseLayout.astro:110-116` preload + crossorigin; `dist/fonts/` has both woff2; no googleapis/gstatic refs; `firebase.json:19-27` immutable cache |
| 10 | Native `action`/`method` + `<noscript>` fallback | ❌ not-fixed | `InquiryForm.astro:18-23` `<form>` has `data-endpoint`/`data-real-endpoint` but no `action=`/`method=`; no `<noscript>` anywhere in `src/`; `e.preventDefault()` unconditional (`:217`) |
| 11 | Cosmetic bundle (pillars `<h2>`, guide-cover placeholders, structured areaServed, trailingSlash/www, prefetch) | ⚠️ partial | trailingSlash internally consistent via default directory format (✅), but pillars still `<h3>` with no section `<h2>` (`index.astro:92,97,102`), guide-cover placeholders remain (`index.astro:222,231,240`), areaServed still a bare string (`site.ts:19`), prefetch not added |

---

## 3. New & Remaining Findings

Grouped by corrected severity. No regressions were introduced by the punch-list changes — every open item below is a pre-existing carryover (none marked 🔁).

### Blocker
_None._

### High

#### [ ] og:image / twitter:image still ship as SVG — social cards render blank on Facebook, LinkedIn, and X (carried-over Item 2)
- **File:** `src/data/site.ts:29` (emitted via `BaseLayout.astro:93,100`)
- **Evidence:** `OG_IMAGE_PATH = '/og-image.svg'`. `public/og-image.png` does not exist (`ls public/` shows only `og-image.svg`, plus the team's new `logo.png`, `favicon-32.png`, `apple-touch-icon.png` — no rasterized share card). `BaseLayout.astro:35` builds `ogImage = new URL(OG_IMAGE_PATH, SITE_URL).href`; lines 93 and 100 emit `og:image` and `twitter:image` from it; built `dist/index.html` confirms both as `content="https://noprofits.org/og-image.svg"`. Lines 94–95 hardcode `og:image:width=1200` / `og:image:height=630` around the SVG. The `site.ts:21-28` comment itself flags this as an unfinished "LAUNCH UPGRADE."
- **Why:** Facebook, LinkedIn, and X do not render SVG `og:image` — they silently drop it. For a lead-gen marketing site whose primary distribution is shared links, every shared URL (homepage and all guides) shows a blank/fallback preview card on the core acquisition path. The advertised 1200×630 dimensions are also misleading to scrapers while pointed at an SVG (this self-corrects once the PNG ships — it is a symptom, not a separate finding). Shipping the SVG instead of a 404 is a mild mitigation (no hard miss) but does not change the rendered result. This is the same High item from the last review.
- **Fix:** Rasterize `public/og-image.svg` → `public/og-image.png` at 1200×630 (e.g. `rsvg-convert -w 1200 -h 630 public/og-image.svg -o public/og-image.png`, or sharp/resvg), then set `OG_IMAGE_PATH = '/og-image.png'` in `src/data/site.ts:29`. The width/height meta and `twitter:card=summary_large_image` already match — only the asset + path flip are needed. **Resolving this also clears the deferred Article-`image` tail of Item 5 (below).**

### Medium

#### [ ] Opaque `no-cors` fetch reports success even when Apps Script rejects the lead (rate-limit / server validation drop)
- **File:** `src/components/InquiryForm.astro:238-249` (server side: `apps-scripts/leads_sheet/Code.js:53-75`)
- **Evidence:** `fetch(FORM_ENDPOINT, { method:'POST', mode:'no-cors', … }).then(() => showSuccess()).catch(…)`. Under `mode:'no-cors'` the response is opaque, so `.then()` resolves for **any** settled request and `.catch()` (`:246`) only fires on a true network failure. `Code.js` returns HTTP 200 with a non-`ok` body in two cases: the rate limit (`:56-58`, returns `'error'` when hits ≥ `RATE_LIMIT_PER_MIN=12`, a single global minute bucket per `:53-54`) and server validation (`:73-75`, returns `'ignored'` when name/contact missing). In both, the visitor sees the success state ("We've got your details", `InquiryForm.astro:97/103`) while nothing was appended or emailed. The code comment (`:234-236`) acknowledges opacity but frames only the network-failure case.
- **Why:** The Item 1 fix closed the "no endpoint" dishonest-success case; this is the orthogonal "endpoint rejected it" case it didn't cover. For normal single-visitor traffic with a valid form, submission succeeds correctly (client-side `reportValidity()` at `:221` largely pre-empts the `'ignored'` path). The residual silent-drop window opens only under rate-limit contention — the cap is one global minute bucket shared across all visitors, so a small burst or scripted flood pushes legit visitors past it, and each sees false success. A dropped-but-confirmed lead is the worst outcome on a lead-gen site: the org thinks it applied and never hears back. Not a baseline-broken defect, but a real unrecoverable-lead edge worth a cheap mitigation. (An accepted limit of `no-cors`; HANDOFF deliberately ruled out a CORS proxy.)
- **Fix:** (1) Soften the success copy — add "if you don't hear back within a few days, email hello@noprofits.org" so a silent drop is recoverable; and/or (2) widen or per-scope the rate limit (currently throttles all visitors together). A true status-aware path needs a CORS-enabled proxy (out of scope). At minimum, ship the recovery copy.

### Low

#### [ ] robots.txt pre-launch comment still says "Disallow AND noindex" — the counterproductive combo (Item 8)
- **File:** `public/robots.txt:2-3`
- **Evidence:** Lines 2–3 read: *"to de-index before going live, replace \"Allow: /\" with \"Disallow: /\" below **AND** uncomment the noindex meta in BaseLayout.astro."* `BaseLayout.astro:84` confirms the noindex meta exists, commented out. As currently shipped the site is correctly fully indexable (`Allow: /`, meta commented) — harm only triggers if an operator follows this instruction verbatim during a lockdown.
- **Why:** Combining `Disallow: /` with a `noindex` meta is a well-known anti-pattern: once robots.txt blocks the crawl, Googlebot never fetches the HTML and never sees the noindex, so externally-linked URLs can persist as URL-only index entries — exactly the leak the lockdown is trying to prevent. The two methods are mutually exclusive.
- **Fix:** Rewrite as EITHER/OR, e.g.: *"PRE-LAUNCH de-index — pick ONE: (A) block crawling via `Disallow: /` (fast; already-linked URLs may still show URL-only); OR (B) guarantee removal by keeping `Allow: /` and uncommenting the noindex meta (crawler must fetch the page to read it). Do NOT combine both — a Disallowed page is never fetched, so its noindex is never read."*

#### [ ] Article JSON-LD on all three guides omits the recommended `image` property (deferred tail of Item 5)
- **File:** `src/pages/guides/seo-basics-for-nonprofits.astro:12-23` (also `forms-that-email-you.astro:11-22`, `launch-free-on-google-workspace.astro:11-22`)
- **Evidence:** Each `articleLd` has `@type Article`, `headline`, `description`, `url`, `publisher`, `author`, `datePublished`, `dateModified`, `inLanguage` — but no `image`. Grep for `image` across the three guides returns only body copy. The asset it would reference (`public/og-image.png`) does not exist; `OG_IMAGE_PATH` is still `/og-image.svg`.
- **Why:** Google's Article structured-data guidance lists `image` as a recommended (high-value) property — its absence forfeits richer image treatment in Search/Discover (the pages still validate and index fine). **Correctly deferred:** Google's image pipeline ignores SVG, so pointing `image` at the current SVG would not help. Blocked on the same missing PNG as the High item above.
- **Fix:** Once `public/og-image.png` exists, add `image: new URL('/og-image.png', SITE_URL).href` (or a per-guide cover) to each `articleLd`. Until then, do **not** point `image` at the SVG.

### Nit

#### [ ] No native `action`/`method` and no `<noscript>` fallback — JS-off visitors get a dead form (Item 10)
- **File:** `src/components/InquiryForm.astro:18-23`
- **Evidence:** `<form>` carries only `data-endpoint`/`data-real-endpoint`; no `action=`/`method=`; `grep -rn noscript src/` returns nothing; `e.preventDefault()` is unconditional (`:217`). `firebase.json:71` CSP `form-action` already permits `script.google.com`/`script.googleusercontent.com`, so a native POST is policy-allowed.
- **Why:** Named punch-list item, gated on the endpoint existing — that precondition is now met, but the fallback wasn't added. JS-off audience is negligible on a static marketing site, and the native-POST half is itself imperfect (a native form-action POST to Apps Script `/exec` navigates the browser to the opaque `googleusercontent.com` response page — no redirect back to noprofits.org is wired). The cleanly-correct half is just the missing `<noscript>` contact note.
- **Fix:** Add a `<noscript>` block pointing to hello@noprofits.org + the phone number. Optionally add `action={FORM_ENDPOINT} method="post"` (meaningful only when `isRealEndpoint`); keep `e.preventDefault()` so the enhanced path wins. Trivial.

#### [ ] Value-pillars section has no section `<h2>` — three `<h3>` nest under the hero's form-card h2 (Item 11)
- **File:** `src/pages/index.astro:88-106`
- **Evidence:** The pillars section renders three `<h3 class="np-pillar__h">` (`:92, :97, :102`) with no `<h2>` of its own; the nearest preceding `<h2>` is the hero form-card title "Get your site — right now." (`:76`). **No heading level is skipped** — the linear outline is h1 (`:54`) → h2 (`:76`) → h3, so this is an outline-quality nicety (the h3s nest under the hero's h2 rather than a dedicated pillars heading), not a broken hierarchy.
- **Why:** A small document-outline improvement for AT/crawlers; the page otherwise has a clear h1 plus well-formed h2-anchored sections (How it works `:112`, Features `:143`, Guides `:216`, Contact `:257`).
- **Fix:** Optional — add a visually-hidden or visible `<h2>` (e.g. "Why non-profits choose us") above the three pillar cards.

#### [ ] Homepage guide cards ship literal "guide cover" placeholder text (Item 11)
- **File:** `src/pages/index.astro:222` (also `:231, :240`)
- **Evidence:** `<div class="np-guidecard__cover" aria-hidden="true"><span>guide cover</span></div>` on all three cards. CSS (`:534-541`) renders the span as visible muted 11px monospace (no `display:none`/`font-size:0`/transparent), so "guide cover" shows centered on a diagonal-stripe background.
- **Why:** Placeholder copy reads as unfinished on a launch page. `aria-hidden`, so no a11y/crawler impact — purely cosmetic, visible to users.
- **Fix:** Drop the inner `<span>` (keep the decorative stripe), or add a real cover image with alt.

#### [ ] `areaServed` is unstructured free-text in orgLd, serviceLd, and contactPoint (Item 11)
- **File:** `src/data/site.ts:19`; `src/layouts/BaseLayout.astro:51,57`; `src/pages/index.astro:27`
- **Evidence:** `AREA_SERVED = 'Greater Seattle and the Puget Sound region'` (prose) is passed verbatim to `orgLd.areaServed` and `serviceLd.areaServed`; `contactPoint.areaServed` is the bare string `'US-WA'`. None use a nested `{ '@type': 'Place' | 'AdministrativeArea', name }` or `GeoShape`.
- **Why:** A string `areaServed` is schema.org-valid and passes Rich Results — purely an enhancement. A typed `Place`/`AdministrativeArea` gives a stronger machine-readable geo signal for a hyper-local service business.
- **Fix:** Optional — model `areaServed` as `{ '@type': 'AdministrativeArea', name: 'Seattle–Tacoma–Bellevue metropolitan area' }` in orgLd and serviceLd. The string form is ship-acceptable.

---

## 4. Cleared / Not an Issue

The following were checked this pass and are **confirmed fixed/correct** — not findings (resolving prior-review concerns):

- **Item 1 — dishonest-success blocker:** Resolved. `isRealEndpoint` gate (`site.ts:52`) + preview-mode honesty notice + `astro.config.mjs` build guard mean a dead/placeholder form cannot ship live.
- **Item 3 — 404 canonical:** Resolved. `path="/404.html"` + `noindex` (`404.astro:10`).
- **Item 4 — titles/descriptions:** All within budget, all unique.
- **Item 6 — orgLd logo:** `ImageObject` 512×512 with a real matching asset.
- **Item 7 — lateral guide links:** All three guides have related-guide links, `/#contact` CTA, and `/#guides` back link.
- **Item 9 — fonts:** Fully self-hosted, swap, preloaded, immutable-cached; zero Google Fonts references.
- **Privacy page integration:** New `/privacy/` page is in `dist/sitemap-0.xml` and resolves to a clean trailing-slash canonical — no sitemap/route mismatch.
- **trailingSlash consistency:** No `trailingSlash` config, but the default directory format makes the sitemap and all canonicals (home, privacy, guides) uniformly trailing-slash — internally consistent; no firebase header/redirect conflicts found.
- **No regressions:** None of the 18 changed files introduced a broken canonical, missing H1/alt, wrong font path/preload, or a header/redirect that conflicts with the canonicals.

---

## 5. Updated Pre-Launch Checklist (open items only)

**Before launch (High):**
1. [ ] Rasterize `og-image.svg` → `public/og-image.png` (1200×630); set `OG_IMAGE_PATH = '/og-image.png'` (`site.ts:29`).
2. [ ] Add `image:` to all three guide `articleLd` objects (same PR as #1 — depends on the PNG).

**Should-fix (cheap, real):**
3. [ ] Add recovery copy to the form success state (silent-drop window) and/or re-scope the Apps Script rate limit (`InquiryForm.astro` + `Code.js`).
4. [ ] Rewrite `robots.txt:2-3` pre-launch comment as EITHER/OR.

**Nice-to-have (Nit, ship-optional):**
5. [ ] Add `<noscript>` contact fallback to the form (and optionally native `action`/`method`).
6. [ ] Add a pillars-section `<h2>` (`index.astro`).
7. [ ] Replace/clean the "guide cover" placeholder text on homepage guide cards.
8. [ ] Structure `areaServed` as a typed `Place`/`AdministrativeArea`.

**Verdict:** Clear items 1–2 (and ideally 3–4) and this site is GO.