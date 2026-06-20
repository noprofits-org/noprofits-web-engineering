/**
 * noprofits.org — website inquiry handler (sheet-bound Apps Script).
 *
 * Receives form POSTs from the marketing site, drops bot submissions,
 * appends each lead to the "Leads" tab, and emails a notification.
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

function doPost(e) {
  try {
    var p = (e && e.parameter) || {};

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

/** Optional sanity check — visiting the /exec URL in a browser returns this. */
function doGet() {
  return ContentService.createTextOutput('noprofits.org lead endpoint is live.');
}
