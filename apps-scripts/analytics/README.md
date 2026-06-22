# Analytics event logger

A **standalone** Apps Script web app that records anonymous, aggregate site
events to an `Events` tab in the same spreadsheet that holds the leads. Kept
separate from `../leads_sheet` on purpose: traffic events are high-volume and
non-critical, so they get their own quota bucket and can never break or starve
the mission-critical lead pipeline.

## What it stores

One row per event, no PII ever:

| Timestamp | Type | Path | Referrer | Detail | Session |
|-----------|------|------|----------|--------|---------|

- **Type** — `pageview`, `form_submit`, `tel_click` (today); `form_start`,
  `form_view` are accepted too, ready for client-side funnel extensions.
- **Referrer** — the referring site's *host only* (e.g. `google.com`), never a
  full URL, and blank for internal navigation.
- **Session** — a random per-browser-tab id from `sessionStorage` (not a
  cookie; cleared when the tab closes). Lets you tell pageviews from visits
  without persistent tracking.

## First-time setup

1. Create a new **standalone** Apps Script project (script.google.com → New
   project), or `clasp create --type standalone`.
2. Put its script id into `.clasp.json` (replacing the placeholder), then
   `clasp push`.
3. Set two **Script Properties** (Project Settings ▸ Script Properties), or edit
   and run `_setup()` once:
   - `SHEET_ID` — the long token from the Leads spreadsheet URL.
   - `DASH_TOKEN` — a long random secret; the dashboard endpoint refuses to
     return data without it.
4. **Deploy ▸ New deployment ▸ Web app** — Execute as **Me**, Who has access
   **Anyone**.
5. Copy the `/exec` URL into the **`PUBLIC_ANALYTICS_ENDPOINT`** repo Variable
   (Settings ▸ Secrets and variables ▸ Actions ▸ Variables). The site reads it
   at build time exactly like `PUBLIC_FORM_ENDPOINT`; if it is unset the site
   simply records nothing (no error, no build failure).

## Dashboard data

`GET <exec-url>?token=<DASH_TOKEN>` returns aggregated JSON:

```json
{ "totals": { "pageview": 1280, "form_submit": 14, "tel_click": 9 },
  "daily":  [ { "date": "2026-06-22", "pageview": 53, "form_submit": 1 } ],
  "generatedAt": "2026-06-22T18:00:00.000Z" }
```

Without a matching `token` it returns `{"error":"unauthorized"}` (fail-closed),
so the data is never world-readable even though the app is deployed "Anyone".

For a browser dashboard on another origin, add `&callback=fn` for JSONP —
Apps Script can't set the CORS headers a cross-origin `fetch()` needs, so load
it via a `<script>` tag or fetch it server-side. To start without writing any
dashboard, point **Looker Studio** straight at the `Events` tab.
