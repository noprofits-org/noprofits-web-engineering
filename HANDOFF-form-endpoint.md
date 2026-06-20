# Handoff note — FORM_ENDPOINT (/exec URL): inject at build time, don't hardcode

**For:** the punch-list session (owns `src/data/site.ts` + `.github/workflows/deploy.yml`)
**From:** security-review session
**Status:** decision made, NOT yet implemented (left to you to avoid collisions)

## Decision

Do **not** hardcode the Apps Script `/exec` URL in `site.ts`. Inject it at build
time from a GitHub Actions **variable** (`PUBLIC_FORM_ENDPOINT`).

## Why (and why "variable", not "secret")

The `/exec` URL **cannot be secret** — the form POSTs from the visitor's browser,
so the URL must ship in the client bundle and is readable on the live site by
anyone. This is *not* about protecting a credential. The benefit is narrower but
real:

- Keeps it out of the **public repo, forks, and git history** — GitHub is scraped
  for Apps Script `/exec` URLs by spam tools; this closes that harvest path.
- Forks/fork-PRs don't receive repo variables, so the repo can stay public.
- Easy **rotation**: redeploy the script for a new URL, update one variable, no
  git-history surgery.

Use a **variable**, not a secret — matches the existing `vars.GCP_*` pattern in
`deploy.yml` (already classified "non-secret identifiers"). Calling a
public-on-the-site value "secret" invites false confidence. The real defense
against a leaked URL is the server-side abuse controls already in `Code.js`
(rate limit, daily cap, validation, neutralization); URL exposure-reduction is
belt-and-suspenders on top of that.

Note: Astro requires the `PUBLIC_` prefix to expose a value to client code — Vite
is literally flagging it as browser-exposed, confirming it isn't secret.

## Changes to make

**`src/data/site.ts`** — replace the hardcoded placeholder:

```ts
export const FORM_ENDPOINT =
  import.meta.env.PUBLIC_FORM_ENDPOINT ?? '[CONFIRM: Apps Script /exec URL]';
```

`isRealEndpoint` stays as-is — `startsWith('https://script.google.com')` keeps the
form in demo mode whenever the env var is unset (local dev, forks).

**`.github/workflows/deploy.yml`** — feed it to the build step:

```yaml
- run: npm run build
  env:
    PUBLIC_FORM_ENDPOINT: ${{ vars.PUBLIC_FORM_ENDPOINT }}
```

**GitHub UI** — Settings ▸ Secrets and variables ▸ Actions ▸ **Variables** ▸ add
`PUBLIC_FORM_ENDPOINT` = the deployed `/exec` URL.

**Local dev** — put it in a gitignored `.env` (`.gitignore` already covers
`.env*`), or leave unset to stay in demo mode.

## Out of scope

A server-side proxy (Cloudflare Worker / Firebase Function) is the only way to
truly hide the endpoint — overkill here; it just relocates the public endpoint
and still needs the same abuse controls. Skip it.
