/**
 * noprofits.org — first-party analytics event logger (STANDALONE Apps Script).
 *
 * Receives anonymous, aggregate event beacons from the marketing site and
 * appends them to an "Events" tab in the SAME spreadsheet that holds the leads.
 * Deliberately a separate script from the lead handler so that high-volume,
 * low-criticality traffic events can never starve the quota of, or break, the
 * mission-critical lead pipeline (separate scripts = separate quota buckets and
 * blast radius).
 *
 * It is STANDALONE (not sheet-bound), so it opens the target spreadsheet by id
 * via SpreadsheetApp.openById(); the id lives in a Script Property, never in the
 * repo. Run `_setup()` once (after editing the two values) to populate them.
 *
 * Deploy:  Deploy ▸ New deployment ▸ Web app
 *          Execute as:        Me (peter@noprofits.org)
 *          Who has access:    Anyone
 * Then paste the resulting /exec URL into the PUBLIC_ANALYTICS_ENDPOINT repo
 * Variable (mirrors how PUBLIC_FORM_ENDPOINT works for the lead form).
 *
 * Script Properties (Project Settings ▸ Script Properties, or run _setup()):
 *   SHEET_ID    — id of the Leads spreadsheet (the long token in its URL).
 *   DASH_TOKEN  — a long random secret; doGet refuses to return data without it.
 *
 * What a beacon carries (all anonymous — NO name/email/message ever):
 *   t = event type   p = path   r = referrer HOST only   d = detail   s = session
 *
 * ABUSE CONTROLS (server-side — the client is untrusted):
 *   - event-type allowlist (unknown types are dropped)
 *   - coarse per-minute rate limit (CacheService) to blunt flooding
 *   - per-field length caps
 *   - spreadsheet formula-injection neutralization on every stored field
 */

var EVENTS_SHEET = 'Events';

// Event types the logger will record. Unknown types are silently ignored.
// pageview / form_submit / tel_click are wired today; form_start / form_view
// are accepted now so the funnel can be extended client-side with no redeploy.
var ALLOWED_TYPES = {
  pageview: 1,
  form_submit: 1,
  tel_click: 1,
  form_start: 1,
  form_view: 1
};

// --- Abuse-control tunables ---------------------------------------------------
var RATE_LIMIT_PER_MIN = 600;  // events/min across all callers; beyond this we
                               // drop quietly (analytics is non-critical)
var MAX = {                    // per-field length caps (chars)
  type: 40, path: 300, ref: 200, detail: 120, session: 64
};

function doPost(e) {
  try {
    var p = (e && e.parameter) || {};

    var type = clamp_(p.t, MAX.type);
    if (!ALLOWED_TYPES[type]) return ok_(); // unknown/garbage type — drop silently

    // Coarse per-minute flood guard, shared across callers. Best-effort
    // (CacheService is not strictly atomic); analytics is non-critical, so we
    // simply drop once over the cap rather than risk runaway quota use.
    var cache = CacheService.getScriptCache();
    var minuteKey = 'arl_' + Math.floor(Date.now() / 60000);
    var hits = Number(cache.get(minuteKey) || 0);
    cache.put(minuteKey, hits + 1, 120);
    if (hits >= RATE_LIMIT_PER_MIN) return ok_();

    var ss = SpreadsheetApp.openById(getSheetId_());
    var sheet = ss.getSheetByName(EVENTS_SHEET) || ss.insertSheet(EVENTS_SHEET);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Timestamp', 'Type', 'Path', 'Referrer', 'Detail', 'Session']);
    }

    // Neutralize formula-injection on EVERY attacker-controlled field so a
    // leading = + - @ (or tab/CR) can't become a live formula on open/export.
    sheet.appendRow([
      new Date(),
      neutralize_(type),
      neutralize_(clamp_(p.p, MAX.path)),
      neutralize_(clamp_(p.r, MAX.ref)),
      neutralize_(clamp_(p.d, MAX.detail)),
      neutralize_(clamp_(p.s, MAX.session))
    ]);

    return ok_();
  } catch (err) {
    console.error(err);
    return ContentService.createTextOutput('error');
  }
}

/**
 * Dashboard data endpoint — returns aggregated counts as JSON.
 *
 * Token-gated (fail-closed): without a matching ?token= it returns only an
 * "unauthorized" object, so the raw data is never world-readable even though
 * the web app is deployed "Anyone". Supports JSONP via ?callback= so a browser
 * dashboard on another origin can load it with a <script> tag (Apps Script
 * cannot set the CORS headers a cross-origin fetch() would need).
 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  var token = PropertiesService.getScriptProperties().getProperty('DASH_TOKEN');

  var payload;
  if (!token || p.token !== token) {
    payload = { error: 'unauthorized' };
  } else {
    payload = aggregate_();
  }

  var jsonStr = JSON.stringify(payload);
  if (p.callback) {
    // JSONP: only allow a sane callback identifier (defang injection).
    var cb = /^[A-Za-z_$][\w$.]*$/.test(p.callback) ? p.callback : 'callback';
    return ContentService
      .createTextOutput(cb + '(' + jsonStr + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(jsonStr)
    .setMimeType(ContentService.MimeType.JSON);
}

/** Roll the Events tab up into totals + per-day-per-type counts. */
function aggregate_() {
  var ss = SpreadsheetApp.openById(getSheetId_());
  var sheet = ss.getSheetByName(EVENTS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) {
    return { totals: {}, daily: [], generatedAt: new Date().toISOString() };
  }

  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues(); // Timestamp + Type
  var tz = Session.getScriptTimeZone();
  var totals = {};
  var byDay = {};

  rows.forEach(function (r) {
    var ts = r[0];
    var type = r[1];
    if (!type) return;
    totals[type] = (totals[type] || 0) + 1;
    var day = Utilities.formatDate(new Date(ts), tz, 'yyyy-MM-dd');
    if (!byDay[day]) byDay[day] = {};
    byDay[day][type] = (byDay[day][type] || 0) + 1;
  });

  var daily = Object.keys(byDay).sort().map(function (d) {
    var row = { date: d };
    Object.keys(byDay[d]).forEach(function (t) { row[t] = byDay[d][t]; });
    return row;
  });

  return { totals: totals, daily: daily, generatedAt: new Date().toISOString() };
}

/** Read the target spreadsheet id from Script Properties; fail loud if unset. */
function getSheetId_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) {
    throw new Error('SHEET_ID script property is not set — run _setup() or set it in Project Settings.');
  }
  return id;
}

/** Coerce to string and hard-cap length. */
function clamp_(v, max) {
  v = (v == null) ? '' : String(v);
  return v.length > max ? v.slice(0, max) : v;
}

/** Neutralize spreadsheet formula injection: apostrophe-prefix risky leads. */
function neutralize_(v) {
  v = (v == null) ? '' : String(v);
  return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
}

/** Visiting the /exec URL with no token returns {"error":"unauthorized"} via
 *  doGet — that also confirms the endpoint is live. */
function ok_() {
  return ContentService.createTextOutput('ok');
}

/**
 * ONE-TIME setup helper. Edit the two values below, run this function once from
 * the Apps Script editor (it'll prompt for authorization), then delete the
 * values again if you don't want them sitting in source. Setting them by hand
 * in Project Settings ▸ Script Properties works just as well.
 */
function _setup() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SHEET_ID', 'REPLACE_WITH_LEADS_SPREADSHEET_ID');
  props.setProperty('DASH_TOKEN', 'REPLACE_WITH_A_LONG_RANDOM_SECRET');
  Logger.log('Script properties set. Remember to clear the literals from _setup().');
}
