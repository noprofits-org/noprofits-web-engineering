# Live analytics dashboard (standalone)

A **standalone** Apps Script web app that serves a live, read-only HTML dashboard
rendered fresh from the `Events` tab of the Leads spreadsheet on each load. Kept
separate from `../leads_sheet` on purpose: the lead/beacon endpoint must stay
deployed **"Anyone"** (anonymous visitors POST to it), while this dashboard is
gated **"Anyone with a Google account"** — two deployments, two access settings.

## Setup

1. **Script Property** (Project Settings ▸ Script Properties):
   - `SHEET_ID` — the Leads spreadsheet id (the long token in its URL). The tab
     name is hardcoded to `Events`.
2. `clasp push` (scriptId is already in `.clasp.json`).
3. **Deploy ▸ New deployment ▸ Web app**
   - Execute as: **Me** (the owner — so viewers never need sheet access)
   - Who has access: **Anyone with a Google account**
   (`appsscript.json` already encodes these as the deployment defaults:
   `executeAs: USER_DEPLOYING`, `access: ANYONE`.)
4. Copy the `/exec` URL into the site's **`PUBLIC_DASHBOARD_URL`** repo Variable.

## Notes

- **Near-live, not per-request hammering.** Each load reads a `CacheService`
  copy of the aggregate (≈2 min TTL), so a burst of visitors triggers at most one
  sheet scan per window. Bump `CACHE_TTL` in `Code.js` for fresher/cheaper.
- **No token.** Access control is the deployment setting, not a URL secret.
- **`ALLOWALL` X-Frame** is set so the page can be embedded in an on-domain
  `/stats` iframe later if desired.
- **Per-client reuse:** drop this script into a client's Workspace, point
  `SHEET_ID` at their sheet, and deploy "Anyone within <their domain>" for a
  private, sign-in-gated dashboard. Same code, different deployment access.
