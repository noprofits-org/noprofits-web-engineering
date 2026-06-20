# Pre-Launch UI/UX Adversarial Review — noprofits.org

This review covers the **noprofits.org** marketing site: a static Astro 5 build (homepage, 404, three guide pages, shared Header/Footer/InquiryForm components, BaseLayout, global CSS, site config) plus the **Google Apps Script** form backend (`apps-scripts/leads_sheet/Code.js`) that receives lead-capture submissions. The intended design was checked against the `design-reference/*.dc.html` Color Spec, Mobile-First Design Spec, and Homepage comp.

**Method.** Seven dimensions — accessibility, forms, content/IA, SEO, performance, responsive, visual — were reviewed in parallel. Every candidate finding was then handed to an independent skeptic who tried to refute it against the actual code; only findings that survived adversarial verification with demonstrable user impact are reported below. Of the candidates raised, **14 were verified-and-dismissed** (see appendix), which is why the list below is deliberately short and high-confidence.

_Generated 2026-06-20_

---

## Executive Summary

| Severity | Count |
|----------|-------|
| Blocker  | 0 |
| High     | 6 |
| Medium   | 5 |
| Low      | 9 |
| **Total**| **20** |

There are no hard blockers, but six High findings cluster around the two things this site exists to do — **capture leads** and **be found/shared** — and they must be fixed before the public, indexable launch.

**The 3–5 things to fix before launch:**

1. **Guarantee the form actually sends, and never lie when it doesn't.** Today a network failure (or an unconfigured/placeholder endpoint) still shows "Your details have been logged and emailed to our team." For a lead-capture site, a silently dropped inquiry told as success is the worst possible failure. (FORM-01, FORM-02)
2. **Wire up the form endpoint before going live, and fail the build if it's still a placeholder.** `FORM_ENDPOINT` ships as `[CONFIRM: Apps Script /exec URL]`. If that ships, every real visitor's inquiry vanishes. (FORM-02)
3. **Replace the SVG social card with a real 1200×630 PNG/JPG.** Facebook, LinkedIn, X, Slack, iMessage, and Discord all drop SVG OG images — every shared link currently previews blank. (SEO-01)
4. **Self-host fonts.** The render-blocking Google Fonts stylesheet is the single biggest perf lever on an otherwise asset-free static site, plus a privacy/third-party-dependency concern for this audience. (PERF-01)
5. **Give the guide pages site chrome and a CTA.** The three guides — the most likely organic search entry points — have no nav, no "Get your free site" CTA, and no contact path. They're conversion dead-ends. (CONTENT-01)

---

## Findings by severity

### [HIGH] Network failure still shows success — lead silently lost
**File:** `src/components/InquiryForm.astro:188-202`
**Dimension:** Forms
**Problem:** The live POST is fire-and-forget. The success swap (`form.hidden=true`; show `.np-success`) runs synchronously right after `fetch()` regardless of outcome, and the `.catch()` only swallows the error. Because `mode:'no-cors'` makes the response opaque, the code also cannot distinguish a real success from a `500`/`'ignored'`/`'error'` return. So if the user's network is down, the Apps Script is undeployed, or `doPost` returns an error, the contact form still tells them "Your details have been logged and emailed to our team." A real lead is lost with zero signal to user or owner — the worst failure mode for a site whose whole purpose is lead capture.
**Fix:** Make the success swap conditional on the fetch settling without a thrown error: move the `form.hidden`/success-show into a `.then()` and add a `.catch()` that reveals an error region instead of swallowing it (`fetch(...).then(showSuccess).catch(showError)`). Add a visible `role="alert" aria-live="assertive"` error block (hidden by default) with copy like "We couldn't send that — please try again, or call/email us at &lt;phone&gt;/&lt;email&gt;," and re-show the form for retry. Even with an opaque `no-cors` response, a thrown `TypeError` still reliably fires on true network failure — catching the most damaging case.

### [HIGH] Concept-demo success copy claims the lead was "logged and emailed" when nothing was sent
**File:** `src/components/InquiryForm.astro:97,103` (gated by `src/data/site.ts:39,45`)
**Dimension:** Forms
**Problem:** `isRealEndpoint` is `false` while `FORM_ENDPOINT` is the placeholder `[CONFIRM: Apps Script /exec URL]`. In that mode the script skips the network entirely but still shows the same success markup: the contact variant asserts "Your details have been logged and emailed to our team" and the hero says "We've got your details and we'll reach out shortly." The file ships the placeholder by default, so if the site goes live with the endpoint still unconfigured, every real visitor is told their inquiry was received when it vanished.
**Fix:** Two parts. (1) Treat an unconfigured endpoint as a build-time failure — add a CI/build check (or `throw` in `site.ts`) when `!isRealEndpoint` during a production build, so the placeholder cannot ship live. (2) In demo mode, show distinctly non-committal copy ("Demo mode — form not yet connected") instead of the real "logged and emailed" confirmation, so a misconfigured launch fails loud, not silent.

### [HIGH] Step-4 accent card body text below AA contrast
**File:** `src/pages/index.astro:425` (`.np-step__p--accent`) / `:127`
**Dimension:** Accessibility
**Problem:** `.np-step__p--accent` renders `#cfe6dc` paragraph text on the solid `--accent` (`#2F7DA3`) background of the "Launch & own it" step card. Contrast is **3.49:1** — below the 4.5:1 AA floor for normal body text. The sentence ("You go live with a site that's yours — and we leave you the keys.") is essential content, not decoration.
**Fix:** Lighten the text to near-white (e.g. `#ffffff`, matching `.np-step__h--accent` which is already `#fff`) to clear 4.5:1, or darken the card background to `--accent-deep` (`#1C5572`), on which `#cfe6dc` reaches ~6.2:1.

### [HIGH] Guide pages drop the global Header and Footer — no nav, no CTA, no contact path
**File:** `src/pages/guides/launch-free-on-google-workspace.astro:28-36` (same in `seo-basics-for-nonprofits.astro:28-35`, `forms-that-email-you.astro:28-35`)
**Dimension:** Content / IA
**Problem:** All three guide pages render only a minimal sticky bar (a single "← Back to site" link + a Print button) and end with a plain text footer line. They do **not** include `<Header />` or `<Footer />` (BaseLayout renders neither; only `index.astro` and `404.astro` import them). So a visitor landing on a guide from Google search has no primary nav and no "Get your free site" CTA anywhere on the page — the only outbound action is back to the homepage root. The conversion CTA present on every other page is absent on exactly the pages most likely to be organic entry points, and the footer's email/explore links are gone too. The guides are a navigational dead-end.
**Fix:** Add `<Footer />` (and ideally `<Header />`) to the three guide pages for consistent chrome and a persistent CTA, or add an explicit conversion block at the end of each guide ("Want this built for you for free? Start your site →" linking to `/#contact`) plus links to the other two guides. At minimum, surface a "Start your site" CTA and a link back to `/#guides`.

### [HIGH] Social share card is an SVG — every major scraper shows no image
**File:** `src/data/site.ts:29` (and `BaseLayout.astro:32,81-83,88`)
**Dimension:** SEO / Social
**Problem:** `OG_IMAGE_PATH = '/og-image.svg'`, and both `og:image` and `twitter:image` resolve to it. Facebook, LinkedIn, X/Twitter, Slack, iMessage, and Discord do **not** render SVG OpenGraph/Twitter images — they silently drop them. The declared `og:image:width/height` 1200×630 describe a file none of these platforms will paint, and `twitter:card "summary_large_image"` falls back to no image. The in-file comment frames the SVG as "better than a 404 PNG," but functionally the share preview is blank on exactly the platforms that matter, so every shared link looks broken/unbranded.
**Fix:** Rasterize `public/og-image.svg` to a real 1200×630 `public/og-image.png` (or `.jpg`) before launch and set `OG_IMAGE_PATH = '/og-image.png'`. This is already flagged as a "LAUNCH UPGRADE" in the comment — promote it to a launch blocker. Keep the SVG only as the design source.

### [HIGH] Render-blocking Google Fonts stylesheet on the critical path; no font preload
**File:** `src/layouts/BaseLayout.astro:97-102`
**Dimension:** Performance
**Problem:** Fonts load via a render-blocking `<link rel="stylesheet">` to `fonts.googleapis.com` — the single largest perf lever on an otherwise asset-free static site. The browser must (1) connect to `fonts.googleapis.com`, (2) download the CSS, then (3) discover and download the woff2 files from `fonts.gstatic.com` — three serialized round-trips on the critical render path before the LCP heading (Bricolage Grotesque) can paint. Because the font binaries are only discovered after the CSS parses, preconnect alone doesn't fix the late fetch. There's also a privacy/GDPR angle to pulling fonts from Google for a non-profit audience, and a hard third-party dependency (Google Fonts outage = no custom fonts).
**Fix:** Self-host the two families with `@astrojs/font` (Astro 5.7+ experimental fonts) or fontsource (`@fontsource-variable/bricolage-grotesque`, `@fontsource-variable/hanken-grotesk`), import them so Astro fingerprints and serves them same-origin (already covered by the immutable woff2 cache rule in `firebase.json`), and drop the two preconnects plus the googleapis stylesheet link. Subset to latin only. If staying on Google Fonts short-term, at minimum add `<link rel="preload" as="font" type="font/woff2" crossorigin>` for the Bricolage weight used by the LCP H1 — but self-hosting is the correct pre-launch fix.

---

### [MEDIUM] Accent text color fails AA contrast on cream/offwhite backgrounds
**File:** `src/styles/global.css:166-172` (`.np-eyebrow`), `src/components/InquiryForm.astro:124` (`.np-form__call`), `src/pages/index.astro:537,546-553` (guidecard CTA)
**Dimension:** Accessibility
**Problem:** `--accent` (`#2F7DA3`) as small text scores only **4.17:1** on the cream page background (`#F7F4EE`) and **4.39:1** on offwhite panels (`#FBFAF6`) — both below the AA 4.5:1 floor for normal text. This affects every `.np-eyebrow` ("HOW IT WORKS", "WHAT YOU GET", "FREE GUIDES", "START YOUR SITE", all on cream sections) and accent links/CTAs on offwhite. The same accent passes on pure white (4.58:1), so the failure is background-specific and easy to miss. The CSS comments show the author already lifted other tokens for AA but missed accent-on-cream.
**Fix:** Use a darker accent for text on cream/offwhite. Switch text uses of `--accent` to `--accent-deep` (`#1C5572` ≈ 7.4:1 on cream), or introduce an `--accent-text` token darkened to ≥4.5:1 against `#F7F4EE` and apply it to `.np-eyebrow`, `.np-form__call`, `.np-guidecard__cta`. Keep `#2F7DA3` only for non-text fills (dots, marks, button backgrounds).

### [MEDIUM] Footer nav links are 24px tall — below the 44px tap-target minimum the spec mandates
**File:** `src/components/Footer.astro:82`
**Dimension:** Responsive
**Problem:** The Mobile-First Design Spec states "All tap targets are ≥44×44px with comfortable spacing" (`Mobile-First Design Spec.dc.html:54,113`). The footer link rule sets `min-height: 24px` with `font-size: 15px` and no extra vertical padding, so each Explore/Get-started link is only ~24px tall, stacked at `gap: 9px`. These are real navigation links a thumb has to hit on mobile, well under the 44px floor.
**Fix:** On `.np-footer__link` set `min-height: 44px` (or add `padding: 10px 0`) so the tap area reaches 44px while keeping the visual baseline; keep the column `gap` ≥8px. If the taller targets loosen the footer visually, offset the padding with negative margin on the column rather than dropping below 44px.

### [MEDIUM] Hero subhead is 17px and never steps up to the spec'd 19px desktop lead size
**File:** `src/pages/index.astro:299-306` (ref `Homepage.dc.html:61`, `Mobile-First Design Spec.dc.html:93`)
**Dimension:** Visual
**Problem:** The Homepage reference renders the hero sub-paragraph at 19px, and the type scale defines "Lead paragraph" as 17px mobile → 19px desktop. Every other lead uses `.np-lead`, which correctly bumps 17→19px at ≥900px (`global.css:160-178`). But the hero uses a bespoke `.np-h1-sub` fixed at 17px with no media-query step-up, so the most prominent paragraph on the page renders 2px smaller than spec at desktop — and smaller than the secondary contact-section lead directly below it. A visible typographic inconsistency on the highest-traffic surface.
**Fix:** Add `@media (min-width:900px){ .np-h1-sub{ font-size:19px } }`, or drop `.np-h1-sub` and apply the existing `.np-lead` class to the hero `<p>` (it already provides 17→19px, line-height 1.55, `text-wrap:pretty`). Reusing `.np-lead` is preferable so the hero stays locked to the scale.

### [MEDIUM] Contact CTA target written two ways (`#contact` vs `/#contact`) — shared header/footer anchors are dead on the 404
**File:** `src/pages/404.astro:23`; `src/components/Header.astro:33`; `src/components/Footer.astro:19-25`
**Dimension:** Content / IA
**Problem:** On-homepage CTAs use bare in-page anchors (`#contact`, `#how`, `#guides`), while off-homepage pages use absolute `/#contact`. But the Header and Footer are shared and render on the 404 too: `Header.astro:33` emits `href="#contact"` and `Footer.astro:19-25` emit `href="#how"` / `"#features"` / `"#contact"`. On the 404 those bare anchors point at on-page sections that don't exist, so the header/footer nav links are dead there (clicking "How it works" / "Start your site" in the 404 header does nothing).
**Fix:** Make the shared Header/Footer anchors root-absolute (`href="/#how"`, `/#contact`, etc.) so they resolve from any page including 404 and the guides. Astro still smooth-scrolls on the homepage and navigates-then-scrolls from other pages.

### [MEDIUM] Above-the-fold hero animates opacity from 0, delaying/penalizing LCP
**File:** `src/pages/index.astro:284-285` (keyframe at `global.css:101-104`)
**Dimension:** Performance
**Problem:** `.np-hero__copy` and `.np-hero__card` run `npFadeUp 0.7s ... both`, whose keyframe starts at `opacity: 0; translateY(14px)`. The hero copy contains the LCP element (the H1), and `both` fill mode applies the 0% frame before the animation starts — so the largest text renders invisible until the animation begins painting, deferring the LCP timestamp and creating a brief above-the-fold opacity shift on every load. Reduced-motion is handled (`global.css:54-62`), which is good, but the default path still penalizes LCP for everyone else.
**Fix:** Don't animate the above-the-fold LCP container's opacity from 0. Remove the entrance animation from `.np-hero__copy` (keep it only on below-fold sections), or start the keyframe at non-zero opacity (translateY only), or gate the fade behind an IntersectionObserver so only off-screen sections animate in. The hero should paint at full opacity on the first frame.

---

### [LOW] Same-page nav anchors don't move keyboard focus to the target section
**File:** `src/styles/global.css:49-61,84-86`
**Dimension:** Accessibility
**Problem:** Reduced-motion is correctly honored, but all primary nav is same-page hash links (`#how`, `#features`, `#guides`, `#contact`, `#top`). On activation the browser scrolls but doesn't reliably move keyboard focus to the target, because the `<section id>` targets aren't focusable and have no `tabindex`. A keyboard user can be left with focus on the header link while the viewport jumps, so the next Tab restarts from the top of the document.
**Fix:** Add `tabindex="-1"` to the scroll-target sections (`#how`, `#features`, `#guides`, `#contact`) so default fragment-focus lands inside the section, or script focus management on hash-link activation. The skip-link → `#main` works because `#main` is the `<main>` landmark; replicate that for the nav anchors.

### [LOW] Required-field indication is color + asterisk only; terracotta asterisk is sub-AA
**File:** `src/components/InquiryForm.astro:36,41,45,49` (`.np-req`) + `global.css:224`
**Dimension:** Accessibility
**Problem:** Required fields are flagged with a terracotta `*` (`.np-req`, `#C8632E` on white = 3.98:1, below 4.5:1 for this small glyph) plus the native `required` attribute. The `required` attribute is the real programmatic signal (so AT users are informed — hence low severity), but the asterisk's purpose is conveyed visually only, with no legend and a faint glyph for low-vision sighted users.
**Fix:** Darken `--req` to ≥4.5:1 and add a once-per-form legend ("Fields marked * are required"), or move "(required)" into the `.np-label` text the way "(optional)" already is, for symmetry.

### [LOW] Header phone pill can wrap / crowd on small phones — no nowrap or shrink protection
**File:** `src/components/Header.astro:84`
**Dimension:** Responsive
**Problem:** The mobile bar lays out brand (`margin-right:auto`) + phone pill + 44px hamburger in a single non-wrapping flex row with `gap: 16px`. The phone link "206-532-6395" has padding, a border, a leading dot, and no `white-space: nowrap`. The hyphenated number is a valid line-break point, and nothing sets `flex-shrink:0`, so on 320–360px viewports the phone number can wrap to a second line inside the bordered pill — breaking the single-line 44px pill and inflating header height.
**Fix:** Add `white-space: nowrap; flex: none;` to `.np-header__phone` so the pill keeps its intrinsic width, and add `min-width: 0` plus `overflow: hidden` on `.np-header__brand`/`.np-wordmark` so the wordmark compresses on the tightest screens instead. Verify at 320px and 360px.

### [LOW] Sixth feature card copy is ~3x longer than its siblings, breaking grid rhythm
**File:** `src/pages/index.astro:155-159` ("Printable forms & flyers")
**Dimension:** Visual
**Problem:** In the reference "What you get" grid all six cells carry roughly one-line body copy, giving a clean 3×2 grid with aligned heights. The build rewrote this item to a much longer paragraph ("Host intake forms, volunteer sign-ups, event flyers… No copier runs, never out of date."). With no equal-height/`align-items` rule beyond default grid stretch, this single long cell sets a taller row and leaves visible whitespace under its lighter neighbors, breaking the uniform-card look.
**Fix:** Trim the "Printable forms & flyers" copy to ~1–2 lines to match sibling density, or accept the taller row but verify with a screenshot that the grid still reads as balanced.

### [LOW] Guides don't cross-link to each other — no series/index navigation
**File:** `src/pages/guides/forms-that-email-you.astro:110-113`
**Dimension:** Content / IA
**Problem:** Each guide ends with a static text footer line and no links to the other two guides. The homepage presents them as a 3-card set under "Free guides," implying a small library, but once a reader finishes one there's no "More guides" / "Next" affordance and no `/guides` index page. Each guide is a silo.
**Fix:** Add a short "More free guides" block at the foot of each guide linking to the other two slugs (and/or back to `/#guides`). Optionally add a `/guides/index.astro` listing page so `/guides/` resolves rather than 404ing.

### [LOW] Demo-mode success copy makes a factual promise the build can't keep
**File:** `src/components/InquiryForm.astro:103` (and `:97`)
**Dimension:** Content
**Problem:** With `FORM_ENDPOINT` still the placeholder, `isRealEndpoint` is `false` and the submit handler skips the network call entirely (`:185-195`) — yet the success states assert "Your details have been logged and emailed to our team" / "We've got your details and we'll reach out shortly." If the site goes live before the endpoint is wired, real visitors are told their inquiry was emailed when nothing left the browser. (This is the content-dimension facet of FORM-02 — same root cause, copy-accuracy lens.)
**Fix:** Gate the success message on `isRealEndpoint`, or hard-block launch on a real endpoint. Pre-launch, either soften demo-mode copy ("This is a preview — submission isn't live yet") or ensure `FORM_ENDPOINT` is set before deploy so the claim is true. Confirm with the owner that the endpoint will be configured before the public (noindex-removed) launch.

### [LOW] 404 page is indexable and emits a self-referential canonical to /404/
**File:** `src/pages/404.astro:10` (renders via `BaseLayout.astro:66`)
**Dimension:** SEO
**Problem:** `404.astro` passes `path="/404/"`, so BaseLayout emits `<link rel="canonical" href="https://noprofits.org/404/">` with no robots `noindex` (the noindex toggle at `BaseLayout.astro:73` is commented out site-wide). A static 404 served at arbitrary missing URLs that returns a self-canonical and no noindex can let Google index the error page as a real URL (classic soft-404). `robots.txt Allow: /` does not prevent it.
**Fix:** On the 404 specifically, emit `<meta name="robots" content="noindex">` — add an optional `noindex`/`robots` prop to BaseLayout and set it on `404.astro`, or drop the canonical for the 404. The host should also return a real 404 status for unknown paths.

### [LOW] Only favicon.svg is declared — no PNG fallback, no apple-touch-icon, no theme-color
**File:** `src/layouts/BaseLayout.astro:62`
**Dimension:** SEO
**Problem:** Head declares only `<link rel="icon" href="/favicon.svg" type="image/svg+xml">`. There's no `apple-touch-icon` (iOS home-screen/share uses a blank/screenshot fallback), no PNG/ICO fallback for older crawlers and some Google SERP favicon fetchers that don't accept SVG, and no `<meta name="theme-color">`. `public/` contains only `favicon.svg` and `og-image.svg`.
**Fix:** Add `public/apple-touch-icon.png` (180×180) with `<link rel="apple-touch-icon">`, a `favicon.ico`/`favicon-32.png` fallback with a second `rel="icon" type="image/png"`, and `<meta name="theme-color" content="#16221D">` in the head.

### [LOW] Backdrop-filter blur on the sticky header repaints on every scroll
**File:** `src/components/Header.astro:43-45`
**Dimension:** Performance
**Problem:** The sticky header uses `backdrop-filter: blur(10px)` over a translucent background. A blurred backdrop on a `position:sticky` element forces the browser to re-sample and re-blur the content behind it on every scroll frame — a known scroll-jank/paint-cost source on lower-end mobile, the stated mobile-first audience. The visual payoff is small relative to the per-frame GPU cost.
**Fix:** Drop `backdrop-filter` in favor of a near-solid `background: rgba(247,244,238,0.97)` (cheaper, no per-frame blur), or guard it behind `@supports` and test scroll FPS on a mid-tier Android. Do not add `will-change` here (it would pin a layer permanently). Lowest-risk pre-launch move is the opaque solid background.

---

## Verified-and-dismissed (rigor appendix)

**14 candidate findings were raised and then refuted during independent verification** — most because the cited facts were accurate but the conclusion misread the architecture's intent or had no real user impact on a static pre-launch marketing site. Notable examples:

- **"Mobile nav toggle doesn't move focus into the panel / no focus trap" (proposed medium).** Dismissed: the toggle is a textbook ARIA **disclosure** widget (`Header.astro:18-34`), and the ARIA Authoring Practices disclosure pattern explicitly does **not** move focus into the revealed content on expand — focus stays on the trigger and the user Tabs in (which works, since nav follows the toggle in DOM order). Escape already closes and returns focus. The headline recommendation was anti-pattern advice; only a low-severity keyboard edge case survived.
- **"Hero two-column split only engages at 1200px, contradicting the spec" (proposed responsive defect).** Dismissed: the finding cherry-picked the Medium row's generic "full multi-column layouts" and ignored the specific Large row directly beneath it — "Large/Desktop ≥1200px … full hero split" (`Mobile-First Design Spec.dc.html:73`), which is exactly what `index.astro:352` implements. Spec and build **agree**; the proposed fix would have made the build diverge from the spec.
- **"No submit error region / no disabled button during in-flight POST" (proposed medium/forms).** Dismissed as standalone defects: the handler shows success **synchronously** and hides the form in the same tick, so today's double-submit window is effectively zero and there's no async failure path to announce. These are legitimate **dependency notes** attached to the FORM-01 fix (if the success swap moves into `.then()`), not present-code defects.
- **"Print-trigger inline script duplicated across guides creates three JS chunks" (proposed perf).** Dismissed: inspecting `dist/` shows **zero `.js` files** — Astro inlines the sub-4KB handler directly into each guide's HTML, so there's no extra request and no cacheability loss. The proposed "extract to a shared module" fix would have **added** a blocking network round-trip that doesn't currently exist.

Others dismissed: honeypot-field AT edge case (no user can focus it), decorative ✓/— marker contrast (meaning is redundantly encoded by adjacent text + headings), form input background `#FBFAF6` vs `#FCFBF8` (sub-perceptual, and the build uses the actual palette token), cost-card `#bf8a6a` dash being "off-palette" (pixel-faithful to the comp, decorative, not on the accent theming path), `Organization` vs `LocalBusiness` schema (valid markup; proposed fixes need data that doesn't exist), homepage title-suffix/description "inconsistency" (the standard, correct convention), the 404 "has no path to guides" claim (the 404 **already** imports and renders `<Footer />` with the full Explore nav including Free guides + contact email), and the "no responsive image pipeline" note (the site ships zero raster images, so there's nothing to optimize yet).

---

## Launch readiness verdict

**GO-WITH-FIXES.** No blockers, but the six High findings sit squarely on the two functions this site exists for — capturing leads and being shared/found. Ship only after the form is wired to a real endpoint (with a build guard against the placeholder), the success/failure path can no longer report a lost lead as success, the OG image is a real raster, fonts are self-hosted, and the guide pages regain nav + a CTA.