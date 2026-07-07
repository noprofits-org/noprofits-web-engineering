# Hosted site editor (visual CMS) — setup & security model

The visual site editor (`tools/site-editor`, also runnable locally via
`npm run edit`) has a hosted variant that lives on Firebase in this project:
a single Cloud Function (`functions/`) that serves the auth-gated editor UI
and a GitHub-backed save API. **Publishing is PR-gated**: saves commit to the
`cms/edits` branch and open a pull request into `main`; only a human merging
that PR publishes anything (the existing deploy workflow ships `main` to
Firebase Hosting).

```
editor signs in (Firebase Auth, allowlist)
   → edits a node, hits Save
   → Cloud Function splices text blocks, commits to cms/edits, opens/updates PR
   → content-pr.yml CI proves the diff is pure text + site still builds
   → you review & merge → deploy.yml ships main → live
```

## One-time setup (console + CLI)

1. **Blaze plan** — Cloud Functions require pay-as-you-go billing on the
   `noprofits-web` project. Expected cost at CMS usage volume: ~$0/mo
   (free tier: 2M invocations).
2. **Firebase Auth** — console ▸ Authentication ▸ enable the **Google**
   provider. After the first deploy, add the function's own domain
   (`cms-<hash>-uc.a.run.app`, printed by the deploy) to Authentication ▸
   Settings ▸ **Authorized domains**, or sign-in popups will be blocked.
3. **Web app config** — console ▸ Project settings ▸ Your apps ▸ add a Web
   app; copy the `apiKey` into `functions/.env` (see `functions/.env.example`;
   the apiKey is a public identifier, not a secret).
4. **GitHub token** — the token must belong to a **non-admin machine account**
   (`site-noprofits-org`, a write collaborator), NOT the repo-owner account:
   branch protection exempts admins, so an admin-owned token could push to
   `main` and defeat the PR gate. Use a **classic token with only the
   `public_repo` scope** — fine-grained PATs cannot be granted write on a
   repo owned by a different personal account (reads appear to "work" only
   because the repo is public). Store it:
   `firebase functions:secrets:set CMS_GITHUB_TOKEN`; re-deploy after any
   rotation (the function pins the secret version at deploy time). It never
   leaves Secret Manager; the browser never sees it.
5. **Allowlist** — set `EDITOR_ALLOWLIST` in `functions/.env` (comma-separated
   verified emails). Empty = nobody can edit (fail-closed).
6. **Branch protection on `main`** — GitHub repo settings: require a pull
   request with **1 approval** before merging (free only on public repos).
   This is what makes "PR-gated" real; combined with step 4 the CMS token
   physically cannot reach `main`.
7. **Org policy** — if the Google Cloud org enforces Domain Restricted
   Sharing (default on newer Workspace orgs), grant the project an exception
   so the function can be made publicly invokable
   (`iam.allowedPolicyMemberDomains` → `allowAll: true` on `noprofits-web`;
   needs `roles/orgpolicy.policyAdmin` at the org level). The build service
   account may also need `roles/cloudbuild.builds.builder`.
8. Deploy: `cd functions && npm install && npm run deploy`
   (syncs the engine, runs unit tests, deploys). The editor URL is the
   function URL; bookmark it.

## Security model — how a malicious editor (or stolen credential) is contained

Assume the worst at each layer; every layer below still has to fail before
malicious *code* reaches the live site.

| # | Vector | Control |
|---|--------|---------|
| 1 | Random visitor calls the API | Every `/api/*` call requires a valid Firebase ID token, verified server-side; email must be **verified** and on the allowlist. No cookies → CSRF inert; no CORS headers → cross-origin JS can't call it. |
| 2 | Authorized editor saves `<script>…` into copy | The engine entity-encodes `& < >` in every HTML-context block. It lands as visible text, not markup. (`tools/site-editor/security.test.mjs`, proven against a real `astro build`.) |
| 3 | Editor saves `{…}` — Astro evaluates braces in templates as **build-time JS** (RCE inside CI) | Braces are always encoded to `&#123;/&#125;` in HTML contexts. Rendered braces look identical; nothing evaluates. |
| 4 | Editor attacks an attribute (`" onmouseover="…`) or a component prop (`` ` ``/`${…}`) or a `set:html` payload (`"}…`) | Quotes are entity-encoded in attributes; backticks/`${` escaped in template-literal props; payload strings re-encoded via JSON escaping. Block structure is preserved by construction (tested). |
| 5 | Editor attacks SEO strings that flow into `<title>`/JSON-LD (`</script>` breakout) | Frontmatter string values get angle brackets written as `\u003c`/`\u003e` escapes inside the JS literal — same rendered text, breakout impossible wherever the string is used. |
| 6 | **Stolen/abused GitHub PAT** pushes arbitrary code to `cms/edits` directly | `content-pr.yml` re-derives the PR diff through the engine and **fails unless the diff is byte-for-byte reproducible as pure text-block edits** on routed pages only. A failing check is a loud signal: do not merge. The PAT itself is also contained: a classic `public_repo` token **without the `workflow` scope** (so it cannot push workflow-file changes), owned by a non-admin machine account whose only write access is this repo — it cannot bypass branch protection, touch settings, or reach any other private repo. (See setup step 4 for why it isn't fine-grained.) |
| 7 | Anything that slips past all of the above | A human still has to approve and merge the PR (branch protection), and the deploy credential (WIF) only exists for `main`. The `cms/edits` branch cannot deploy. |
| 8 | Editor UI itself (XSS in the admin page) | All dynamic content is inserted via `textContent`/`value` (never `innerHTML`); the page ships a strict CSP (hash-pinned inline script, `object-src 'none'`, `frame-ancestors 'none'`); Firebase SDK loaded only from `www.gstatic.com`. The public site's CSP/headers are untouched — the editor runs on its own origin. |
| 9 | Concurrent edits clobbering each other | Saves carry the file's blob SHA; GitHub rejects stale writes (409) and the UI says "reload". |
| 10 | DoS / junk floods | Function capped at 2 instances/60s timeout; payloads capped (≤200 edits, ≤20k chars each, ≤400k total); worst case is noisy commits on `cms/edits`, which never deploy. |

Residual risks, named honestly: (a) a malicious *allowlisted* editor can still
write misleading **text** — no encoder prevents lies; the PR review is the
control. (b) Whoever can approve PRs is the real trust anchor — protect that
account with 2FA. (c) The public repo means edits are public commits with the
editor's name; that's transparency, but tell editors first.

## Files

- `functions/index.js` — HTTPS entry: auth enforcement, admin UI serving, CSP
- `functions/cms-core.mjs` — graph/page/save logic (unit-tested, no Firebase deps)
- `functions/github.mjs` — minimal fetch-only GitHub client
- `functions/engine.mjs` — synced copy of `tools/site-editor/extract.mjs`
- `functions/admin.html` — the node-map editor UI + Firebase sign-in
- `scripts/verify-content-pr.mjs` + `.github/workflows/content-pr.yml` — CI gate
