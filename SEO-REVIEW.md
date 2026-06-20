# Pre-Launch SEO Re-Review — noprofits.org (Pass 3)

**Site:** noprofits.org — free websites for Seattle non-profits
**Stack:** Static Astro 5 · Firebase Hosting · forms POST to a Google Apps Script web app
**Scope:** Full SEO surface — head/meta, structured data (JSON-LD), crawl/index (robots, sitemap, headers), content semantics (headings, alt, landmarks), social/OG assets, and the form's lead-integrity + no-JS path. Adversarial re-review (pass 3) of the round-2 fixes committed as `4acbb80`.
**Date:** _<launch-prep date>_
**Reviewed at commit:** `4acbb80` (working tree committed and clean)

---

## 1. Executive Summary

**Verdict: GO — launch-ready. No blocking SEO items remain.**

This is the third pass. Round 1 surfaced a blocker plus a High and several Lows; round 2 cleared the blocker, fonts, and the 404. Going into this pass, the open items were the High-severity OG raster (A) and its JSON-LD tail (B), a Medium lead-integrity issue (C), one Low (D), and a batch of Nits (E, F) plus several self-claimed hardening fixes.

**Every one of those items verifies fixed against the current files**, confirmed by reading the source and the built `dist/`, and by inspecting the actual binary assets (not just the code that references them). I specifically checked the two failure modes that would have been easy to fake:

- **`public/og-image.png` is a genuine raster** — `file` reports `PNG image data, 1200 x 630, 8-bit/color RGB`, `sips` confirms `pixelWidth 1200 / pixelHeight 630`, 88 KB. It is **not** a renamed SVG, and its dimensions match the `og:image:width/height` meta and the JSON-LD `image`.
- **No silent lead drop** — the Apps Script `appendRow` is now unconditional; throttle/daily-cap only suppress the notification email, and the honeypot returns success.

The round-2 changes were also checked for **regressions** (new guide-cover SVGs, CSP regeneration, fonts cache header, deleted `data-endpoint` attrs, hero LCP keyframe, `<noscript>` fallback, typed `areaServed`). **None found.** The site is internally consistent and ready to ship.

**Round-2 items verified fixed: all of them.** Confirmed-fixed open items A–F (plus the extra hardening claims); one explicit non-gap (native form `action`/`method`, correctly omitted for a no-cors opaque endpoint).

---

## 2. Round-2 Fixes — Verification

| # | Item | Status | Proving file:line / evidence |
|---|------|--------|------------------------------|
| **A** | Rasterize `og-image.svg` → `og-image.png` (1200×630); `OG_IMAGE_PATH='/og-image.png'`; add `og:image:type`; width/height match | ✅ verified | `file public/og-image.png` → `PNG image data, 1200 x 630, 8-bit/color RGB` (genuine raster, 88 KB, **not** a renamed SVG); `sips` → 1200×630. `site.ts:27` `OG_IMAGE_PATH='/og-image.png'`. `BaseLayout.astro:93` `og:image`, `:94` `og:image:type=image/png` (matches real file), `:95-96` width 1200 / height 630 (match real pixels). `og`/`twitter` image both = `new URL(OG_IMAGE_PATH, SITE_URL)` → `https://noprofits.org/og-image.png`. |
| **B** | Add `image` to all three guide Article JSON-LD (absolute, resolving URL) | ✅ verified | `forms-that-email-you.astro:22`, `seo-basics-for-nonprofits.astro:22`, `launch-free-on-google-workspace.astro:22` each `image: new URL('/og-image.png', SITE_URL).href` → `https://noprofits.org/og-image.png` (the verified real PNG). |
| **C** | Lead can't be silently dropped: throttle/over-cap still `appendRow`, only suppress email; honeypot `company`→`np_hp` shows success; `Sending…` + recovery copy | ✅ verified | `Code.js:87-95` `appendRow` is unconditional; `:104` `if (!throttled && sentToday < DAILY_EMAIL_CAP)` gates the **email only**; invariant documented `:26-28`. Honeypot `:52` `if (p.np_hp) return …('ok')` (success, not "ignored"). Client `InquiryForm.astro:247-248` reads `input[name="np_hp"]`, on a trip `showSuccess(); return;` (no dead form). `:262-268` `Sending…` + `disabled`/`aria-busy`; `:269-274` restore on failure. Recovery copy `:100`,`:106`,`:286`. |
| **D** | `robots.txt` de-index comment rewritten as EITHER/OR (no Disallow+noindex combo) | ✅ verified | `public/robots.txt` header: "PRE-LAUNCH de-index — pick ONE, never both" enumerating (A) `Disallow: /` vs (B) `noindex` meta, "Do NOT combine them." Live directives: `User-agent: *` / `Allow: /` / `Sitemap: …/sitemap-index.xml`. No `Disallow`, no conflict. |
| **E** | `<noscript>` contact fallback; native `action`/`method` on form | ✅ verified (noscript) / ➖ N/A (action/method) | `InquiryForm.astro:89-91` real `<noscript>` with `tel:+12065326395` + `mailto:hello@noprofits.org`, present verbatim in `dist/index.html` (count = 2, hero+contact). Phone/email match `site.ts:15-16`. Native `action`/`method` correctly omitted — the endpoint is a no-cors Apps Script `/exec` returning an opaque response; a native non-JS POST couldn't render a usable confirmation. The `<noscript>` phone/email is the substantive no-JS path. |
| **F** | Pillars `<h2>`; replace guide-cover placeholders with wired SVG covers; typed `areaServed`; prefetch | ✅ verified (h2 / covers / areaServed) · ⚠️ prefetch not added (optional Nit) | Pillars: `index.astro:89` `<h2 class="np-visually-hidden">Why non-profits choose us</h2>`. Covers: `index.astro:223/232/241` wired to `/guides/cover-{launch,seo,webforms}.svg`, `alt="" loading="lazy" width=1200 height=675`; all three present in `public/guides/` **and** `dist/guides/`; `viewBox 0 0 1200 675` matches img dims (no distortion under `object-fit:cover`, CSS `aspect-ratio:16/9` `index.astro:542`). `areaServed`: `index.astro:27` + `BaseLayout.astro:51` `AdministrativeArea`. **Prefetch:** not added — an explicitly optional Nit in item F, **not** a launch blocker. |
| extra | Deleted dead `data-endpoint`/`data-real-endpoint` (no `/exec` leak into static HTML) | ✅ verified | `grep data-endpoint\|data-real-endpoint src/ dist/` → none. The endpoint ships only as the bundled `FORM_ENDPOINT` constant inside the inline module script (`dist/index.html` carries the build placeholder `[CONFIRM: Apps Script /exec URL]` in preview, confirming no hardcoded leak); the browser must hold it to POST — documented as non-secret in `site.ts:30-50`. |
| extra | Hero LCP paints opaque (transform-only keyframe) | ✅ verified | `global.css:132-135` `@keyframes npRiseUp { from { transform: translateY(14px) } }` — transform only, **no opacity**. `index.astro:293` `.np-hero__copy` (LCP H1) uses `npRiseUp`; `:294` below-fold `.np-hero__card` uses `npFadeUp` (opacity). LCP element is never opacity-faded. |
| extra | Second body-font preload (right file, crossorigin) | ✅ verified | `BaseLayout.astro:118-124` preloads `/fonts/hanken-grotesk.woff2` `as=font type=font/woff2 crossorigin`, alongside the heading font `:111-117`. Both render above the fold — neither preload wasted. |
| extra | Honest `/fonts` cache header (no year-long immutable on stable names) | ✅ verified | `firebase.json:24` `/fonts/**` → `public, max-age=604800, stale-while-revalidate=2592000` (1 wk + SWR). `_astro/**` `:15` retains `max-age=31536000, immutable` for hashed names. Correct split; fonts still preloaded → no first-paint penalty, no crawler block. |
| extra | CSP `gen-csp` balanced-script assertion (doesn't block JSON-LD or form script) | ✅ verified | `gen-csp.mjs:39-47` throws on unbalanced `<script>`/`</script>` counts; `:52` skips `application/ld+json` (data, not gated by `script-src`); `:51` skips `src=` externals; hashes only executable inline bodies. JSON-LD emits via `set:html` with `</script>`-safe `<`→`\u003c` escaping (`BaseLayout.astro:104,106`). `npm run build` runs `gen-csp` after `astro build`, so deploy regenerates the hash against the real-endpoint bundle — no stale-CSP-blocks-form risk. |

---

## 3. Remaining & New Findings

🔁 = regression introduced by round 2.

### Blocker
None.

### High
None.

### Medium
None.

### Low
None.

### Nits
None blocking. (Noted, not findings: the optional **`prefetch`** from item F was not wired — purely a nice-to-have perceived-speed tweak with no SEO/crawl/index impact and no commit claim that it was done.)

**No regressions detected.** The four highest-risk round-2 changes were checked directly:
- **Guide-cover SVGs** — decorative `alt=""` is correct: `grep` confirms 0 `<text>`, 0 `<title>`, 0 `role=` in all three; the adjacent `<h3>` names each guide. `viewBox` matches img dimensions; files resolve in both `public/` and `dist/`. No heading/landmark disruption.
- **CSP regeneration** — does not block inline JSON-LD (skipped by content-type) or the form's inline module script (hashed correctly, regenerated at deploy).
- **`/fonts` header** — softer caching does not hurt crawl/perf signals; fonts are preloaded and the header is non-blocking.
- **Deleted `data-endpoint` attrs** — form endpoint wiring intact via the bundled `FORM_ENDPOINT`; no `/exec` URL leaks into static markup.

---

## 4. Cleared / Not an Issue

- **Native `action`/`method` on `<form>`** — correctly omitted, not a gap. The endpoint is a no-cors Apps Script `/exec` returning an opaque response; a native non-JS POST could not render a usable confirmation. The crawlable `<noscript>` phone/email (`InquiryForm.astro:89-91`) is the substantive no-JS path. Commit `4acbb80` only claims the `<noscript>` fallback.
- **`/exec` appearing in `dist/index.html`** — not a leak. It is the bundled `FORM_ENDPOINT` constant inside the inline module script (the browser must hold it to POST); documented non-secret in `site.ts:30-50`. The preview build even shows the `[CONFIRM: …]` placeholder, proving nothing is hardcoded.
- **Apps Script "ignored" early-return (`Code.js:75-77`)** — not a silent drop. It only rejects a submission with **no name** or **no email/phone** (an unusable, unreplyable lead) — by definition not a real lead worth persisting. Every usable lead reaches the unconditional `appendRow`.
- **`areaServed` typed value** — valid schema.org. `AdministrativeArea` (`BaseLayout.astro:51`, `index.astro:27`) is a valid `Place` subtype; `contactPoint.areaServed: 'US-WA'` (`BaseLayout.astro:57`) is a valid text region. Both shapes accepted.
- **404 noindex** — `404.astro:9` is the only page passing `noindex`; `BaseLayout.astro:85` emits it solely on that page; the site-wide pre-launch `noindex` toggle (`:84`) remains commented out for a live, indexable site.
- **Sitemap / robots pointer** — `dist/sitemap-0.xml` lists exactly the 5 real pages (/, three guides, /privacy/), no cover SVGs, no 404; `sitemap-index.xml` matches the `robots.txt` `Sitemap:` line.
- **`orgLd` logo** — `BaseLayout.astro:43-48` `ImageObject` 512×512; `public/logo.png` is a genuine 512×512 PNG, matching declared dims and Google's square ≥112 px logo expectation.

---

## 5. Final Pre-Launch Checklist

**Launch-ready — no blocking SEO items remain.**

Operational reminders (deploy-time, not code gaps):
- [ ] Confirm the real `PUBLIC_FORM_ENDPOINT` GitHub Actions Variable is set so the production build bakes the live `/exec` URL (and `gen-csp` regenerates the matching form-script hash) — verified mechanism, just needs the value present at deploy.
- [ ] (Optional, post-launch) Wire `prefetch` for guide links and stand up the planned CAPTCHA fast-follow (`verifyCaptcha_` stub in `Code.js`) — neither blocks launch.