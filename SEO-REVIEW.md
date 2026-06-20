# Pre-Launch SEO Review — noprofits.org

**Scope:** Static Astro 5 marketing site (free websites for Seattle non-profits), Firebase Hosting + Google Apps Script lead capture. Audited against day-one readiness: will it rank, index correctly, and share well?
**Date:** _____________ (fill at sign-off)

---

## Executive Summary

**Launch verdict: GO-WITH-FIXES.**

The site is structurally sound for SEO — valid canonicals, a working sitemap, clean Organization + Service + Article JSON-LD, correct `Allow: /` robots, and an honestly-indexable head. It will get crawled and indexed on day one. But two defects undercut the site's own value proposition ("forms that email you," "shares well") and must be cleared before launch, plus one broken canonical on the 404.

**Must-fix before launch:**

1. **Wire the real form endpoint** (`FORM_ENDPOINT` is still a placeholder) — every lead is currently discarded while the visitor is told it was "logged and emailed." This is a total conversion failure for a lead-gen site, and it makes the on-page/guide copy demonstrably false. _(Blocker)_
2. **Rasterize the OG/Twitter share image to PNG** — the SVG card is dropped by Facebook/LinkedIn/X scrapers, so shares ship with no thumbnail. _(High)_
3. **Fix the 404 canonical** — it points at `/404/`, a URL Firebase never serves. _(Low, but trivial)_
4. **Trim over-length titles and meta descriptions** on the homepage and three guides so SERP snippets aren't clipped mid-sentence. _(Low)_

Everything below Low is polish that does not block go-live.

---

## Findings by Severity

### Blocker

#### ☐ Lead form ships non-functional — submissions go nowhere
**`src/data/site.ts:39-45`** (handler: `src/components/InquiryForm.astro:185`)

> `export const FORM_ENDPOINT = '[CONFIRM: Apps Script /exec URL]';` … `export const isRealEndpoint = FORM_ENDPOINT.startsWith('https://script.google.com');`

`InquiryForm.astro:185` guards the only network call with `if (isRealEndpoint)`. With the placeholder, `isRealEndpoint` is `false`, so **no POST fires** — the form just swaps in the inline success state (`form.hidden = true; success.hidden = false`) and tells the visitor "Your details have been logged and emailed to our team" (`InquiryForm.astro:103`).

**Why it matters:** The entire site is a lead funnel. On launch day every visitor who fills the form sees a confirmation while their data is silently discarded — zero leads captured, and the failure is invisible until someone wonders why no inquiries arrive. The code comments mark this as an intentional "concept-demo mode" deferred step, but **nothing enforces the flip** — no CI guard, no build warning, just the author remembering.

**Fix:** Deploy the Apps Script web app (`apps-scripts/leads_sheet/Code.js` is complete and deploy-ready — `doPost` appends to the Leads sheet and emails the team) and paste the real `/exec` URL into `FORM_ENDPOINT`. `isRealEndpoint` flips `true` automatically; no other code change is needed. Verify with a live test submission (row appears in Sheet + email received). **Make a real endpoint a hard launch gate.**

---

### High

#### ☐ OG/Twitter share image is an SVG that major scrapers reject
**`src/data/site.ts:29`** (emitted at `src/layouts/BaseLayout.astro:32, 81, 88`)

> `export const OG_IMAGE_PATH = '/og-image.svg';`

`BaseLayout.astro:32` builds `ogImage` from this path and emits it into both `og:image` (line 81) and `twitter:image` (line 88, with `twitter:card=summary_large_image`). `public/` contains only `og-image.svg` — no PNG. The code's own comment concedes: _"a few scrapers (Facebook, some LinkedIn) prefer/require PNG/JPG over SVG."_

**Why it matters:** Facebook, LinkedIn, and X card scrapers do not render SVG `og:image` — they drop it and show a bare text/link card. The site markets "shares well on day one," but with an SVG card it ships with no thumbnail on exactly the channels non-profits share to. This is the highest-impact social-sharing defect at launch and is trivially preventable.

**Fix:** Rasterize `public/og-image.svg` to a 1200×630 PNG (the SVG is already authored at exactly that canvas — `viewBox 0 0 1200 630`, matching the `og:image:width/height` tags at `BaseLayout.astro:82-83`), save as `public/og-image.png`, and flip `OG_IMAGE_PATH` to `/og-image.png`. Do this before launch, not as a "someday" upgrade.

---

### Medium

#### ☐ On-page and guide copy promise functionality the form does not deliver
**`src/pages/index.astro:258`** (also `src/pages/guides/forms-that-email-you.astro:54-58`, `src/components/InquiryForm.astro:103`)

> Contact section: _"What happens next: your submission is saved to a Google Sheet and emailed to our team — the same simple, free setup we'll build into your site."_

The Forms guide makes the same promise, and the form success state asserts "Your details have been logged and emailed to our team." All three are false while `FORM_ENDPOINT` is the placeholder.

**Why it matters:** This is a credibility/trust problem for a site whose pitch _is_ "forms that email you" (hero trust badge, `index.astro:64`). Shipping a dead form that claims it emailed the team makes the flagship promise untrue to the first real prospect. (Note: this is a trust/conversion issue, not a crawler-visible SEO signal — Googlebot doesn't submit forms — and it shares the same root cause and fix as the Blocker above.)

**Fix:** Same root fix — wire `FORM_ENDPOINT` before launch so the promise is true. Do not launch the contact/guide copy until a test submission confirms a Sheet row + email.

---

### Low

#### ☐ 404 canonical points at a URL Firebase never serves
**`src/pages/404.astro:10`**

> `path="/404/"` → built `dist/404.html` contains `<link rel="canonical" href="https://noprofits.org/404/">`

Astro special-cases `404.astro` → `dist/404.html` (no `dist/404/` directory), and `firebase.json` has no `cleanUrls`/`rewrites`, so Firebase serves it at `/404.html`. The canonical `/404/` itself resolves to a 404.

**Why it matters:** A self-referencing canonical that 404s is a broken signal. The page is served with a 404 status and is correctly absent from the sitemap, so Google won't index it — impact is bounded — but a dangling self-canonical is incorrect and can confuse validators.

**Fix:** Change `path` to `"/404.html"` so the canonical matches the served URL, or (cleaner for an error page) drop the canonical for the 404 and add a `noindex` robots meta to it specifically.

#### ☐ Meta descriptions exceed the ~155–160-char display limit (homepage + all 3 guides)
**`src/data/site.ts:10` (`SITE_DESCRIPTION`, used on index) + `src/pages/guides/*.astro`**

Measured from built HTML: index = 186 chars; `forms-that-email-you` = 197; `launch-free-on-google-workspace` = 167; `seo-basics-for-nonprofits` = 218. Google truncates around 155–160 chars (~920px).

**Why it matters:** Day-one SERP snippets get cut mid-sentence (SEO-basics loses ~60 chars), reading as unfinished and wasting the most persuasive copy on the exact pages meant to convert non-profits. Impact is bounded — Google often rewrites snippets and length is not a ranking factor — so this is polish, not a blocker.

**Fix:** Trim each to ~150–155 chars, front-loading the keyword/value prop so the truncated tail isn't load-bearing. Either shorten `SITE_DESCRIPTION` or give `index.astro` its own tighter `description` prop distinct from the longer JSON-LD/OG copy.

#### ☐ Two guide titles exceed the ~60-char SERP title width
**`src/pages/guides/launch-free-on-google-workspace.astro:5`, `src/pages/guides/seo-basics-for-nonprofits.astro:5`**

Built titles: _"Launch your non-profit site free on Google Workspace — Guide | noprofits.org"_ = 76 chars; _"Get found on Google: SEO basics for non-profits — Guide | noprofits.org"_ = 71 chars (`forms` guide = 69). `BaseLayout.astro:64` renders the title verbatim, so the const length is what ships.

**Why it matters:** The `— Guide | noprofits.org` suffix and trailing words get clipped, losing the brand/qualifier. Lower impact than descriptions since the keyword-rich head survives.

**Fix:** Tighten the suffix (drop `Guide |` or shorten to `… | noprofits.org`) and trim the descriptive head so the visible portion is self-contained, keeping each under ~60 chars.

#### ☐ Article schema on all 3 guides omits image, datePublished, dateModified, author
**`src/pages/guides/launch-free-on-google-workspace.astro:10-18`** (identical in the other two guides)

> `const articleLd = { '@context': …, '@type': 'Article', headline, description, url, publisher: {…}, inLanguage: 'en' };`

No `image`, `datePublished`, `dateModified`, or `author` on any of the three Article nodes.

**Why it matters:** These are Google **recommended** (not required) Article properties; absence yields "missing recommended field" warnings, not errors. The markup stays valid and indexes fine. `author` + dates are worth adding for E-E-A-T/freshness on advice content.

**Fix:** Add `datePublished`/`dateModified` (ISO 8601), `author` (`{ '@type': 'Organization', name: SITE_NAME, url: SITE_URL }`), and `image` (an absolute 1200×630 URL — reuse the og-image **once it's rasterized to PNG**; this part depends on the High fix). Optionally add `mainEntityOfPage` pointing at the canonical.

#### ☐ Organization logo is a 32×32 favicon SVG, not a rich-result-eligible logo
**`src/layouts/BaseLayout.astro:40`**

> `logo: new URL('/favicon.svg', SITE_URL).href`

Resolves to `public/favicon.svg` — `<svg … viewBox="0 0 32 32">`, a 32px circle with the letter "n". No raster logo exists in `public/`.

**Why it matters:** Google's Organization logo guidance recommends ~112×112 minimum; a 32px favicon is well below it, so the logo likely won't trigger for Search/knowledge-panel display. (Note: SVG is now an accepted structured-data image format — the real defect is the size and that it's a favicon glyph, not a logo. No rich snippet breaks; sharing is handled separately by OG tags.)

**Fix:** Ship a dedicated square raster logo (`public/logo.png`, ≥112×112, ideally 512px) and reference it as an `ImageObject`: `logo: { '@type': 'ImageObject', url: '<abs>/logo.png', width: 512, height: 512 }`. Keep `favicon.svg` for `<link rel=icon>`.

#### ☐ Organization schema omits sameAs and a postal address
**`src/layouts/BaseLayout.astro:35-51`**

The `orgLd` object has `name`, `url`, `logo`, `description`, `email`, `areaServed`, `contactPoint` — but no `sameAs` array and no `address`/`PostalAddress`.

**Why it matters:** `sameAs` is the primary signal Google uses to reconcile an Organization to a real-world entity; a `PostalAddress` helps local relevance for a geographically-scoped service. Both are **recommended**, not required — the schema is valid and indexable without them. Note `sameAs` is currently **un-actionable**: the repo exposes zero social/profile URLs (Footer has only a mailto + in-page anchors), so this is a future-launch item, not a pre-launch gap.

**Fix:** Add `sameAs: [ …real profile URLs ]` once those profiles exist. Optionally add a minimal `PostalAddress` (`addressLocality: 'Seattle'`, `addressRegion: 'WA'`, `addressCountry: 'US'`). If a verifiable address exists, consider `LocalBusiness`/`ProfessionalService` for stronger local eligibility.

#### ☐ Pre-launch de-index toggle is self-defeating (Disallow blocks the crawl that reads noindex)
**`public/robots.txt:2-3`**

> _"PRE-LAUNCH: to de-index before going live, replace 'Allow: /' with 'Disallow: /' below AND uncomment the noindex meta in BaseLayout.astro."_

Doing **both** is contradictory: `Disallow: /` stops Googlebot from fetching any page, so it can never read the `noindex` meta that `BaseLayout.astro:73` would emit. The two mechanisms are mutually exclusive, not additive.

**Why it matters:** If the site is ever pushed live with both toggles flipped (the documented procedure), already-discovered URLs (via sitemap or external links) can be indexed-but-blocked, showing "No information is available for this page." For this brand-new, never-indexed site the blast radius is small, but the comment teaches a procedure that bites on a future staging push.

**Fix:** Rewrite the comment to: _"EITHER uncomment the noindex meta (preferred — keep `Allow: /` so Google can crawl and obey it) OR set `Disallow: /` alone — do not do both."_

#### ☐ Guides are internal-linking dead ends (no cross-links, no CTA path)
**`src/pages/guides/forms-that-email-you.astro:32`**, `seo-basics-for-nonprofits.astro:32`, `launch-free-on-google-workspace.astro:32`

> Each guide's only outbound internal link: `<a href="/" class="np-guidebar__back">← Back to site</a>`

Zero guide-to-guide links and no link to the contact/inquiry section. (Confirmed `BaseLayout` injects no global nav onto guide pages — Header/Footer live only in `index.astro`.)

**Why it matters:** The homepage fans out to all three guides, but no link equity or crawl path flows back out or laterally, and a searcher landing on a guide has no path to convert. The guides aren't orphans (the back link keeps them crawlable and equity flows in), so this is an optimization, not an indexing blocker.

**Fix:** Add a "Related guides" block at the foot of each guide linking the other two by descriptive anchor text, plus a "Start your free site" link to `/#contact`. Point the back link at `/#guides` (both anchors exist: `index.astro:206`, `248`).

#### ☐ Google Fonts loaded as a render-blocking stylesheet
**`src/layouts/BaseLayout.astro:99-102`**

> `<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:…&family=Hanken+Grotesk:…&display=swap" rel="stylesheet" />`

A synchronous cross-origin CSS request on every page, pulling two families with many weights. The hero H1 (`.np-h1`, `index.astro:49`) uses Bricolage Grotesque — the likely LCP element.

**Why it matters:** A render-blocking cross-origin font CSS adds a round trip before paint, a documented Core Web Vitals drag that undercuts the site's "fast loads" claim (`index.astro:143`). Impact is **already softened**: `display=swap` (text paints in a fallback immediately, no FOIT) and `preconnect` to both font hosts (lines 97-98) are present, so this is a refinement, not a blocking defect.

**Fix:** Self-host both families via Astro 5's `experimental.fonts` to drop the cross-origin round trips, or at minimum load the Google CSS non-blocking (`media="print" onload="this.media='all'"` + `<noscript>` fallback) and trim to only the weights used. Self-hosting is the right call for a static site that touts speed.

#### ☐ Form has no native action/method — fails completely without JavaScript
**`src/components/InquiryForm.astro:18-23`**

> `<form class="np-form" data-np-form data-endpoint={FORM_ENDPOINT} data-real-endpoint={String(isRealEndpoint)}>`

No `action`/`method`. Submission is 100% JS (the inline `submit` listener calls `e.preventDefault()` then `fetch`).

**Why it matters:** No SEO impact (crawlers don't submit forms; Googlebot executes the hydrated page). Purely a no-JS progressive-enhancement gap. Note the obvious "add `action={FORM_ENDPOINT}`" fix is currently **inert** — `FORM_ENDPOINT` is the placeholder, so a native POST would resolve a bogus relative URL and 404. Revisit only once a live endpoint exists.

**Fix (post-endpoint):** Add `action={FORM_ENDPOINT}` and `method="post"` so the form natively POSTs when JS is absent (`Code.js doPost` already reads `e.parameter`); keep the JS handler's `preventDefault()` for the no-reload enhancement.

#### ☐ No `<noscript>` fallback or messaging on the form
**`src/components/InquiryForm.astro` (whole file)**

`grep noscript` across `src/` returns nothing; all interactivity (incl. the success state) lives behind the inline script.

**Why it matters:** Minor a11y/progressive-enhancement polish, not an SEO signal. The "visitor is stranded" concern is overstated for this repo — the org is reachable without JS site-wide: `Header.astro:13` renders a `tel:` link, `Footer.astro:26` a `mailto:`, and the hero form itself renders `InquiryForm.astro:54` "Or call 206-532-6395." What's genuinely true: a no-JS submit click is inert with no inline explanation.

**Fix:** Add a one-line `<noscript>` hint near the form pointing to `tel:+12065326395` / `hello@noprofits.org`. Pair with the native `action` (above) once the endpoint is live.

---

### Nit

#### ☐ Pre-launch noindex is a manual two-file toggle with no build guard
**`src/layouts/BaseLayout.astro:73`, `public/robots.txt:2-6`** — De-indexing requires hand-editing two files; nothing fails the build if only one is flipped. The site currently ships in the correct go-live state (no noindex, `Allow: /`, canonicals + sitemap present). Optional hardening: drive both from a single env flag (e.g. `IS_PREVIEW`) so the state is atomic, or add a CI check that the two agree. **No action required for go-live.**

#### ☐ `areaServed` mixes free-text with a region code
**`src/layouts/BaseLayout.astro:43,49`** — Org-level `areaServed` is the free-text `'Greater Seattle and the Puget Sound region'` while `contactPoint.areaServed` is `'US-WA'`. Both are valid `Text`; no error, no rich-result impact. Optional polish: represent structurally and consistently (e.g. `{ '@type': 'AdministrativeArea', name: 'Greater Seattle, WA' }`), keeping the human string for display copy.

#### ☐ Value-pillars H3 group has no governing H2
**`src/pages/index.astro:83-99`** — The three pillar cards use `<h3>` with no section `<h2>`, so they nest under the hero form card's `<h2>Get your site — right now.</h2>` (line 71). Not a skipped level (H2→H3 is valid); muddies the outline only cosmetically. Optional: add a visually-hidden `<h2>` (e.g. "Why non-profits choose us").

#### ☐ Hero form-card H2 precedes the first content-bearing H2
**`src/pages/index.astro:71`** — `<h2>Get your site — right now.</h2>` is the first H2, before keyword-bearing section H2s (lines 107, 138). Valid hierarchy; spends the most prominent secondary-heading slot on a CTA label. Optional: demote the form-card title to a styled non-heading element.

#### ☐ Guide cards render literal "guide cover" placeholder text
**`src/pages/index.astro:217,226,235`** — Each card cover is `<div class="np-guidecard__cover" aria-hidden="true"><span>guide cover</span></div>`, and CSS renders it as visible centered monospace text (not hidden). `aria-hidden`, so no SEO/alt impact — but it reads as an unfinished stub on the page Google ranks first. Replace with a real cover image/illustration, or remove the filler and keep the decorative background.

#### ☐ No `trailingSlash`/redirect normalization pinned in `firebase.json`
**`firebase.json:1-20`** — Only `public`, `ignore`, `headers`. The trailing-slash strategy is internally consistent end-to-end (Astro directory output + slash canonicals + slash sitemap + slash links), and Firebase's default 301-redirects the non-slash form to match — so there is **no defect today**. Forward-looking hardening only: optionally pin `"trailingSlash": true` and add a `www`→apex redirect once a custom domain is connected, so the served URL can never drift from the canonical.

#### ☐ No prefetch configured
**`astro.config.mjs:8-12`** — No `prefetch` key; no `data-astro-prefetch` anywhere. Guide-card clicks are cold full-document fetches. Zero indexing/sharing impact; a perceived-performance nicety on a 4-page site. Optional: add `prefetch: true` to `defineConfig`.

#### ☐ Organization JSON-LD logo points at favicon.svg (raster preferred)
**`src/layouts/BaseLayout.astro:40`** — Duplicate of the Low logo finding above, restated at nit altitude; tracked there. Add a square raster `public/logo.png` (≥112×112) and point `logo` at it.

---

## Cleared / Not an Issue (checked, refuted)

- **"Both slash and non-slash URLs resolve 200 (duplicate content / wasted crawl budget)."** Refuted. Firebase Hosting 301-redirects the non-slash form to the directory-index slash URL by default — there are **not** two 200 URLs. Astro's directory build emits only the slash form, and every canonical/link/sitemap entry already matches it. The proposed `firebase.json trailingSlash:true` is a no-op making the existing default explicit. No duplicate-content exposure at deploy.
- **"No HTML/CSS minification (ship unminified output)."** Refuted by the actual built `dist/`. Astro 5 ships `compressHTML: true` by default: `dist/index.html` is minified (inter-tag whitespace stripped) and CSS is extracted to hashed, single-line minified bundles in `dist/_astro/`. Adding `astro-compress` would be redundant. (Raster image optimization is genuinely absent, but the only images are SVG, which don't benefit — non-actionable.)
- **Core head/indexability is clean.** Canonicals build from `new URL(path, SITE_URL)` and resolve correctly on all real pages; `robots.txt` correctly ships `Allow: /`; the sitemap integration emits valid slash-form URLs; the noindex meta is correctly commented out for a public launch; Organization + Service + Article JSON-LD all parse and emit cleanly.

---

## Prioritized Pre-Launch Checklist

1. **[Blocker] Deploy the Apps Script web app and paste the real `/exec` URL into `FORM_ENDPOINT` (`site.ts:39`).** Confirm a live test submission lands a Sheet row **and** an email. This single fix also clears the Medium copy-honesty finding. **Hard launch gate.**
2. **[High] Rasterize `og-image.svg` → `public/og-image.png` (1200×630) and set `OG_IMAGE_PATH = '/og-image.png'`.** Validate with Facebook Sharing Debugger + X Card Validator before launch.
3. **[Low] Fix the 404 canonical:** set `path="/404.html"` in `404.astro` (or drop the canonical + add `noindex` there).
4. **[Low] Trim titles + meta descriptions** on the homepage and all three guides to ~60 / ~155 chars, front-loading the value prop.
5. **[Low] Enrich Article JSON-LD** on the three guides with `author` + `datePublished`/`dateModified` now; add `image` once the OG PNG exists (step 2).
6. **[Low] Add a square raster `logo.png` (≥112×112)** and reference it as an `ImageObject` in `orgLd`.
7. **[Low] Add lateral "Related guides" + `/#contact` CTA links** to each guide; point the back link at `/#guides`.
8. **[Low] Rewrite the `robots.txt` de-index comment** to an EITHER/OR procedure.
9. **[Low] Make fonts non-render-blocking** (self-host via `experimental.fonts`, or async-load + trim weights).
10. **[Nit, post-endpoint] Add native `action`/`method` + a `<noscript>` fallback** to the form once a live endpoint exists.
11. **[Nit] Cosmetic polish:** replace "guide cover" placeholders, add the pillars `<h2>`, optionally pin `trailingSlash`/`www` redirect once the domain is connected, add `prefetch: true`, structure `areaServed`.

Items 1–2 are the only true launch blockers; the rest can ship as fast-follow if needed, but 3–5 are cheap and worth doing in the same pass.