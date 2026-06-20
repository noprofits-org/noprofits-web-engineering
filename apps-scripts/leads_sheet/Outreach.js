/**
 * noprofits.org — manual lead outreach (sheet-bound Apps Script).
 *
 * Adds a "Lead Outreach" menu to the bound Leads spreadsheet. The operator
 * selects a lead row, reviews the requestor (current web presence, IRS 990s,
 * business practices), then fires a CANNED acknowledgement email from the menu.
 *
 * WHY MANUAL (not an auto-reply from doPost): a human triggers every send, to
 * the address already captured in the row — so this is NOT an open relay /
 * reflection / backscatter vector, and it does not add a per-submission MailApp
 * send that a bot flood could use to burn the daily quota.
 *
 * Lives in the same script project as Code.js (doPost). clasp pushes every .js
 * in the project; multiple files are fine.
 *
 * Leads sheet columns (set in Code.js):
 *   A Timestamp · B Name · C Organization · D Email · E Phone · F Address · G Message
 * We use column H as a "Status" marker so an acknowledgement isn't sent twice.
 */

var LEADS_SHEET = 'Leads';
var COL = { NAME: 2, ORG: 3, EMAIL: 4, STATUS: 8 }; // 1-based; STATUS = column H
var REPLY_TO = 'hello@noprofits.org';
var FROM_NAME = 'noprofits.org';
var EMAIL_RE = /^[^\s@'"]+@[^\s@'"]+\.[^\s@'"]+$/;

/** Simple trigger: builds the menu every time the spreadsheet is opened. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Lead Outreach')
    // Add more canned templates by duplicating this line with a new builder fn.
    .addItem('Send “We got your message” acknowledgement', 'sendAcknowledgement')
    .addToUi();
}

/**
 * Canned acknowledgement — "we received it, we're already vetting + mocking up,
 * we'll reach out soon." Edit the copy here; {name}/{org} are filled per row.
 */
function ackTemplate_(name, org) {
  var greeting = name ? ('Hi ' + name + ',') : 'Hi there,';
  return {
    subject: 'We got your message — noprofits.org',
    body: [
      greeting,
      '',
      'Thanks for reaching out to noprofits.org' +
        (org ? (' on behalf of ' + org) : '') + '. We received your request and ' +
        'we’re already on it — checking out your organization and ' +
        'starting a mockup for your site. We’ll reach out as soon as we can ' +
        'with next steps.',
      '',
      'If anything has changed in the meantime, just reply to this email.',
      '',
      '— The noprofits.org team',
      REPLY_TO + ' · 206-532-6395'
    ].join('\n')
  };
}

function sendAcknowledgement() {
  sendCanned_(ackTemplate_);
}

/**
 * Shared send path for any canned template: validates the active row, previews
 * the message, confirms, sends, and stamps a "Status" marker.
 * @param {function(string,string):{subject:string,body:string}} templateFn
 */
function sendCanned_(templateFn) {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();

  if (sheet.getName() !== LEADS_SHEET) {
    ui.alert('Switch to the "' + LEADS_SHEET + '" tab, then select a lead row.');
    return;
  }

  var row = sheet.getActiveRange().getRow();
  if (row < 2) {
    ui.alert('Select a lead row (not the header row).');
    return;
  }

  var email = String(sheet.getRange(row, COL.EMAIL).getValue() || '').trim();
  var name  = String(sheet.getRange(row, COL.NAME).getValue() || '').trim();
  var org   = String(sheet.getRange(row, COL.ORG).getValue() || '').trim();

  if (!EMAIL_RE.test(email)) {
    ui.alert('Row ' + row + ' has no valid email to send to (got: ' +
      (email || 'blank') + '). This lead may be phone-only.');
    return;
  }

  var existing = String(sheet.getRange(row, COL.STATUS).getValue() || '').trim();
  if (existing) {
    var again = ui.alert('Already marked: "' + existing + '". Send again?',
      ui.ButtonSet.YES_NO);
    if (again !== ui.Button.YES) return;
  }

  var msg = templateFn(name, org);

  // Preview + confirm before anything leaves the building.
  var ok = ui.alert('Send to ' + email + '?\n\nSubject: ' + msg.subject,
    msg.body, ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;

  MailApp.sendEmail({
    to: email,
    replyTo: REPLY_TO,
    name: FROM_NAME,
    subject: msg.subject,
    body: msg.body
  });

  sheet.getRange(row, COL.STATUS).setValue(
    'Ack sent ' + Utilities.formatDate(new Date(),
      ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm'));
  ui.alert('Sent to ' + email + '.');
}
