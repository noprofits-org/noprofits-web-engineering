# Pre-Launch Security Review — Round 3 (Verification)

**Date: 2026-06-20**

*Produced by an adversarial multi-agent delta on `SECURITY-REVIEW.md` (Round 1) and `SECURITY-REVIEW-ROUND2.md` (Round 2). It verifies — against current source, not "touched" — that each Round-2 OPEN item is genuinely closed, and hunts for regressions or new issues the Round-2 fixes introduced.*

---

## Executive Summary

**Verdict: CLEARED FOR LAUNCH.** Every Round-2 OPEN finding above Info has been verified closed against current source, with the exceptions of the WIF provider-side branch/owner binding (Low — in-repo half done, authoritative half is a documented GCP one-time step that cannot be verified from the repo) and a set of consciously-deferred Info-level items. No new vulnerability, regression, or bypass was introduced by the Round-2 fixes. The remaining gates are operational/non-security (set `PUBLIC_FORM_ENDPOINT`, push to main, the robots/noindex launch toggle).

The Round-2 work is high quality: SHA pins were verified against the live upstream tags (no wrong/malicious pin), the throttle/cap path now degrades-don't-drop (leads always save, only the email is suppressed), the daily-cap day key is timezone-correct, the honeypot was renamed and made consistent across all three layers, and `gen-csp.mjs` now fails the build loudly on unbalanced `<script>` tags.

### Round-2 OPEN-item scoreboard

| Item | R2 severity | Status now |
|---|---|---|
| GitHub Actions pinned to commit SHAs (checkout/setup-node/auth) | Low | **Fixed** — SHAs verified correct vs live tags |
| firebase-tools pinned at deploy time | Low | **Fixed** — `@15.22.0`, installed before auth |
| WIF / trigger pinned to protected branch ref | Low | **Partial** — in-repo `if`-gate done; provider condition documented-only |
| Deploy-workflow concurrency control | Info | **Fixed** |
| `.gitignore` `.env` glob (`.env` + `.env.*`, `!.env.example`) | Low | **Fixed** |
| Daily-email-cap day key in `America/Los_Angeles` | Info | **Fixed** |
| Throttled submissions still save the lead (only email suppressed) | Low | **Fixed** |
| `gen-csp.mjs` fails loudly on unbalanced `<script>`/`</script>` | Low | **Fixed** |
| Honeypot `company` → `np_hp` (form + client + server agree) | Med* | **Fixed** |
| privacy.astro names Google as data processor | Low | **Fixed** |
| Build guard env-source skew (`process.env` vs `import.meta.env`) | Info | **Fixed** |
| Outreach.js strip name/org (oneLine_-style) before interpolation | Info | **Not-fixed** (deferral acceptable) |
| Outreach.js double-send guard | Info | **Deferred-ok** (present, advisory by design) |
| Rate-limit / daily-cap counters non-atomic (TOCTOU) | Low | **Deferred-ok** |
| Fixed-window rate limit ~2x boundary burst | Info | **Deferred-ok** |
| Off-path CSP staleness ("dead form" on bare deploy) | Low | **Partial** — both supported paths safe; no sentinel/smoke-check |
| `.clasp.json` scriptId committed | Info | **Not-fixed** (non-secret; optional) |
| Hardcoded `NOTIFY_TO` personal mailbox | Info | **Not-fixed** (internal routing address; optional) |
| CAPTCHA defense-in-depth | Med (deferred) | **Deferred-ok** — stub contract ready |

\*The honeypot rename was tracked at Med on one surface and Info on another; both confirm all three layers now agree on `np_hp`.

---

## Remediation Detail

**GitHub Actions SHA-pinning — verified-correct, not just present.** `deploy.yml:51,53,70` pin `actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4`, `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4`, and `google-github-actions/auth@c200f3691d83b41bf9bbd8638997a462592937ed # v2`. All three 40-hex SHAs were resolved against the live GitHub `git/refs/tags` API: each is exactly the commit the claimed tag points to, and each carries a real semver release (checkout v4.3.1, setup-node v4.4.0, auth v2.1.13). No wrong or malicious pin. The trailing comment annotations match the resolved versions. (No `.github/dependabot.yml` is wired, so the "bump via Dependabot" comment is advisory only — the pins themselves are correct.)

**firebase-tools pinned and correctly ordered.** `deploy.yml:67` `npm install -g firebase-tools@15.22.0` — exact version, confirmed published. Notably it is installed *before* the credential-exporting `auth` step (`:69-74`), so a compromised release cannot run with ADC in scope.

**Throttle-still-saves (the standout fix).** `Code.js` computes `throttled` at `:60` but `appendRow` at `:87-95` runs **unconditionally** — the only early returns are the honeypot (`:52`) and missing name/contact (`:75`). Throttle now gates only the notification email (`:104` `if (!throttled && sentToday < DAILY_EMAIL_CAP)`), and the day counter increments only inside the send branch (`:119`). A flood can no longer silently lose a real lead's sheet row, mirroring the daily-cap degrade-don't-drop behavior.

**Timezone-correct day key.** `Code.js:102` now keys the cap with `Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd')`, matching `appsscript.json` timeZone. The cap window aligns with the operator's local day.

**Honeypot is now `np_hp` (correcting Round-2's `company` reference).** Round-2 reports referred to the honeypot field as `company`; it has been **renamed to `np_hp`**, and all three layers agree: form input `InquiryForm.astro:26` (`name="np_hp"`), client check `InquiryForm.astro:247` (`input[name="np_hp"]`), and server `Code.js:52` (`if (p.np_hp) return ...'ok'`). No residual `company` honeypot reference remains anywhere in `src/` or `apps-scripts/`. The field is accessibly hidden (off-screen, `aria-hidden`, `tabindex=-1`, `autocomplete=off`), so it does not break the drop.

**gen-csp.mjs fails loudly.** `gen-csp.mjs:39-47` now counts `<script\b` opens vs `</script>` closes per file and throws before hashing on mismatch (verified empirically — exits non-zero). This converts the prior silent CSP-break into a build failure. Combined with the JSON-LD `<` → `\u003c` escaping (`BaseLayout.astro:104,106`), the realistic truncation vector is closed.

**privacy.astro names Google.** `privacy.astro:56-58` now states Google Workspace (Sheets, Apps Script, Gmail) processes the data on the site's behalf — naming all three processing points, consistent with `Code.js` (Sheets + MailApp) and `Outreach.js` (Gmail). Footer and both forms link it.

**Build guard env-source skew resolved.** `astro.config.mjs:21-22` now reads `loadEnv(..., 'PUBLIC_')` in addition to `process.env`, matching what `site.ts` (`import.meta.env`) consumes. Local prod builds via `.env` are no longer falsely blocked; the guard remains fail-closed and still cannot pass while shipping a placeholder.

**Also verified intact (earlier-round fixes, no regression):** CSP 3-hash set recomputes byte-for-byte against current dist; full header set present (HSTS preload, nosniff, Referrer-Policy, X-Frame-Options DENY, Permissions-Policy incl. `interest-cohort=()`, CSP `base-uri/object-src/frame-ancestors 'none'`); fonts self-hosted (zero `googleapis`/`gstatic` in dist); CSV/formula `neutralize_` applied to all six fields after `clamp_`; `replyTo` uses `validEmail || NOTIFY_TO` with `oneLine_`-stripped subject; `.clasprc.json` and `.env.*` gitignored; no `/exec` URL or secret committed across all history; no-cors UX gates `showSuccess()` on the fetch result.

---

## New / Remaining Findings

### Low

**[CICD] WIF provider ref/owner binding is documentation-only — the only in-repo enforcement is the branch `if`-gate** — `.github/workflows/deploy.yml:15-19,46`
*Description:* The authoritative control Round-2 asked for — a WIF provider attribute-condition `assertion.ref == 'refs/heads/main'` + `repository_owner == 'noprofits-org'` — exists only as a prose comment in the workflow header, because it lives in Google Cloud IAM config that is not in the repo and cannot be verified from source. What *is* enforced in-repo is the job-level `if: github.ref == 'refs/heads/main'` (`:46`), which blocks a `workflow_dispatch` from a non-main branch from reaching the deploy steps that request the `id-token`.
*Impact:* Bounded — keyless WIF, single-project `roles/firebasehosting.admin`, no PII/Sheet access; worst case is redeploy/deface of a static marketing site, not anonymously exploitable (forked-PR runs get no OIDC identity). This is a "verify the operator actually applied the IAM condition" gap, not a confirmed misconfiguration — but it is the kind of control that is easy to skip because the workflow *appears* to handle it.
*Recommendation:* Confirm out-of-band that the live WIF provider carries the `assertion.ref` + `repository_owner` condition, or move to a branch-restricted GitHub Environment with required reviewers (enforced by GitHub regardless of provider config). Track the GCP condition somewhere auditable; treat the comment as a checklist item, not the control itself.

**[CICD] Committed `firebase.json` CSP carries the placeholder build's script hashes** — `firebase.json:71`, `package.json:9`, `scripts/gen-csp.mjs`
*Description:* Empirically confirmed: the three committed `sha256` hashes are exactly the ones an `ALLOW_PLACEHOLDER_ENDPOINT` build produces (rebuilding in placeholder mode yields zero diff). A build with a real `https://script.google.com/.../exec` endpoint changes one hash (`sha256-436Mh…` → a production-shaped value), because the endpoint is inlined into the form-script body. Both supported deploy paths regenerate the CSP from the production dist before deploy (`deploy.yml` runs `npm run build`; `package.json:12` `deploy` chains `npm run build && firebase deploy`), so CI and the in-repo local path are safe.
*Impact:* Purely off-path: a bare `firebase deploy` against a stale locally-built placeholder dist + the committed `firebase.json`, skipping the build wrapper, would ship a CSP whose `script-src` does not cover the live form handler. `script-src` has no `'unsafe-inline'` fallback, so the form renders but never POSTs — a silent "dead form" with no console error a visitor sees and nothing in the Leads sheet. This is availability/operational and **fails safe** (it blocks the site's own script; it can never become a CSP bypass). Same failure the build guard exists to prevent, one layer down on a manual path. (Note: `dist/` is gitignored, so the trigger is a stale *local* dist, not a committed one.)
*Recommendation:* Keep `firebase deploy` coupled to a fresh `npm run build` (both in-repo paths already do). Optionally commit a sentinel/obviously-invalid hash so a forgotten regenerate fails loudly, and add a post-deploy smoke check that the form actually POSTs. Not launch-blocking; CI deploy is correct.

### Info

- **[CICD] `gen-csp` `</script>` guard catches count imbalance but not balanced mis-nesting** (`scripts/gen-csp.mjs:30-47`). The new opens-vs-closes count assertion is a solid fail-loud improvement (verified it throws and exits 1 on a literal `</script>` in a body). Residual latent edge case: a file whose tag counts stay balanced while the non-greedy body regex (`:32`) still truncates at an inner `</script>` would yield a hash that doesn't match the shipped script. Latent only — today's dist has only simple module scripts and the guard passes; failure direction is always the site's own script being CSP-blocked, never a bypass. Optional: hash from a real HTML parser or Astro's build manifest, or assert an expected inline-script count.

- **[APPS-SCRIPT] `Outreach.js` interpolates sheet-sourced name/org without `oneLine_`-style stripping** (`Outreach.js:40-58,86-88`). Confirmed not-fixed: `ackTemplate_` reads name/org (`.trim()` only) and interpolates them raw into a greeting/body; there is no `oneLine_` equivalent in `Outreach.js`. Negligible — plain-text body (`body:`, not `htmlBody`), recipient is the row's own `EMAIL_RE`-validated email, structured `MailApp.sendEmail` fields prevent header injection, and every send is owner-previewed + confirmed via the owner-only `onOpen` menu. Worst case is a cosmetically malformed greeting. Optional consistency fix; safe to defer (Round-2 classed it Info).

- **[APPS-SCRIPT] Notification body interpolates raw (unvalidated) `email` rather than `validEmail`** (`Code.js:112`). `'Email: ' + email` uses the clamped-but-unvalidated `email`, whereas `replyTo` (`:107`) correctly uses `validEmail`. If a submitter sends a malformed email plus a valid phone, the alert body shows the garbage string. No injection (body is a structured `MailApp` field, addresses are separate). Optional: display `validEmail` or annotate `(invalid)` for operator clarity.

- **[APPS-SCRIPT] Fixed-window rate limit permits ~2x boundary burst; counters non-atomic** (`Code.js:57-61,101-119`). Unchanged from Round-2 and documented in-code as best-effort. `minuteKey` is a tumbling window and the CacheService/PropertiesService read-modify-writes are non-atomic, so a parallel burst can overshoot. Failure direction is overshoot, never bypass — every passing request increments, leads always save, daily cap is the hard mail backstop. `LockService` would tighten bounds but is over-engineering for this volume.

- **[ASTRO] `showNotice()` `innerHTML` sink confirmed fed only by static constants** (`InquiryForm.astro:214-218,232-234,253,286`). Verified the lone `innerHTML` sink is called only with a hardcoded preview string and a `reachUs` template interpolating `PHONE_TEL`/`PHONE_DISPLAY`/`EMAIL` — all compile-time literals from `site.ts`; `clearNotice` uses `textContent`. No form-field value is ever reflected into the DOM. No DOM-XSS path. (Informational confirmation; no action.)

- **[APPS-SCRIPT] Public `doPost` has no origin/Referer check — accepted by design** (`Code.js:45-52`). The endpoint is a public "Anyone" web app with no shared-secret or origin allowlist — correct, since the `/exec` URL ships in the client bundle and a no-cors POST's `Origin`/`Referer` is trivially spoofable. Abuse is bounded server-side by honeypot + per-minute rate limit + daily email cap + length caps + email validation + formula neutralization (all verified present). CAPTCHA (`verifyCaptcha_` stub at `:146-161`) is the documented fast-follow; wire it after the honeypot when ready.

- **[APPS-SCRIPT] `.clasp.json` scriptId committed** (not gitignored, still tracked). Non-secret project identifier; clasp push/pull/exec requires the owner OAuth token in the gitignored `.clasprc.json`, and the bound Sheet uses `getActiveSpreadsheet()` so no Sheet ID is exposed. Optional cleanup (`git rm --cached` + `.gitignore`), consistent with the Round-1/2 deferral.

- **[APPS-SCRIPT] Hardcoded `NOTIFY_TO = 'peter@noprofits.org'`** (`Code.js:32`). Internal owner-notification routing address, not a credential, already published in the file header. `Outreach.js:23` correctly uses the `hello@` role alias for customer-facing reply-to. Optional move to a Script Property / `leads@` alias; never launch-blocking.

---

## Updated Pre-Launch Checklist

**Security — all clear above Info.** The only security item that requires an out-of-repo action:

### Low
- [ ] **Confirm the live WIF provider carries the `assertion.ref == 'refs/heads/main'` + `repository_owner == 'noprofits-org'` attribute condition** (GCP IAM — the authoritative half; in-repo `if`-gate is done). Or adopt a branch-restricted GitHub Environment with required reviewers.

### Info (optional, non-blocking — may defer)
- [ ] Couple any manual `firebase deploy` to a fresh `npm run build`; consider a sentinel hash + post-deploy form-POST smoke check.
- [ ] Add `oneLine_`-style strip on name/org in `Outreach.js` for consistency with `Code.js`.
- [ ] Show `validEmail` (or annotate `(invalid)`) in the notification body (`Code.js:112`).
- [ ] Move `gen-csp` hashing to a real HTML parser / build manifest, or assert an expected inline-script count.
- [ ] `git rm --cached` the `.clasp.json` scriptId; move `NOTIFY_TO` to a Script Property / `leads@` alias.
- [ ] Wire `verifyCaptcha_` after the honeypot when CAPTCHA is desired.

**The remaining launch gates are non-security:** UI/UX polish, SEO, flipping the `robots.txt`/`noindex` launch toggle, setting `PUBLIC_FORM_ENDPOINT` to the real `/exec` URL, and pushing to `main` (which triggers the verified CI deploy path).

**This security review is closed out.** No open security finding blocks launch; the single Low is an operator verification step in GCP, and all other residuals are consciously-deferred Info-level items with no exploitable path under this static-site + public-Apps-Script architecture.
