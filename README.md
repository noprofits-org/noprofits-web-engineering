# noprofits-web-engineering
Marketing site for noprofits.org free web design services (POC) — Firebase Hosting (Spark), Apps Script lead form

Form acknowledgment review and deployment
------------------------------------------

The forms use a browser POST to `PUBLIC_FORM_ENDPOINT`. Apps Script returns an
HTML acknowledgment after the Sheet append and flush succeed. Notification
failure does not change a saved result. Invalid input and honeypot submissions
are rejected; write/flush errors report uncertainty and offer direct contact.
No submitted fields are rendered in the response or put in URLs.

Local checks:

```sh
node --test scripts/leads-sheet.test.mjs
node tools/site-editor/security.test.mjs
node --check apps-scripts/leads_sheet/Code.js
ALLOW_PLACEHOLDER_ENDPOINT=true npm run build
```

Deployment procedure (requires Peter's authorization and correct clasp account):

- Confirm clasp authentication as the existing script owner. From
  `apps-scripts/leads_sheet`, run `clasp deployments` and identify the deployment
  matching the existing `PUBLIC_FORM_ENDPOINT` repository variable.
- Before pushing, pull the remote project into a temporary directory and compare
  it with this project's `Code.js`, `Outreach.js`, and `appsscript.json`. Reconcile
  remote-only changes; do not overwrite them. Keep the current version available
  for rollback. `clasp push` uploads the entire script project, not just Code.js.
- From `apps-scripts/leads_sheet`, run `clasp push` only after authorization.
  This updates source, not the versioned public web app.
- In Apps Script: Deploy → Manage deployments → select the existing web app →
  Edit → Version: New version → description: “Truthful inquiry acknowledgment” →
  Deploy. Keep Execute as Me and access Anyone. Updating the existing deployment
  preserves its `/exec` URL; do not create a replacement deployment.
- After reviewing the site changes, merge the feature PR only when site deployment
  is authorized. `.github/workflows/deploy.yml` automatically builds and deploys
  Firebase Hosting on main. It uses the existing endpoint variable and regenerates
  CSP hashes. No Functions or billing setup is needed.
- Coordinate a disposable inquiry and cleanup with Peter before the live browser
  test. Submit both form variants, verify the matching Leads row and notification
  separately, inspect the rendered acknowledgment and URL, then exercise refresh,
  Back, and a repeated POST while watching the Sheet for duplicates. Test both
  desktop and mobile against Google's actual HTML-service wrapper. Remove only
  the agreed test records/messages after verification.

Limitations: Apps Script's HTML service uses Google's sandboxed page wrapper;
platform outages/quota exhaustion may produce Google's own error page before
our handler runs. Recent identical inquiries share a digest in the existing
cache under a script lock. Cache eviction or expiry allows duplicates; this is
best-effort retry protection, not durable idempotency. An uncertain write should
be checked before retrying. The former client `form_submit` beacon was removed
because it counted sending as success; pageview and other analytics are unchanged.
The live refresh/back behavior, Sheet persistence, and email delivery remain
unverified until the authorized deployment test.

GWC can reuse the same native POST → server validation → Sheet write/flush →
static HTML response pattern, with notification handled after persistence.
Configure the Astro form action and Hosting CSP for the Apps Script endpoint;
keep personal data in the POST body and adapt the static branding/contact links.
This requires an Apps Script/Google Sheet account and inherits its quotas, but
adds no subscription, dependency, or Firebase backend.
