# Pre-Launch Security Review — noprofits.org

Scope: Static Astro 5 marketing site (Firebase Hosting) + Google Apps Script lead-form backend, CI/CD via keyless Workload Identity Federation.
Date: 2026-06-20
Produced by an adversarial multi-agent review (independent specialist findings adjudicated by a verification pass that confirmed each finding against actual file contents and adjusted severity for this architecture).

---

## Executive Summary

This review assessed the noprofits.org repository against the realities of its architecture: a fully static, server-runtime-free Astro site whose only dynamic surface is a public Google Apps Script web app that records leads to a Google Sheet and emails the owner. Classic server-side vulnerability classes (XSS via reflected input, SQLi, SSRF on the site itself) do not apply because there is no server request handling — so this review concentrates on the surfaces that *do* apply: the Apps Script `doPost` endpoint, HTML injection sinks, response/security headers, CI/CD trust, secret/PII hygiene, and abuse/spam vectors.

The architecture is intentionally minimal and makes several genuinely good security choices (keyless WIF, lockfile-pinned site deps, an honest no-cors form, a honeypot, JSON-LD sinks fed only by static data, and a demo-mode endpoint guard that keeps the form inert until a real endpoint is wired). There are **no Critical or High findings** and **no live, exploitable vulnerabilities** in the current state — the lead endpoint is still a placeholder, so the most material issues are latent until launch. The work that remains is concentrated in two buckets: (1) hardening the Apps Script endpoint against spam/abuse before it goes live (rate limiting, a server-verified CAPTCHA, formula-injection neutralization, server-side validation/length caps), and (2) launch-blocking compliance/hardening on the static side (a privacy policy for the PII being collected, and HTTP security headers in `firebase.json`). **The site is close to launch-ready; it should not go live with the form endpoint enabled until the Medium-severity Apps Script abuse controls and the privacy-policy gap are addressed.**

### Severity counts

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High     | 0 |
| Medium   | 4 |
| Low      | 10 |
| Info     | 8 |

(Counts reflect findings after de-duplication of the multiple agents' overlapping reports; the same underlying issue raised by more than one specialist is counted once below.)

---

## Findings

Several specialists independently reported the same underlying issues across surfaces. Duplicates have been merged; the consolidated finding carries the verified severity.

### Medium

#### [Medium] Apps Script lead endpoint has no rate limiting, CAPTCHA, or shared-secret — spam, sheet flooding, and MailApp quota exhaustion (self-DoS of the lead pipeline)
**File:** `apps-scripts/leads_sheet/Code.js:24-71` (doPost), `appsscript.json` (deployed "Execute as Me / Anyone")
*Merged from four independent reports of the same endpoint-abuse issue.*

**Description.** `doPost` is a fully unauthenticated public endpoint. The only abuse control is the `company` honeypot (line 29) plus a minimal presence check (name + email-or-phone, line 32) — both trivially satisfied by any scripted POST that omits `company`. There is no rate limit, no CAPTCHA/Turnstile, no shared-secret token, and no per-time-window throttle. Every accepted POST first appends a row to the Leads sheet (lines 41-49) **and then** sends a notification email via `MailApp.sendEmail` (lines 51-64), each running under the owner's daily MailApp quota (~100/day consumer Gmail, ~1500/day Workspace).

**Impact.** A trivial script can flood the Leads sheet with junk and mail-bomb `peter@noprofits.org`. Critically, because `appendRow` runs *before* `sendEmail`, once the daily MailApp quota is exhausted, `sendEmail` throws, the exception is swallowed by the catch (lines 67-70) returning `'error'`, and real leads continue to land silently in the sheet **with no email notification** for the rest of the day — a self-healing denial-of-service on the notification pipeline with no signal to the operator. No financial cost is involved (MailApp sends are a free capped quota, not per-message billed), and no existing data is exfiltrated; the impact ceiling is nuisance spam + one day of missed *email* alerts. This is currently latent because the endpoint is a placeholder, but it activates the moment `FORM_ENDPOINT` is wired.

**Recommendation.** Add server-side abuse controls before going live:
- **Rate limit** with `CacheService`/`PropertiesService` (a coarse per-minute counter plus a daily email cap; beyond the cap, keep writing to the sheet but batch/digest notifications instead of one email per submission, so leads are never lost).
- **Server-verified CAPTCHA** — issue a Cloudflare Turnstile / reCAPTCHA v3 token client-side and verify it in `doPost` via `UrlFetchApp` before any `appendRow`/`sendEmail`.
- Optionally add a **shared-secret token** the site embeds and `doPost` checks (note: this is obscurity-only since the bundle is public, so pair it with the above, do not rely on it).
- Keep the honeypot as a cheap first filter only.

```javascript
// sketch at top of doPost, before append/send:
var cache = CacheService.getScriptCache();
var minuteKey = 'rl_' + Math.floor(Date.now() / 60000);
var count = Number(cache.get(minuteKey) || 0);
if (count >= 10) { return ContentService.createTextOutput('error'); }
cache.put(minuteKey, count + 1, 120);

var props = PropertiesService.getScriptProperties();
var dayKey = 'mail_' + new Date().toISOString().slice(0, 10);
var sentToday = Number(props.getProperty(dayKey) || 0);
// ... after a successful sheet append, gate the email on sentToday < DAILY_CAP,
//     and increment props for dayKey; fall back to digest beyond the cap.
```

> **Operator note — is a CAPTCHA actually needed?** The other three controls in
> this section (per-minute rate limit, daily email cap with leads-still-saved
> fallback, and formula neutralization) now carry the real load and are
> implemented server-side in `Code.js`. A CAPTCHA would add a fourth layer that
> targets only the residual case of a bot that defeats the honeypot *and* stays
> under the rate limit — a small residual for a low-volume nonprofit lead form.
> It is also the **highest-friction** control on this list: it adds a step (and,
> with reCAPTCHA, third-party tracking plus a privacy-policy entry) for exactly
> the mission-driven, sometimes low-tech users you most want to convert, so it
> risks **excluding legitimate submitters to stop low-cost spam**.
>
> **Recommendation: do not gate launch on a CAPTCHA.** Ship with honeypot + rate
> limit + caps + neutralization, watch the Leads sheet, and add a CAPTCHA only if
> you actually observe spam getting through. If you do add one later, prefer
> **Cloudflare Turnstile** (invisible, free, no ad-tracking) over reCAPTCHA. A
> `verifyCaptcha_()` stub is already wired in `Code.js` for this fast-follow.

---

#### [Medium] Sheet CSV / formula injection — attacker values become live formulas
**File:** `apps-scripts/leads_sheet/Code.js:41-49` (appendRow of raw `p.*` values)

**Description.** `appendRow` writes raw, attacker-supplied fields (name, organization, email, phone, address, message) straight into the Leads sheet with no neutralization of leading `=`, `+`, `-`, `@`, or tab/CR characters. Because the endpoint is public and unauthenticated, this sink is fully reachable. When the operator opens the sheet (or exports to CSV/XLSX), a cell beginning with `=` is evaluated as a live formula (e.g. `=HYPERLINK(...)`, `=IMPORTXML(...)`, `=IMPORTDATA(...)`).

**Impact.** Data exfiltration from the spreadsheet via outbound formula calls (`IMPORTXML`/`HYPERLINK` to an attacker URL), and content spoofing of the lead record the operator relies on. The blast radius is one trusted internal viewer on a low-volume sheet with no automated downstream consumption, and the Excel/DDE command-execution angle is the weakest part (requires a deliberate export plus a vulnerable, prompt-dismissed Excel config; modern Excel blocks DDE by default) — but the outbound-formula exfiltration and operator-spoofing risks are real and trivially fixed.

**Recommendation.** Neutralize the formula prefix on **every** attacker-controlled field before `appendRow` (not just `message`):

```javascript
function neutralize(v) {
  v = (v == null) ? '' : String(v);
  return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
}
sheet.appendRow([
  new Date(),
  neutralize(p.name), neutralize(p.organization), neutralize(p.email),
  neutralize(p.phone), neutralize(p.address), neutralize(p.message)
]);
```

---

#### [Medium] Honeypot is the sole bot defense and is statically discoverable
**File:** `apps-scripts/leads_sheet/Code.js:28-29` (p.company drop); `src/components/InquiryForm.astro:26-31` (honeypot markup)

**Description.** The only bot mitigation is the `company` honeypot. Its field name, hidden styling, and drop behavior are all visible in the static HTML/source (and mirrored in the client script), so a targeted bot trivially learns to leave `company` empty. Honeypots stop only naive form-fillers; they provide no protection against a scripted attacker POSTing directly to `/exec`, which is the realistic abuse model for a public lead endpoint.

**Impact.** The targeted-spam and flooding/quota attacks above are not mitigated, and the honeypot creates a false sense of protection. (Part of the concrete impact is carried by the rate-limit/quota finding above; on its own this is the "single, bypassable layer" gap.)

**Recommendation.** Layer rate limiting on top of the honeypot (now implemented in `Code.js`), and keep the honeypot only as a cheap first filter, never as the sole control. A server-verified CAPTCHA is the natural further layer but is **optional, not launch-blocking** — see the CAPTCHA operator note under the endpoint-abuse finding for why it can be deferred until spam is actually observed.

---

#### [Medium] No privacy policy / consent notice / data-retention statement on a site collecting PII
**File:** `src/components/Footer.astro` (no link), `src/pages/` (no policy page), `src/components/InquiryForm.astro`

**Description.** Both form variants collect name, organization, email, phone, and (contact form) physical address + free-text message, then persist to a Google Sheet and email the full record. A repo-wide grep for privacy / consent / data-retention / GDPR / CCPA / terms returns **nothing**. The footer has only a copyright line and no privacy link; `src/pages/` has no policy page. The sole notice is the soft contact-form line "We'll only use your details to talk about your website." — the hero form has no notice at all.

**Impact.** Prospective legal/regulatory exposure (CCPA-style obligations once volume grows; general FTC unfair-practices risk for undisclosed data handling), reputational risk for a vendor whose pitch is professional web work, and — most concretely — **undocumented, unbounded retention** of third-party PII in a Sheet with no deletion process. (No health data is collected, so Washington's My Health My Data Act does not apply; CCPA statutory thresholds are unlikely to be met pre-launch, so the active risk is primarily the retention gap and trust/credibility rather than immediate statutory liability.)

**Recommendation.** This is a cheap, entirely static fix and should be treated as launch-blocking:
- Add a short **privacy page** under `src/pages/` covering what is collected, why, where it is stored (Google Sheet), how long it is retained, how to request deletion, and a contact.
- Link it from `Footer.astro`.
- Add a one-line consent/notice with a link beneath **both** form submit buttons.
- Define and document a **retention window** for the Leads sheet and a periodic deletion process.

---

### Low

#### [Low] No HTTP security headers (CSP, nosniff, Referrer-Policy, frame-ancestors, Permissions-Policy, HSTS) on Firebase Hosting
**File:** `firebase.json:9-18` (headers block has only Cache-Control)
*Merged from two independent reports.*

**Description.** The Hosting config sets only `Cache-Control`. There is no `Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` / CSP `frame-ancestors`, `Permissions-Policy`, or `Strict-Transport-Security`. For a static Firebase site, `firebase.json` is the only place these can be set (no SSR/edge layer). The site is framable (clickjacking on the lead form), leaks full referrer URLs to Google Fonts, and has no MIME-sniffing protection.

**Impact.** Pure defense-in-depth — there is no live exploit path today (the only `set:html` sinks are JSON-LD fed by static data; the form never reflects input into the DOM, so there is no XSS for CSP to contain). The concrete, zero-risk wins are `nosniff`, `Referrer-Policy`, `frame-ancestors 'none'`, `Permissions-Policy`, and HSTS.

**Recommendation.** Add a headers entry for `**` in `firebase.json`. **Important correction to the original guidance:** the build was inspected — Astro emits the form/header logic as **inline** `<script type="module">` blocks (there are no external JS files in `dist/_astro/`), so a `script-src 'self'` policy would break the site. Use per-script `sha256` hashes (run a build, hash each inline script) **or** `'unsafe-inline'` for `script-src` (which negates most XSS-containment value). Re-verify against `dist/` before committing the CSP. The non-CSP headers below are safe to ship as-is:

```json
{
  "source": "**",
  "headers": [
    { "key": "Strict-Transport-Security", "value": "max-age=31536000; includeSubDomains; preload" },
    { "key": "X-Content-Type-Options", "value": "nosniff" },
    { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
    { "key": "X-Frame-Options", "value": "DENY" },
    { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" },
    { "key": "Content-Security-Policy", "value": "default-src 'self'; script-src 'self' 'sha256-<hash-each-inline-script>'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://script.google.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://script.google.com" }
  ]
}
```

---

#### [Low] Third-party Google Fonts loaded over the network with no Subresource Integrity / self-hosting
**File:** `src/layouts/BaseLayout.astro:96-102`

**Description.** Heading/body fonts are pulled from `fonts.googleapis.com` (CSS) and `fonts.gstatic.com` (woff2) at runtime, with no integrity attribute (SRI is impractical for Google's UA/version-variable CSS — which is itself the supply-chain concern). This is the only third-party origin the page trusts. A compromise or MITM of that origin could inject CSS, and CSS can exfiltrate typed form-field values via attribute selectors + `background-image` requests. (`crossorigin` is correctly set on the gstatic preconnect.)

**Impact.** Adds a third-party origin to the trust/exfil surface of a page that collects PII. Exploitation requires Google's font CDN to be compromised or the visitor's TLS to be MITM'd — a high bar — so the strongest day-one benefit is privacy (Google currently sees every visitor's IP/UA) rather than a likely exploit.

**Recommendation.** Self-host the two font families (download the woff2, add local `@font-face` in `global.css`, drop the two Google origins). This removes the third-party origin, lets CSP be `default-src 'self'`, improves privacy, and eliminates the SRI gap. If keeping Google Fonts, constrain them via CSP `style-src`/`font-src` to exactly those origins.

---

#### [Low] Email header / content shaping via attacker-controlled replyTo and subject
**File:** `apps-scripts/leads_sheet/Code.js:53` (replyTo `p.email`), `:54` (subject), `:55-63` (body)

**Description.** `doPost` passes the unsanitized attacker-supplied `p.email` directly into `MailApp.sendEmail({replyTo: p.email})`, and `p.organization`/`p.name` into the subject, with no server-side validation (the client `type=email` is bypassed by a direct POST). `MailApp` uses typed structured fields and rejects malformed/CRLF-bearing addresses, so classic RFC-822 header injection is **not** achievable here; the subject is also a hardcoded prefix with org/name appended, so a fake `Re:` cannot be prepended.

**Impact.** Low. The notification has exactly one internal recipient (`peter@noprofits.org`), and the sender identity (Peter's own account) is not spoofable. The real impact is that Peter's "Reply" can be routed to an attacker-chosen/garbage address, and attacker-authored body content is shown in the alert — a low-grade nuisance, not credential theft or data exfil.

**Recommendation.** Validate `p.email` server-side against a strict regex before using it as `replyTo`; on failure, omit `replyTo` (let it default to the owner) rather than passing the raw value. Strip newlines/control chars and hard-cap length on `name`/`organization` before interpolating into the subject. Treat all fields as untrusted regardless of client-side input types.

---

#### [Low] No server-side email-format validation
**File:** `apps-scripts/leads_sheet/Code.js:32`

**Description.** The validation at line 32 only checks that `name` exists and that at least one of email/phone is non-empty — it never validates that `p.email` is syntactically valid. The client `type=email` check is not enforceable via direct POST, so garbage/forged addresses reach both the sheet and the reply path.

**Impact.** Junk/garbage email values in the private Leads sheet (data hygiene) and a forged/invalid reply-to such that a manual "Reply" goes to a wrong address or bounces. This does **not** escalate to header injection (see above).

**Recommendation.** Validate `p.email` with a strict regex server-side; treat an invalid email as "no email present" and require phone in that case (or reject).

---

#### [Low] No length caps on any field — unbounded writes from a public endpoint
**File:** `apps-scripts/leads_sheet/Code.js:41-63`

**Description.** No field (message, address, name, etc.) is length-capped server-side; the client textarea has no `maxlength` either (`InquiryForm.astro:82`), and the client is bypassable. An attacker can submit multi-megabyte values, bloating each sheet cell and email body.

**Impact.** Storage/quota amplification and degraded operator experience; per-cell bloat is bounded by Sheets' ~50k-char cell cap, so this is primarily an *amplifier* of the no-throttle finding rather than standalone-serious. No secret exposure, no code execution, no XSS sink (ContentService returns plain text; the email body is plain text).

**Recommendation.** Hard-cap each field server-side before `appendRow`/`sendEmail` (e.g. name/org/email/phone ≤ 200, address ≤ 500, message ≤ 5000) and reject or truncate oversized input.

---

#### [Low] GitHub Actions pinned to mutable tags, not commit SHAs (supply-chain)
**File:** `.github/workflows/deploy.yml:35,37,46`

**Description.** All actions are referenced by mutable major-version tags: `actions/checkout@v4`, `actions/setup-node@v4`, and the high-privilege `google-github-actions/auth@v2`. Tags are repointable by the upstream owner (or an attacker who compromises the action repo), so the workflow does not pin a verified artifact. The `auth` action runs in a job holding `id-token: write` and mints WIF credentials.

**Impact.** If a third-party action (or a vendored transitive dependency) is compromised and its tag repointed, malicious code executes in a job that can obtain ADC via WIF and deploy to the project (the `tj-actions/changed-files` pattern). Blast radius is bounded: the deploy SA holds only `roles/firebasehosting.admin` on one project, WIF is repo-scoped with no long-lived key, and all three actions are first-party (GitHub/Google) — so worst case is redeploying/defacing a static marketing site, not project takeover.

**Recommendation.** Pin every `uses:` to a full 40-char commit SHA with the version in a trailing comment, e.g. `uses: google-github-actions/auth@<sha> # v2.1.x`. Enable Dependabot for `github-actions` to keep SHAs current. Prioritize the `auth` action.

---

#### [Low] Global `firebase-tools` installed unpinned at deploy time (supply-chain)
**File:** `.github/workflows/deploy.yml:52`

**Description.** The deploy step runs `npm install -g firebase-tools` with no version or lockfile constraint, pulling the latest published `firebase-tools` and its full transitive tree on every run. Site deps are correctly pinned with `npm ci` (line 42), but this global install floats. It executes immediately after the auth step has exported ADC into the environment (`export_environment_variables: true`, line 50; `GOOGLE_APPLICATION_CREDENTIALS`, line 58).

**Impact.** A compromised `firebase-tools` release (or a transitive dependency) would run with access to the federated GCP credential and could push arbitrary Hosting content. Bounded by the same scoped SA (`firebasehosting.admin`, one project) and short-lived federated token — worst case is static-site defacement, not org-wide compromise. Exploitation requires an actual upstream compromise (background-level industry risk).

**Recommendation.** Pin an exact version (`npm install -g firebase-tools@<version>`) or — better — add `firebase-tools` as a `devDependency` (covered by `package-lock.json` + `npm ci`) and invoke via `npx firebase ...`. Consider installing tooling **before** the credential-exporting auth step.

---

#### [Low] WIF / workflow trigger not pinned to the protected branch ref
**File:** `.github/workflows/deploy.yml:22-25` and the provider-binding note (lines 14-20)

**Description.** The workflow triggers on push to `main` **and** `workflow_dispatch`, and the documented WIF provider binding is by `attribute.repository` (the whole repo) only — there is no `attribute.ref`/branch condition, and the workflow itself does not gate on ref or actor. `workflow_dispatch` can be invoked by any user with write access from any branch, and the run still receives `id-token: write`. The trust boundary is "anyone with repo write," not "a merge to main."

**Impact.** A collaborator (or a compromised collaborator token) can deploy unreviewed code from an arbitrary branch via `workflow_dispatch`, bypassing the intended gated-PR-merge control. This requires an already-trusted actor (not exploitable anonymously; forked-PR runs do not receive the identity), and blast radius is bounded to the scoped `firebasehosting.admin` SA on a static site — no access to the separate Leads Sheet/Apps Script account, no PII exposure (WIF is keyless).

**Recommendation.** Tighten the WIF provider's attribute condition to require `repository_owner` and bind the `principalSet` to `assertion.ref == 'refs/heads/main'`; and/or use a GitHub Environment with required reviewers and a branch restriction so the deploy identity is only available from `main`. Document the ref-pinning in the enablement steps.

---

#### [Low] `Cache-Control: immutable` applied to non-content-hashed public assets
**File:** `firebase.json:11-13`

**Description.** The `immutable, max-age=31536000` rule matches by extension (`js|css|woff2|svg|png|jpg|jpeg|webp|ico`) across **all** paths. Astro fingerprints assets under `/_astro/*` (safe), but files copied verbatim from `public/` are served at stable, un-hashed paths — confirmed `dist/favicon.svg` and `dist/og-image.svg` at the root — and will be cached as immutable for a year.

**Impact.** A cache-correctness/operational defect, not a direct security hole: updating the favicon or the OG social-share image (already flagged for a launch SVG→PNG upgrade in `src/data/site.ts`) will not reach clients/CDNs that cached the old file for up to a year. (A true SVG→PNG rename to a new path dodges this; in-place edits or path reverts hit it.)

**Recommendation.** Scope `immutable` to the hashed output only — give `source: "/_astro/**"` the immutable rule, and give root-level public assets (`favicon.svg`, `og-image.*`) a shorter `max-age` with `must-revalidate`. Alternatively, version/rename public assets when they change.

---

#### [Low] `.clasprc.json` (clasp OAuth credentials with refresh token) is NOT gitignored
**File:** `.gitignore` (no entry); clasp runs in `apps-scripts/leads_sheet/`

**Description.** The repo uses clasp (`apps-scripts/leads_sheet/.clasp.json` is committed), but `.gitignore` has no entry for `.clasprc.json` — `git check-ignore .clasprc.json` returns NOT IGNORED. clasp writes `~/.clasprc.json` by default (outside the repo), but `clasp login --creds` and similar flows can produce a **project-local** `.clasprc.json` containing a long-lived OAuth refresh token + client_id/secret for the owner of the Apps Script and bound Sheet. The file is **not present today** (clean tree verified), so this is a latent landmine, not a live leak.

**Impact.** *If* ever committed to the public repo, the refresh token would grant persistent access to the owner's clasp scopes (Apps Script project + Drive), allowing an attacker to modify `doPost`, exfiltrate/alter the Leads Sheet (all collected PII), or redirect notifications. The conditional (a contributor generating a local creds file **and** running `git add .` **and** pushing) is doing all the work — hence low — but the one-line preventive fix is worth taking now.

**Recommendation.** Add `.clasprc.json` and `**/.clasprc.json` to `.gitignore` now, before the file can ever exist.

---

#### [Low] `scriptId` committed in `.clasp.json` (project identifier, not a credential)
**File:** `apps-scripts/leads_sheet/.clasp.json:2`; `.gitignore` (no `.clasp.json` entry)
*Merged from three reports of the same identifier; consolidated here at the highest-assigned severity.*

**Description.** The Apps Script `scriptId` is committed and `.gitignore` does not exclude `.clasp.json`. The `scriptId` is a project identifier, not a credential — it cannot invoke, read (`clasp pull`), or modify (`clasp push`) the script without the owner's Google OAuth/editor access, and it is not the public `/exec` deployment URL. The bound Sheet ID is **not** exposed (the code uses `getActiveSpreadsheet()`).

**Impact.** Minor information disclosure / project fingerprinting only; no access is gained from the `scriptId` alone, and it marginally aids targeting only if a separate credential is leaked.

**Recommendation.** Optional hygiene: add `.clasp.json` to `.gitignore` (or use a `.clasp.local.json` pattern) to keep the project id out of the public repo. Rely on the `/exec` URL + server-side controls for actual security, not on hiding identifiers.

---

### Info

#### [Info] JSON-LD `set:html` sinks — confirmed safe today; harden against future regression
**File:** `src/layouts/BaseLayout.astro:91-94`; `src/pages/index.astro:16-34`; `src/pages/guides/*.astro:10-18`

**Description.** `BaseLayout` emits Organization and per-page JSON-LD via `set:html={JSON.stringify(...)}`, which bypasses Astro's HTML escaping. Every input was traced — `SITE_NAME`/`URL`/`DESCRIPTION`/`EMAIL`/`PHONE`/`AREA_SERVED` from `site.ts` plus each guide's hardcoded headline/description/path — and all are compile-time string literals from no runtime/user source, so there is **no live injection**. The latent risk: if a dynamic value (CMS field, query param, content-collection field) is ever threaded in, `JSON.stringify` alone does not neutralize `</script>` inside a string value.

**Impact.** None today. Latent stored-XSS-style breakout risk only if a dynamic value is later added without escaping.

**Recommendation.** Make the sink safe by construction: replace `JSON.stringify(obj)` with `JSON.stringify(obj).replace(/</g, '\\u003c')` in `BaseLayout.astro` (lines 91 and 93). Zero behavior change for valid JSON-LD; removes the footgun for future contributors.

---

#### [Info] Lead PII transmitted via fire-and-forget no-cors fetch with silently swallowed failures
**File:** `src/components/InquiryForm.astro:185-203`

**Description.** When a real endpoint is configured, the form POSTs with `mode:'no-cors'` and a `.catch(()=>{})` that swallows all errors, then unconditionally shows the success state — even though the opaque response cannot be read by design. The contact-variant success copy (line 103) asserts the details were "logged and emailed," shown even on network failure or an Apps Script exception.

**Impact.** A reliability/trust defect, **not** a security issue (no confidentiality/integrity/auth/abuse impact; PII goes over HTTPS to the org's own endpoint). Silent lead loss: a dropped submission still tells the user it succeeded, with no operator signal. Currently dormant (endpoint is a placeholder).

**Recommendation.** Either soften the copy ("We'll be in touch" without claiming it was logged/emailed), or add CORS headers to the Apps Script (`ContentService` + `doOptions` scoped to the site origin) and use a real `cors` fetch to confirm the `ok` body before showing success and surface an error otherwise. Belongs on the reliability/QA backlog.

---

#### [Info] Client-only validation and honeypot are fully bypassable (defense-in-depth note)
**File:** `src/components/InquiryForm.astro:176-181`; server side at `apps-scripts/leads_sheet/Code.js:29-34`

**Description.** Required-field validation (`reportValidity`) and the honeypot drop happen in the browser and are trivially bypassed by a direct POST. This is expected for a static site and is partially mirrored server-side (the Apps Script re-checks the honeypot and a minimal name+contact requirement). Email/phone *format* is enforced only client-side; the server stores whatever is sent.

**Impact.** None beyond the `doPost` abuse finding already covers; garbage/unvalidated data can reach the sheet/email.

**Recommendation.** Keep client validation for UX; make `doPost` the authoritative validator (format checks, length caps) and abuse-prevention point. No client-side change needed for security.

---

#### [Info] `doGet` discloses endpoint existence; `doPost` catch logs full exceptions server-side
**File:** `apps-scripts/leads_sheet/Code.js:74-76` (doGet), `:67-70` (catch/console.error)

**Description.** `doGet` is read-only (no state change — confirms no CSRF-via-GET concern) but returns a banner ("noprofits.org lead endpoint is live.") confirming the endpoint to a prober. The `doPost` catch logs the full exception to Stackdriver and returns a generic `'error'` to the caller (good — no sensitive detail leaks). Because the client fetch is `no-cors`, these bodies are read only by direct probers anyway.

**Impact.** Negligible — confirms endpoint existence to someone who already has the `/exec` URL. No sensitive data leaked to clients.

**Recommendation.** Optionally have `doGet` return an empty/neutral response. Keep exception details server-side only (already the case). No CSRF action needed.

---

#### [Info] No concurrency control on the deploy workflow
**File:** `.github/workflows/deploy.yml:31-34`

**Description.** The deploy job defines no `concurrency` group. Rapid successive merges to `main` (or a push plus a manual `workflow_dispatch`) can run overlapping `firebase deploy` jobs with no cancel-in-progress.

**Impact.** A release-integrity/consistency concern, not security: two concurrent deploys could interleave so an older build overwrites a newer one (self-heals on the next push; Firebase releases are atomic).

**Recommendation.** Add `concurrency: { group: deploy-hosting, cancel-in-progress: true }` at the job or workflow level.

---

#### [Info] Internal address `peter@noprofits.org` hardcoded in committed `Code.js`
**File:** `apps-scripts/leads_sheet/Code.js:8,21`

**Description.** `NOTIFY_TO = 'peter@noprofits.org'` (and a deploy comment naming the owner) is committed in a public repo. The public-facing contact email (`hello@noprofits.org`) and phone are intentionally public in `site.ts`; `peter@` is an internal routing address that becomes the documented target of the lead/abuse channel.

**Impact.** Low/info: discloses the internal recipient, making it the precise target for the email-flooding vector and for spear-phishing. Not a credential, and the flooding vector targets the form endpoint regardless of whether the address is known.

**Recommendation.** Acceptable to keep, but prefer moving the recipient to a Script Property (`PropertiesService`) rather than source, and prefer a role alias (e.g. `leads@noprofits.org`) over a personal mailbox. Pair with the `doPost` rate-limit fix.

---

#### [Info] Project identifiers committed (Firebase project id, scriptId) — non-secret
**File:** `.firebaserc:3` (`noprofits-web`), `apps-scripts/leads_sheet/.clasp.json:2` (scriptId)

**Description.** The Firebase project id and Apps Script `scriptId` are committed. These are identifiers, not credentials — the WIF setup is genuinely keyless (no service-account JSON in the repo; auth flows through `google-github-actions/auth` via non-secret `vars.GCP_WIF_PROVIDER` / `vars.GCP_DEPLOY_SA`). `.gitignore` correctly excludes `.env`, `.env.production`, `node_modules`, `dist`, and debug logs, and a grep found no committed secrets/keys/`.env` files. (The project id is trivially derivable from the live hosting domain anyway.)

**Impact.** None directly. Disclosure matters only combined with a separate misconfiguration (e.g. an overly permissive IAM binding or a publicly writable resource).

**Recommendation.** No action required. Confirm project-level GCP IAM grants no broad/public roles and that the `/exec` URL is the only intentionally public surface. Keep `.env` out of git (already enforced).

---

## What's Already Done Well

- **Keyless CI/CD via Workload Identity Federation** — no long-lived service-account JSON key in the repo; auth flows through `google-github-actions/auth` with short-lived federated tokens, and the deploy SA is scoped to `roles/firebasehosting.admin` on a single project.
- **Lockfile-pinned site dependencies** — the build uses `npm ci` against `package-lock.json`.
- **Demo-mode endpoint guard** — `FORM_ENDPOINT` defaults to a placeholder and `isRealEndpoint` keeps the form inert until a real `/exec` URL is wired, so no live abuse surface exists pre-launch.
- **JSON-LD `set:html` sinks fed only by static, build-time constants** — no user-controlled data reaches any HTML sink, so there is no live injection on a static, request-context-free site.
- **Honest `no-cors` fetch** — the client correctly does not pretend to read an opaque cross-origin response (the only gap is UX copy, not a security mistake).
- **Honeypot as a cheap first-layer bot filter**, mirrored client- and server-side.
- **Good server-side error hygiene** — `doPost` logs full exceptions to Stackdriver while returning only a generic `'error'` to the caller; no sensitive detail leaks to clients.
- **No secrets in the repo** — `.gitignore` excludes `.env*`, `node_modules`, `dist`, and debug logs; only non-secret project identifiers are committed.
- **`doGet` is read-only** — no state mutation, so no CSRF-via-GET concern.

---

## Pre-Launch Checklist

Ordered by severity. Items marked **(launch-blocking)** should be completed before the form endpoint is enabled / the site goes live.

> **Post-review update:** `Code.js` has since been updated to implement the
> per-minute rate limit, per-field length caps, server-side email validation,
> formula neutralization, and the daily email cap — so the corresponding
> Medium/Low items below are largely addressed in source (verify on deploy). The
> remaining launch-blocker is the **privacy policy**. A CAPTCHA is **not**
> launch-blocking (see note below).

**Medium — address before enabling the live form / launch:**

- [ ] **(launch-blocking)** Add server-side **rate limiting** to `doPost` (`CacheService`/`PropertiesService` per-minute counter + daily email cap with digest fallback so leads are never silently dropped).
- [ ] **(deferred — NOT launch-blocking)** **CAPTCHA is optional.** With honeypot + rate limit + daily email cap + neutralization in place, a CAPTCHA guards only a small residual and risks excluding legitimate low-tech nonprofit users (see the CAPTCHA operator note under the endpoint-abuse finding). Add one only if spam is actually observed; prefer Cloudflare Turnstile. A `verifyCaptcha_()` stub is already wired in `Code.js`.
- [ ] **(launch-blocking)** Neutralize **CSV/formula injection** — apostrophe-prefix any field starting with `= + - @` / tab / CR on every attacker-controlled field before `appendRow`.
- [ ] **(launch-blocking)** Publish a **privacy policy** page (collected data, purpose, storage = Google Sheet, retention window, deletion request path, contact); link it from the footer; add a one-line consent notice beneath **both** forms; document a Leads-sheet retention/deletion process.
- [ ] Keep the honeypot, but treat it as one layer only (covered by the rate-limit + CAPTCHA work above).

**Low — complete before or shortly after launch:**

- [ ] Add **HTTP security headers** to `firebase.json` (`Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options`/`frame-ancestors 'none'`, `Permissions-Policy`). Ship the non-CSP headers immediately; for CSP, build first and use per-script `sha256` hashes for the inline scripts (do **not** use `script-src 'self'`).
- [ ] **Self-host the two Google Font families** (drop `fonts.googleapis.com`/`fonts.gstatic.com`) for privacy and to tighten CSP to `default-src 'self'`.
- [ ] Add **server-side validation** in `doPost`: strict email-format regex (treat invalid as "no email," require phone) and use the validated value for `replyTo` (omit on failure); strip newlines/control chars from `name`/`organization` before building the subject.
- [ ] Add **per-field length caps** server-side before `appendRow`/`sendEmail` (e.g. name/org/email/phone ≤ 200, address ≤ 500, message ≤ 5000).
- [ ] **Pin GitHub Actions to full commit SHAs** (with version comments) and enable Dependabot for `github-actions` — prioritize `google-github-actions/auth`.
- [ ] **Pin `firebase-tools`** to an exact version, or add it as a lockfile-covered `devDependency` invoked via `npx`.
- [ ] **Pin the WIF/deploy trust to `main`** — add `assertion.ref == 'refs/heads/main'` and a `repository_owner` condition to the provider, and/or use a GitHub Environment with required reviewers + branch restriction; restrict who can run `workflow_dispatch`.
- [ ] **Scope `Cache-Control: immutable`** to `/_astro/**` only; give root `public/` assets (`favicon.svg`, `og-image.*`) a shorter `max-age` + `must-revalidate`.
- [ ] Add **`.clasprc.json`** and **`**/.clasprc.json`** to `.gitignore` now (preventive, before the file can ever exist).
- [ ] Optionally add **`.clasp.json`** to `.gitignore` to keep the `scriptId` out of the public tree.

**Info — optional hardening / hygiene:**

- [ ] Harden the JSON-LD sink by construction: `JSON.stringify(obj).replace(/</g, '\\u003c')` in `BaseLayout.astro` (lines 91, 93).
- [ ] Fix the form success-copy reliability gap: soften the copy, or add CORS/`doOptions` to the Apps Script and confirm the `ok` body before showing success.
- [ ] Add `concurrency: { group: deploy-hosting, cancel-in-progress: true }` to the deploy workflow.
- [ ] Move `NOTIFY_TO` to a Script Property and prefer a role alias (`leads@noprofits.org`) over a personal mailbox.
- [ ] Optionally neutralize the `doGet` banner; confirm GCP IAM grants no broad/public roles and that `/exec` is the only intentionally public surface.

**Considered enhancement — submitter acknowledgement email ("we got your request"):**

Two designs were considered. **The manual, human-in-the-loop design is recommended** — it delivers the UX benefit with essentially none of the abuse surface.

- [x] **Recommended: manual send from a Sheet custom menu** (implemented in
  `apps-scripts/leads_sheet/Outreach.js`). The operator selects a lead row,
  vets the requestor (web presence, IRS 990s, etc.), then fires a canned
  acknowledgement from a **Lead Outreach** menu. Because a human triggers every
  send, to the address already captured in the row, there is **no open-relay /
  reflection / backscatter vector and no per-POST quota amplification** — the two
  problems that sink the automatic version below. Built-in safeguards: validates
  the row's email before sending, shows a preview + confirm dialog, sends with a
  `noprofits.org` from-name and `hello@noprofits.org` reply-to, and stamps a
  "Ack sent" marker so it isn't sent twice. New canned templates are added by
  appending one `.addItem(...)` line.

- [ ] *Rejected for launch: automatic auto-reply in `doPost`.* Sending the
  acknowledgement automatically from the form handler **turns the endpoint into a
  way to send mail to any address an attacker supplies** (open relay / reflection
  & backscatter) and adds a second `MailApp` send per submission that burns the
  daily quota twice as fast and can hurt sender reputation. If ever revisited, it
  would need: send only to the server-validated `email` (`EMAIL_RE`), its own
  separate daily cap under the rate limit, send-after-save, and a plain body. The
  manual design above avoids all of this, so the auto version is not worth the
  added surface.
