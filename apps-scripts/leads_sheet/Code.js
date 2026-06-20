/**
 * noprofits.org — website inquiry handler (sheet-bound Apps Script).
 *
 * Receives form POSTs from the marketing site, drops bot submissions,
 * appends each lead to the "Leads" tab, and emails a notification.
 *
 * Deploy:  Deploy ▸ New deployment ▸ Web app
 *          Execute as:        Me (peter@noprofits.org)
 *          Who has access:    Anyone
 * Then paste the resulting /exec URL into FORM_ENDPOINT in the site repo.
 *
 * NOTE: this is the SHEET-BOUND version — it writes to the spreadsheet the
 * script is attached to via getActiveSpreadsheet(). If this script is actually
 * STANDALONE (not bound to the Leads sheet), swap to
 * SpreadsheetApp.openById('<SHEET_ID>') instead.
 *
 * Field names below MUST match the site form inputs:
 *   name · organization · email · phone · address · message · company(honeypot)
 */

var NOTIFY_TO  = 'peter@noprofits.org'; // where the alert email lands
var SHEET_NAME = 'Leads';

function doPost(e) {
  try {
    var p = (e && e.parameter) || {};

    // Honeypot — bots fill the hidden "company" field. Accept silently, drop.
    if (p.company) return ContentService.createTextOutput('ok');

    // Minimal validation — need a name and at least one way to reply.
    if (!p.name || !(p.email || p.phone)) {
      return ContentService.createTextOutput('ignored');
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Timestamp', 'Name', 'Organization', 'Email', 'Phone', 'Address', 'Message']);
    }
    sheet.appendRow([
      new Date(),
      p.name || '',
      p.organization || '',
      p.email || '',
      p.phone || '',
      p.address || '',
      p.message || ''
    ]);

    MailApp.sendEmail({
      to: NOTIFY_TO,
      replyTo: p.email || '',
      subject: 'New website inquiry — ' + (p.organization || p.name),
      body: [
        'Name:         ' + (p.name || ''),
        'Organization: ' + (p.organization || ''),
        'Email:        ' + (p.email || ''),
        'Phone:        ' + (p.phone || ''),
        'Address:      ' + (p.address || ''),
        '',
        (p.message || '')
      ].join('\n')
    });

    return ContentService.createTextOutput('ok');
  } catch (err) {
    console.error(err);
    return ContentService.createTextOutput('error');
  }
}

/** Optional sanity check — visiting the /exec URL in a browser returns this. */
function doGet() {
  return ContentService.createTextOutput('noprofits.org lead endpoint is live.');
}
