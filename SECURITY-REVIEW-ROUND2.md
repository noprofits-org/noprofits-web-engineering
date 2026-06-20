# Pre-Launch Security Review — Round 2 (Verification)

**Date: 2026-06-20**

*Produced by an adversarial multi-agent re-review. This is a delta on `SECURITY-REVIEW.md` (Round 1): it records what the implementation team's punch list actually fixed (verified against current source, not "touched"), and any new issues or regressions the changes introduced.*

---

## Executive Summary

**Verdict: launch-ready.** Every Round-1 launch-blocker has been genuinely fixed and verified in the current source, with no regressions introduced and no new Critical/High/Medium findings. The four Round-1 Mediums — Apps Script abuse controls (rate limit + daily email cap), CSV/formula injection, the honeypot-only bot defense, and the privacy-policy gap — are all closed in code, not merely stubbed. CAPTCHA remains correctly deferred-by-design. The site can go live with the form endpoint enabled.

What remains is a tail of **Low/Info** items: four Round-1 CI/CD supply-chain hardenings that were not taken (SHA-pinning Actions, pinning `firebase-tools`, ref-pinning the WIF trust, deploy concurrency), a handful of new latent-but-bounded observations on the Apps Script counters and the CSP regeneration coupling, and minor disclosure/hygiene nits. **None are launch-blocking.** Several fixes are notably well executed and are called out below.

### Remediation scoreboard

| Original finding | Round-1 severity | Status |
|---|---|---|
| Apps Script endpoint — no rate limiting / quota self-DoS | Medium | **Fixed** |
| Sheet CSV / formula injection | Medium | **Fixed** |
| Honeypot is the sole bot defense | Medium | **Fixed** |
| No privacy policy / consent / retention statement | Medium | **Fixed** |
| Email header / content shaping via `replyTo` and subject | Low | **Fixed** |
| No server-side email-format validation | Low | **Fixed** |
| No per-field length caps | Low | **Fixed** |
| Missing HTTP security headers (CSP, nosniff, Referrer-Policy, frame-ancestors, Permissions-Policy, HSTS) | Low | **Fixed** |
| CSP correctness / inline-script hashing | Low | **Fixed** |
| Third-party Google Fonts (no SRI / self-hosting) | Low | **Fixed** |
| `Cache-Control: immutable` on non-content-hashed assets | Low | **Fixed** |
| `FORM_ENDPOINT` build-time injection (prevent dead/placeholder form) | Low | **Fixed** |
| `.clasprc.json` (clasp OAuth refresh token) not gitignored | Low | **Fixed** |
| no-cors silent-failure UX (false success on failure) | Info | **Fixed** |
| JSON-LD `set:html` escaping (harden sink by construction) | Info | **Fixed** |
| No secrets committed (verify clean) | Info | **Fixed** (verified clean) |
| GitHub Actions pinned to mutable tags, not commit SHAs | Low | **Not fixed** |
| Global `firebase-tools` installed unpinned at deploy time | Low | **Not fixed** |
| WIF / workflow trigger not pinned to the protected branch ref | Low | **Not fixed** |
| No concurrency control on the deploy workflow | Info | **Not fixed** |
| `.gitignore` coverage of `.env*` / dist | Low | **Partial** |
| Hardcoded `NOTIFY_TO` personal mailbox (`peter@`) | Info | **Not fixed** |
| `.clasp.json` scriptId committed / not gitignored (optional) | Info | **Not fixed** |
| CAPTCHA | Medium (deferred) | **Deferred-by-design** |
| Client-only validation / honeypot (defense-in-depth note) | Info | **Deferred-by-design** |
| scriptId & project-id exposure (accepted non-secret) | Info | **Deferred-by-design** |
| External-link `rel=noopener` | Low | **N/A** (no external links remain) |

---

## Remediation Detail

The Apps Script endpoint is now properly layered, and the implementation made a deliberately correct choice on **where to drop vs. degrade**:

- **Daily-email-cap fallback (well done).** `appendRow` (`Code.js:84-92`) runs *unconditionally* before the daily-cap check (`Code.js:94-115`); the cap (`DAILY_EMAIL_CAP=60`) only suppresses the notification email, and the day counter increments only when mail is actually sent (`Code.js:114`). This is exactly the Round-1 fix the self-DoS finding required: a mail flood can no longer exhaust MailApp quota *and* silently drop real leads' sheet rows.
- **Formula neutralization with correct ordering (well done).** `neutralize_()` (`Code.js:131-134`) apostrophe-prefixes any value matching `/^[=+\-@\t\r]/` and is applied to all six stored fields. `clamp_()` runs first and only truncates — it never prepends a dangerous char — so `neutralize_` still sees the true leading character. Ordering is correct.
- **Honeypot is now one layer of several** — per-minute rate limit, length caps, server-side email validation, and neutralization all run server-side; the "single bypassable layer" gap is closed.
- **Email shaping fixed.** `replyTo` is `validEmail||NOTIFY_TO` (`Code.js:102`), never the raw value; subject interpolates `oneLine_(...)` (`Code.js:103,137-139`) which strips CR/LF/control chars.
- **CAPTCHA deferral (well done).** `verifyCaptcha_()` is a clearly documented commented stub with the exact wiring contract (`Code.js:141-156`); per Round-1 doctrine its absence is not flagged.

On the static side:

- **Build guard (well done, fail-closed).** `astro.config.mjs:13-29` throws at `astro:build:start` unless the endpoint starts with `https://script.google.com` (or `ALLOW_PLACEHOLDER_ENDPOINT=true`). The escape hatch is confirmed *not* set in CI (`deploy.yml`), so an unset/placeholder `PUBLIC_FORM_ENDPOINT` fails the build and nothing deploys. The URL is correctly treated as a non-secret repo Variable per `HANDOFF-form-endpoint.md`.
- **CSP hashing (well done).** `scripts/gen-csp.mjs` is chained into `npm run build` (`package.json:9`), hashes every executable inline `<script>` in `dist/`, correctly excludes `application/ld+json` data and external `src=` scripts, and rewrites `firebase.json`. The three committed sha256 hashes match the current build; a production build regenerates exactly the one form-script hash that changes when the endpoint is inlined. Full header set (HSTS preload, nosniff, Referrer-Policy, X-Frame-Options DENY, Permissions-Policy, CSP with `object-src/base-uri/frame-ancestors 'none'`) is present and well-formed; `connect-src`/`form-action` correctly include both `script.google.com` and the `script.googleusercontent.com` redirect target.
- **Self-hosted fonts (well done).** `@font-face` now points at `/fonts/*.woff2` (`global.css:5-19`); the files are committed; `BaseLayout.astro:108-116` preloads them with `crossorigin`; CSP `font-src 'self'`; and a grep over built `dist/` for `googleapis`/`gstatic` returns none. The third-party origin is fully removed.
- **no-cors UX fixed.** `InquiryForm.astro:238-249` now gates success on the fetch settling and re-shows the form with a retry/contact notice on failure.
- **Privacy policy.** New `src/pages/privacy.astro` covers collected data, purpose, storage location, a 24-month retention window with deletion-on-request, access/correction/deletion path, and contact; linked from the footer and from a consent line beneath **both** forms.
- **Manual-outreach design (well done, unchanged).** `Outreach.js` remains the recommended human-in-the-loop acknowledgement path — no open-relay/reflection vector, no per-POST quota amplification, every send previewed and confirmed.
- **Repo hygiene.** `.clasprc.json` and `**/.clasprc.json` are now gitignored (verified `git check-ignore` IGNORED); no secrets are committed across all three commits.

---

## New / Remaining Findings

No Critical, High, or Medium findings. All confirmed items are Low or Info.

### Low

#### [Low] GitHub Actions pinned to mutable tags, not commit SHAs *(unresolved Round-1 item)*
**File:** `.github/workflows/deploy.yml:35,37,50`
**Description.** `actions/checkout@v4`, `actions/setup-node@v4`, and the high-privilege `google-github-actions/auth@v2` (runs with `id-token: write`) are all still mutable major-version tags, none pinned to a 40-char SHA. No Dependabot config for `github-actions` is present.
**Impact.** If a first-party action's tag were repointed by an upstream compromise, malicious code could run in the WIF-credentialed job. Blast radius is bounded: keyless WIF, repo-scoped, deploy SA scoped to `roles/firebasehosting.admin` on one project — worst case is redeploy/deface of a static marketing site, not project/org takeover.
**Recommendation.** Pin every `uses:` to a full commit SHA with a version comment; enable Dependabot for `github-actions`; prioritize the `auth` action.

#### [Low] Global `firebase-tools` installed unpinned at deploy time *(unresolved Round-1 item)*
**File:** `.github/workflows/deploy.yml:56`
**Description.** `npm install -g firebase-tools` with no version pin and no lockfile coverage, run *after* the auth step has exported ADC (`export_environment_variables: true`). Not added as a `devDependency`.
**Impact.** A compromised `firebase-tools` release would run with the federated GCP credential in scope. Bounded by the same single-project `firebasehosting.admin` SA and short-lived token.
**Recommendation.** Pin an exact version, or add `firebase-tools` as a lockfile-covered `devDependency` invoked via `npx`; install tooling before the credential-exporting auth step.

#### [Low] WIF / workflow trigger not pinned to the protected branch ref *(unresolved Round-1 item)*
**File:** `.github/workflows/deploy.yml:20-27` (trigger + permissions); provider-binding note (~line 14)
**Description.** Triggers on `push:[main]` **and** `workflow_dispatch` with no ref/actor gate; the documented provider binding is by `attribute.repository` only — no `assertion.ref == 'refs/heads/main'` or `repository_owner` condition — and there is no GitHub Environment with required reviewers. Anyone with repo write can `workflow_dispatch` from any branch and receive `id-token: write`.
**Impact.** A trusted-but-write-capable actor can deploy unreviewed code from an arbitrary branch, bypassing the gated-merge control. Not anonymously exploitable (forked-PR runs do not get the OIDC identity); blast radius bounded to the scoped deploy SA on a static site — no PII/Sheet access.
**Recommendation.** Pin the WIF provider to `assertion.ref == 'refs/heads/main'` + `repository_owner`, and/or add a branch-restricted GitHub Environment with required reviewers; restrict who can run `workflow_dispatch`.

#### [Low] CSP hashes match only the placeholder build — an out-of-band `firebase deploy` (without `npm run build`) would ship a CSP that blocks the production form script
**File:** `firebase.json:71`, `scripts/gen-csp.mjs`, `package.json:9`
**Description.** The endpoint URL is inlined into one of the three inline scripts, so that script's sha256 differs between the placeholder build (committed hash) and a production build. Staleness is prevented only by `gen-csp.mjs` running, which is chained solely inside `npm run build`. The CI path is safe (`deploy.yml` runs `npm run build`), but a bare `astro build` then deploy, or deploying the committed `dist/` + `firebase.json` directly, would ship a CSP whose hash does not cover the live form script.
**Impact.** Availability/operational, not a security exposure — the CSP would silently block the inline form-handler (`script-src` has no `unsafe-inline` fallback), so the form renders but never POSTs, with no visible console error to ordinary visitors and nothing in the Leads sheet to signal it. This is the "dead form" failure mode the build guard was designed to prevent, reintroduced one layer down.
**Recommendation.** Keep `firebase deploy` coupled to a fresh `npm run build` (add a guard/comment so no deploy-only path is added); consider committing a sentinel hash so a forgotten regenerate fails loudly rather than shipping a plausible-but-wrong hash; add a post-deploy smoke check that the form actually POSTs.

#### [Low] `gen-csp.mjs` uses a regex HTML parser that silently drops any inline script containing `</script>` or attribute-embedded `>`
**File:** `scripts/gen-csp.mjs:31-44`
**Description.** The non-greedy body match stops at the first literal `</script>` substring, and the attrs capture `[^>]*` terminates at the first `>`. Neither triggers on today's two simple module scripts (verified), but a future inline script containing `</script>` in its body (e.g. a template literal building markup — a shape already present in `InquiryForm.astro`) would be hashed over a truncated body and ship with no matching CSP hash. There is no count assertion to catch a dropped script.
**Impact.** Latent (not live): a future content edit could yield a CSP-blocked script — the same silent form/JS breakage as above — triggered by ordinary code changes rather than a deploy mistake. Failure direction is the site's own code being blocked, never a CSP bypass.
**Recommendation.** Parse with a real HTML parser (or hash from a build manifest); at minimum, warn against `</script>` in inline bodies and assert that the hashed-script count equals the expected count so a dropped/zero result fails the build.

#### [Low] Per-minute rate-limit and daily-cap counters are non-atomic read-modify-write (TOCTOU under concurrent floods)
**File:** `apps-scripts/leads_sheet/Code.js:55-59, 98-114`
**Description.** Both counters use get-then-put without `LockService`. `CacheService.get(minuteKey)`+`put` and `PropertiesService.getProperty(dayKey)`+`setProperty` are not atomic, and Apps Script `doPost` requests can execute concurrently. A burst of simultaneous POSTs can all read the same stale value and pass the threshold before any increment lands. The code comments explicitly document the "best-effort / not strictly atomic" intent.
**Impact.** A *parallel* (vs. serial) flood can overshoot `RATE_LIMIT_PER_MIN` and push notification emails somewhat past `DAILY_EMAIL_CAP`. Bounded to overshoot, not bypass — every passing request still increments, leads still save, and the cap still prevents unbounded mail.
**Recommendation.** If tighter bounds are wanted, wrap each read-modify-write in `LockService.getScriptLock()` with a short `tryLock` timeout. Acceptable to leave as-is for a low-volume nonprofit form given the documented best-effort intent.

#### [Low] Throttled submissions are dropped entirely (no sheet write) — a flood can starve real leads in the same minute window
**File:** `apps-scripts/leads_sheet/Code.js:56-58`
**Description.** When the per-minute rate limit trips, `doPost` returns `'error'` *before* `appendRow` (`Code.js:84`), so the lead is neither saved nor emailed — unlike the daily-cap path, which deliberately keeps saving and only suppresses email. The throttle returns HTTP 200 with body `'error'`; because the client uses `mode:'no-cors'`, that resolves the fetch, so the genuine user is shown success while their lead is lost.
**Impact.** During an active flood that keeps the *global* per-minute counter pegged at 12, legitimate submissions in those minutes are silently dropped with a false success shown and no operator signal. Bounded to the duration of a deliberate attack on a low-volume form; design-consistency gap rather than a violated commitment (the "never silently drop a real lead" goal was framed around the daily email cap).
**Recommendation.** On throttle, still `appendRow` the lead and skip only the email (mirroring the daily-cap behavior), or raise `RATE_LIMIT_PER_MIN`; at minimum document that the per-minute path drops rather than degrades.

#### [Low] Privacy policy omits Google as a data processor / sub-processor
**File:** `src/pages/privacy.astro:53-58`
**Description.** The "Where it's stored and who can see it" section says submissions go to "a private Google Sheet inside our own Google Workspace" and "We don't share your information with anyone else except where the law requires it." In reality the PII is processed by Google at three points — Sheets storage, the Apps Script web app, and Gmail/MailApp (`Code.js:100-113`). The page does name "Google Workspace," so this is a transparency nuance, not a false statement; "we don't share" is technically true as to onward disclosure by noprofits.org.
**Impact.** Minor transparency/best-practice gap; below CCPA enumeration thresholds for this low-volume form, and no PII is exposed by the omission. A vendor selling professional web work benefits from naming the processor.
**Recommendation.** Add one clause, e.g.: "We use Google Workspace (Google Sheets, Apps Script, and Gmail) to receive and store these messages; Google processes the data on our behalf under its own terms." Optional, not launch-blocking.

#### [Low] `.gitignore` lists only literal `.env` / `.env.production`, not a `.env*` glob *(Round-1 item, partial)*
**File:** `.gitignore:11-13`
**Description.** Only `.env` and `.env.production` are ignored. Astro/Vite also load `.env.local`, `.env.development`, and `.env.development.local` by convention; none are ignored, and `HANDOFF-form-endpoint.md:58-59` incorrectly states the gitignore "already covers `.env*`." No such file exists today, so this is preventive, not a live leak. `SECURITY-REVIEW.md` also repeatedly described the coverage as `.env*`.
**Impact.** Latent: a contributor creating `.env.local` (the idiomatic local-dev choice) would not have it ignored, so an unrelated secret placed there could be committed. The documented var (`PUBLIC_FORM_ENDPOINT`) is non-secret, so the realistic content is harmless — but the misleading doc raises the chance of a future mistake.
**Recommendation.** Change to a glob (`.env*`, or add `.env.local` and `.env.*.local` explicitly), and correct `HANDOFF-form-endpoint.md` to match.

### Info

#### [Info] Fixed-window rate limit allows a ~2× burst at the minute boundary
**File:** `apps-scripts/leads_sheet/Code.js:54-59`
**Description.** `minuteKey = 'rl_' + floor(Date.now()/60000)` is a fixed (not sliding) window, so an attacker can send a full `RATE_LIMIT_PER_MIN` just before a rollover and another full window just after — up to ~2× nominal across a short span at each minute boundary. Standard fixed-window limitation.
**Impact.** Marginally higher burst throughput than 12/min implies; negligible for this form, and the daily email cap is the hard backstop on mail.
**Recommendation.** No action needed. A two-bucket sliding window or `LockService` would be over-engineering here.

#### [Info] Daily-email-cap key uses UTC date while the project timezone is `America/Los_Angeles`
**File:** `apps-scripts/leads_sheet/Code.js:97`
**Description.** `dayKey = 'mail_' + new Date().toISOString().slice(0,10)` keys on the UTC calendar date, but `appsscript.json` sets `timeZone: America/Los_Angeles`. The notification-email "day" therefore rolls over at 16:00/17:00 Pacific, not local midnight.
**Impact.** None security-wise — the cap still functions. The window simply doesn't align with the operator's local day, which could confuse cap accounting if ever hit.
**Recommendation.** If alignment matters, key on `Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd')`. Optional.

#### [Info] `Outreach.js` interpolates sheet-sourced `name`/`org` into the acknowledgement body without `oneLine_` stripping
**File:** `apps-scripts/leads_sheet/Outreach.js:40-58, 86-88`
**Description.** `name`/`org` (originally attacker-supplied via the public form, then read back from the row) are interpolated into the canned greeting/body with no CR/LF/control-char stripping, unlike `Code.js`'s `oneLine_`. The send is to a typed, `EMAIL_RE`-validated recipient (the row's own email), the body is plain text, and the operator previews and confirms every send.
**Impact.** Negligible — no header injection, no HTML sink; at most a cosmetically malformed greeting in a previewed email sent to the lead's own captured address.
**Recommendation.** Optional: run `name`/`org` through a `oneLine_`-style strip for consistency with `Code.js`. Not security-required.

#### [Info] Outreach double-send guard is advisory by design; the STATUS column is unprotected
**File:** `apps-scripts/leads_sheet/Outreach.js:96-101, 118-120`
**Description.** The "Ack sent" column-H marker prevents accidental resends via a YES/NO confirm, but the operator can answer YES to resend and any sheet editor can clear the column. The menu is owner-only (`onOpen` simple trigger), has no public/programmatic path, and every send is preview+confirm gated.
**Impact.** None beyond an authorized operator deliberately re-sending to a validated address. No external abuse path.
**Recommendation.** No action required — the manual human-in-the-loop design is the right tradeoff. If once-only is ever needed, gate strictly on the STATUS cell without the override prompt.

#### [Info] Build guard reads `process.env` while the build consumes `import.meta.env` (env-source skew)
**File:** `astro.config.mjs:17`, `src/data/site.ts:46`
**Description.** The guard checks `process.env.PUBLIC_FORM_ENDPOINT`; the consumed value comes from `import.meta.env.PUBLIC_FORM_ENDPOINT`, which Astro/Vite also populate from dotenv files. In CI both agree (`deploy.yml:47` sets the OS env var). The skew only bites a local production build that sets the endpoint via a `.env` file but not the shell env, where the guard could throw even though `site.ts` would have seen a real endpoint. Because `import.meta.env` is a superset of `process.env`, the guard can never pass-while-shipping-a-placeholder.
**Impact.** None for CI/production; possible developer confusion on local prod builds. Not exploitable.
**Recommendation.** Use `loadEnv()` in the config so the guard sees dotenv values too, or document that production builds must set the endpoint in the OS env (as CI does).

#### [Info] CSP self-heals on production build (positive design note)
**File:** `scripts/gen-csp.mjs`, `.github/workflows/deploy.yml:43`, `package.json:9`
**Description.** The endpoint is baked verbatim into the inline form script, so its sha256 changes between placeholder and production builds — which would break a hardcoded CSP. This is handled correctly: `npm run build` chains `astro build && node scripts/gen-csp.mjs`, which recomputes hashes from `dist/` and rewrites `firebase.json` before `firebase deploy`. The generator correctly excludes JSON-LD and external `src=` scripts and unions hashes across pages.
**Impact.** None — the CSP cannot go stale between the bundled endpoint and the deployed hashes on the CI path. (The off-path manual-deploy caveat is captured as the Low finding above.)
**Recommendation.** No change; just avoid hand-running `astro build` before a manual deploy.

#### [Info] `dist/` build artifact present in working tree (untracked, preview build)
**File:** `dist/index.html`
**Description.** A locally built `dist/` exists, built in preview mode (carries the placeholder `data-endpoint="[CONFIRM: Apps Script /exec URL]"`, `data-real-endpoint="false"`). It is correctly gitignored and untracked; `firebase.json` also ignores `**/.*` and `node_modules` on deploy; no real `/exec` URL or secret is present.
**Impact.** None currently. Risk would arise only if someone manually deployed this stale preview `dist/` (form would be inert) — a functionality, not security, concern. CI rebuilds with the real endpoint.
**Recommendation.** No action; optionally `rm` it to avoid confusion.

#### [Info] `.clasp.json` scriptId committed / not gitignored *(unresolved optional Round-1 item)*
**File:** `apps-scripts/leads_sheet/.clasp.json:2`, `.gitignore`
**Description.** `git check-ignore` returns NOT ignored; `.clasp.json` is still tracked. The high-value sibling (`.clasprc.json` OAuth refresh token) *was* correctly gitignored — only the cosmetic identifier remains.
**Impact.** None — `scriptId` is a project identifier, not a credential; the bound Sheet ID is not exposed (`getActiveSpreadsheet()`). Round 1 flagged this as optional/deferrable.
**Recommendation.** Optional: add `.clasp.json` to `.gitignore` and `git rm --cached` it, or document the conscious deferral.

#### [Info] Hardcoded `NOTIFY_TO` personal mailbox (`peter@noprofits.org`) *(unresolved optional Round-1 item)*
**File:** `apps-scripts/leads_sheet/Code.js:8, 32`
**Description.** `NOTIFY_TO = 'peter@noprofits.org'` and the deploy comment are still committed; the optional move to a Script Property + role alias (`leads@`) was not taken. `Outreach.js:23` correctly uses the role alias `hello@noprofits.org` for the customer-facing reply-to.
**Impact.** Minimal — an internal routing address, not a credential; the org already publishes `hello@` and a phone number by design. Never launch-blocking.
**Recommendation.** Optional: move the recipient to a Script Property and prefer a `leads@` role alias.

#### [Info] No concurrency control on the deploy workflow *(unresolved Round-1 item)*
**File:** `.github/workflows/deploy.yml`
**Description.** No `concurrency:` key; overlapping deploys remain possible.
**Impact.** Release-integrity/consistency only, and self-healing — Firebase releases are atomic; the next push corrects any interleave. No security impact.
**Recommendation.** Add `concurrency: { group: deploy-hosting, cancel-in-progress: true }`.

---

## Updated Pre-Launch Checklist

Only still-open items, ordered by severity. (All Round-1 launch-blockers are fixed; none of the below block launch.)

**Low — complete before or shortly after launch:**

- [ ] Pin GitHub Actions to full commit SHAs (with version comments) and enable Dependabot for `github-actions` — prioritize `google-github-actions/auth`.
- [ ] Pin `firebase-tools` to an exact version, or add it as a lockfile-covered `devDependency` invoked via `npx`; install before the credential-exporting auth step.
- [ ] Pin the WIF/deploy trust to `main` — `assertion.ref == 'refs/heads/main'` + `repository_owner` on the provider, and/or a branch-restricted GitHub Environment with required reviewers; restrict `workflow_dispatch`.
- [ ] Prevent the off-path "dead form" CSP staleness: keep `firebase deploy` coupled to a fresh `npm run build` (guard/comment), commit a sentinel hash that fails loudly if not regenerated, and add a post-deploy form-POST smoke check.
- [ ] Harden `gen-csp.mjs` against inline scripts containing `</script>`: use a real HTML parser or build-manifest hashing, and assert the hashed-script count matches the expected count.
- [ ] (Optional, low cost) Wrap the rate-limit/daily-cap counters in `LockService` if tighter-than-best-effort bounds are wanted; and/or move `appendRow` ahead of the per-minute throttle return so throttled real leads still save (mirroring the daily-cap behavior). At minimum, document that the per-minute path drops rather than degrades.
- [ ] Add a sub-processor clause to `privacy.astro` naming Google Workspace (Sheets, Apps Script, Gmail).
- [ ] Change `.gitignore` to a `.env*` glob (or add `.env.local` / `.env.*.local`) and fix the `HANDOFF-form-endpoint.md` claim to match.

**Info — optional hardening / hygiene:**

- [ ] Align the daily-email-cap day key to the project timezone (`Utilities.formatDate(..., 'America/Los_Angeles', 'yyyy-MM-dd')`).
- [ ] Run `Outreach.js` `name`/`org` through a `oneLine_`-style strip for consistency with `Code.js`.
- [ ] Resolve the `astro.config.mjs` env-source skew (use `loadEnv()` or document the OS-env requirement for local prod builds).
- [ ] Add `concurrency: { group: deploy-hosting, cancel-in-progress: true }` to the deploy workflow.
- [ ] Move `NOTIFY_TO` to a Script Property and prefer a `leads@` role alias.
- [ ] Optionally gitignore `.clasp.json` (scriptId is non-secret) and `rm` the stale preview `dist/`.
