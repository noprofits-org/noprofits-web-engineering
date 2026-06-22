/**
 * noprofits.org — website inquiry handler (sheet-bound Apps Script).
 *
 * Receives form POSTs from the marketing site, drops bot submissions,
 * appends each lead to the "Leads" tab, and emails a notification.
 *
 * ALSO logs first-party, cookieless site analytics. A beacon POST that carries
 * an event type `t` (pageview / form_submit / tel_click) is recorded to a
 * separate "Events" tab in this same spreadsheet and returns early — it never
 * touches the lead or email path. A POST carrying the DASH_TOKEN (in the body,
 * never the URL) returns aggregated event counts as JSON for the public stats
 * dashboard; doGet is just a liveness check.
 *
 * QUOTA NOTE (POC): leads + analytics deliberately share ONE script and ONE
 * sheet here to keep setup dead simple. Apps Script quotas are per-project, so
 * on a higher-traffic site a flood of analytics events could burn the execution
 * quota and starve the mission-critical lead pipeline. If that ever becomes a
 * risk, split analytics back into its own standalone script (openById on this
 * sheet) so it gets an independent quota bucket and blast radius.
 *
 * Deploy:  Deploy ▸ New deployment ▸ Web app
 *          Execute as:        Me (peter@noprofits.org)
 *          Who has access:    Anyone
 * Then paste the resulting /exec URL into the PUBLIC_FORM_ENDPOINT repo Variable.
 *
 * NOTE: this is the SHEET-BOUND version — it writes to the spreadsheet the
 * script is attached to via getActiveSpreadsheet(). If this script is actually
 * STANDALONE (not bound to the Leads sheet), swap to
 * SpreadsheetApp.openById('<SHEET_ID>') instead.
 *
 * Field names below MUST match the site form inputs:
 *   name · organization · email · phone · address · message · np_hp(honeypot)
 *
 * ABUSE CONTROLS (all server-side — the client is untrusted):
 *   - honeypot drop ("np_hp" — named to avoid password-manager autofill)
 *   - coarse per-minute rate limit (CacheService) to blunt flooding
 *   - per-field length caps (storage/quota amplification guard)
 *   - server-side email-format validation (invalid email ⇒ treated as absent)
 *   - spreadsheet formula-injection neutralization on EVERY stored field
 *   - daily email cap: beyond the cap (or when rate-limited), the lead STILL
 *     lands in the sheet and only the notification email is suppressed — a flood
 *     can never exhaust the MailApp quota AND silently drop real leads.
 *   CAPTCHA (Turnstile/reCAPTCHA) is a planned fast-follow — see verifyCaptcha().
 */

var NOTIFY_TO  = 'peter@noprofits.org'; // where the alert email lands
var SHEET_NAME = 'Leads';

// --- Abuse-control tunables ---------------------------------------------------
var RATE_LIMIT_PER_MIN = 12;   // emails are suppressed beyond this many/min; the
                               // lead is still saved (never dropped)
var DAILY_EMAIL_CAP    = 60;   // notification emails/day; beyond this leads still
                               // save but emails pause (check the sheet directly)
var MAX = {                    // per-field length caps (chars)
  name: 200, organization: 200, email: 254, phone: 50, address: 500, message: 5000
};
var EMAIL_RE = /^[^\s@'"]+@[^\s@'"]+\.[^\s@'"]+$/;

// --- Analytics (same script + sheet as leads, for this POC) -------------------
var EVENTS_SHEET = 'Events';
// Event types recorded; unknown types are silently dropped. pageview /
// form_submit / tel_click are wired today; form_start / form_view are accepted
// now so the funnel can be extended client-side with no redeploy.
var ALLOWED_TYPES = { pageview: 1, form_submit: 1, tel_click: 1, form_start: 1, form_view: 1 };
var EVENT_RATE_LIMIT_PER_MIN = 600; // events/min across all callers; beyond this, drop quietly
var EVENT_MAX = { type: 40, path: 300, ref: 200, detail: 120, session: 64 };

function doPost(e) {
  try {
    var p = (e && e.parameter) || {};

    // Dashboard read path: a POST carrying the dashboard token (and no event
    // type) returns aggregated analytics JSON. The token travels in the POST
    // BODY, never the URL, so it can't leak via request-line/access logs.
    // Fail-closed: a wrong/missing token returns only {error:'unauthorized'}.
    if (p.token) {
      var dashToken = PropertiesService.getScriptProperties().getProperty('DASH_TOKEN');
      var out = (dashToken && p.token === dashToken) ? aggregateEvents_() : { error: 'unauthorized' };
      return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
    }

    // Analytics beacon path: any POST carrying an event type `t` is an anonymous,
    // aggregate analytics event — NOT a lead. Logged to the Events tab and
    // returned early so traffic events never reach the lead/email path.
    if (p.t) return logEvent_(p);

    // Honeypot — bots fill the hidden "np_hp" field. Accept silently, drop.
    // (Named np_hp, not "company"/"organization", so password managers don't
    // autofill it and false-flag a real visitor as a bot.)
    if (p.np_hp) return ContentService.createTextOutput('ok');

    // Coarse per-minute rate limit shared across all callers. Best-effort
    // (CacheService get/put is not strictly atomic). When tripped we still SAVE
    // the lead below and only suppress the notification email — never drop it.
    var cache = CacheService.getScriptCache();
    var minuteKey = 'rl_' + Math.floor(Date.now() / 60000);
    var hits = Number(cache.get(minuteKey) || 0);
    var throttled = hits >= RATE_LIMIT_PER_MIN;
    cache.put(minuteKey, hits + 1, 120);

    // Normalize + length-cap every field before anything touches the sheet/mail.
    var name    = clamp_(p.name,         MAX.name);
    var org     = clamp_(p.organization, MAX.organization);
    var email   = clamp_(p.email,        MAX.email);
    var phone   = clamp_(p.phone,        MAX.phone);
    var address = clamp_(p.address,      MAX.address);
    var message = clamp_(p.message,      MAX.message);

    // Server-side email validation: an invalid email is treated as "no email".
    var validEmail = EMAIL_RE.test(email) ? email : '';

    // Minimal validation — a lead with no name or no way to reply is unusable.
    if (!name || !(validEmail || phone)) {
      return ContentService.createTextOutput('ignored');
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Timestamp', 'Name', 'Organization', 'Email', 'Phone', 'Address', 'Message']);
    }
    // Always persist a usable lead. Neutralize formula-injection on EVERY
    // attacker-controlled field so a leading = + - @ (or tab/CR) can't become a
    // live formula on open/export.
    sheet.appendRow([
      new Date(),
      neutralize_(name),
      neutralize_(org),
      neutralize_(email),
      neutralize_(phone),
      neutralize_(address),
      neutralize_(message)
    ]);

    // Send the notification unless throttled or over the daily cap. In both
    // cases the lead is already saved above (so it is never lost); the day
    // counter only advances when an email actually goes out. Day key is in the
    // project timezone so the cap window aligns with the operator's local day.
    var props = PropertiesService.getScriptProperties();
    var dayKey = 'mail_' + Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd');
    var sentToday = Number(props.getProperty(dayKey) || 0);
    if (!throttled && sentToday < DAILY_EMAIL_CAP) {
      MailApp.sendEmail({
        to: NOTIFY_TO,
        replyTo: validEmail || NOTIFY_TO,   // never pass an unvalidated/raw value
        subject: 'New website inquiry — ' + oneLine_(org || name),
        body: [
          'Name:         ' + name,
          'Organization: ' + org,
          'Email:        ' + email,
          'Phone:        ' + phone,
          'Address:      ' + address,
          '',
          message
        ].join('\n')
      });
      props.setProperty(dayKey, String(sentToday + 1));
    }

    return ContentService.createTextOutput('ok');
  } catch (err) {
    console.error(err);
    return ContentService.createTextOutput('error');
  }
}

/**
 * Record one anonymous analytics event to the Events tab. Fail-soft by design:
 * unknown types, floods, and errors all just drop quietly — analytics is
 * non-critical and must never interfere with (or surface errors to) the page.
 *
 * A beacon carries: t = type · p = path · r = referrer HOST only · d = detail ·
 * s = per-tab session id. NO name/email/message ever — that's the lead path.
 */
function logEvent_(p) {
  try {
    var type = clamp_(p.t, EVENT_MAX.type);
    if (!ALLOWED_TYPES[type]) return ContentService.createTextOutput('ok'); // unknown — drop

    // Coarse per-minute flood guard. Own counter, separate from the lead rate
    // limit (rl_) so analytics traffic can't throttle the lead path or vice versa.
    var cache = CacheService.getScriptCache();
    var minuteKey = 'arl_' + Math.floor(Date.now() / 60000);
    var hits = Number(cache.get(minuteKey) || 0);
    cache.put(minuteKey, hits + 1, 120);
    if (hits >= EVENT_RATE_LIMIT_PER_MIN) return ContentService.createTextOutput('ok');

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(EVENTS_SHEET) || ss.insertSheet(EVENTS_SHEET);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Timestamp', 'Type', 'Path', 'Referrer', 'Detail', 'Session']);
    }
    // Neutralize formula-injection on EVERY attacker-controlled field so a
    // leading = + - @ (or tab/CR) can't become a live formula on open/export.
    sheet.appendRow([
      new Date(),
      neutralize_(type),
      neutralize_(clamp_(p.p, EVENT_MAX.path)),
      neutralize_(clamp_(p.r, EVENT_MAX.ref)),
      neutralize_(clamp_(p.d, EVENT_MAX.detail)),
      neutralize_(clamp_(p.s, EVENT_MAX.session))
    ]);
    return ContentService.createTextOutput('ok');
  } catch (err) {
    console.error(err);
    return ContentService.createTextOutput('ok'); // never surface analytics errors
  }
}

/**
 * Roll the Events tab up into the shape the dashboard consumes:
 *   totals    — { pageview, form_submit, tel_click, visits }
 *   daily     — [{ date, pageview, form_submit, tel_click, visits }] (chronological)
 *   referrers — [{ host, count }] top sources by pageview (blank/internal excluded)
 * "visits" = distinct non-empty session ids (a sessionStorage tab id), so it
 * approximates unique visits without any cookie or cross-site identifier.
 */
function aggregateEvents_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(EVENTS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) {
    return { totals: { pageview: 0, form_submit: 0, tel_click: 0, visits: 0 },
             daily: [], referrers: [], generatedAt: new Date().toISOString(), source: 'live' };
  }
  // Columns: 1 Timestamp · 2 Type · 4 Referrer · 6 Session.
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
  var tz = Session.getScriptTimeZone();
  var totals = { pageview: 0, form_submit: 0, tel_click: 0, visits: 0 };
  var byDay = {};            // date -> { pageview, form_submit, tel_click, sessions:{} }
  var allSessions = {};      // distinct sessions overall
  var refCounts = {};        // referrer host -> pageview count

  rows.forEach(function (r) {
    var type = r[1];
    if (!type) return;
    var ref = r[3];
    var session = r[5];
    if (totals[type] === undefined) totals[type] = 0;
    totals[type]++;

    var day = Utilities.formatDate(new Date(r[0]), tz, 'yyyy-MM-dd');
    var d = byDay[day] || (byDay[day] = { pageview: 0, form_submit: 0, tel_click: 0, sessions: {} });
    if (d[type] === undefined) d[type] = 0;
    d[type]++;

    if (session) { d.sessions[session] = 1; allSessions[session] = 1; }
    if (type === 'pageview' && ref) { refCounts[ref] = (refCounts[ref] || 0) + 1; }
  });

  totals.visits = Object.keys(allSessions).length;

  var daily = Object.keys(byDay).sort().map(function (day) {
    var d = byDay[day];
    return { date: day, pageview: d.pageview || 0, form_submit: d.form_submit || 0,
             tel_click: d.tel_click || 0, visits: Object.keys(d.sessions).length };
  });

  var referrers = Object.keys(refCounts)
    .map(function (h) { return { host: h, count: refCounts[h] }; })
    .sort(function (a, b) { return b.count - a.count; })
    .slice(0, 8);

  return { totals: totals, daily: daily, referrers: referrers,
           generatedAt: new Date().toISOString(), source: 'live' };
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

/** Strip CR/LF/control chars for safe interpolation into the email subject. */
function oneLine_(v) {
  return String(v == null ? '' : v).replace(/[\r\n\t\x00-\x1f]+/g, ' ').trim();
}

/**
 * CAPTCHA verification — planned fast-follow, not yet wired.
 * When a Turnstile/reCAPTCHA site+secret key exists, verify the client token
 * here via UrlFetchApp BEFORE any appendRow/sendEmail, and call it at the top
 * of doPost (after the honeypot). Left as a no-op stub so the contract is clear.
 */
// function verifyCaptcha_(token) {
//   var secret = PropertiesService.getScriptProperties().getProperty('CAPTCHA_SECRET');
//   if (!secret) return true; // not configured ⇒ skip (honeypot + rate limit only)
//   var res = UrlFetchApp.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
//     method: 'post',
//     payload: { secret: secret, response: token || '' },
//     muteHttpExceptions: true
//   });
//   return !!(JSON.parse(res.getContentText()) || {}).success;
// }

/**
 * Liveness check — visiting the /exec URL in a browser returns this. The
 * analytics dashboard is read via POST (token in the body), NOT GET, so the
 * secret never appears in a URL/query string. DASH_TOKEN lives in Project
 * Settings ▸ Script Properties (a long random secret).
 */
function doGet() {
  return ContentService.createTextOutput('noprofits.org endpoint is live.');
}
