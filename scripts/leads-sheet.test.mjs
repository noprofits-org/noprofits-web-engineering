import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { test } from 'node:test';

const source = readFileSync('apps-scripts/leads_sheet/Code.js', 'utf8');
function handler(options = {}) {
  const rows = [], mail = [], cache = new Map(), props = new Map();
  const output = (html) => ({ html, setTitle() { return this; }, addMetaTag(name, value) { this[name] = value; return this; }, setMimeType() { return this; } });
  const sheet = { getLastRow: () => rows.length, appendRow(row) { if (options.writeFailure) throw Error('write'); rows.push(row); } };
  const context = vm.createContext({ console: { error() {} }, Date,
    ContentService: { createTextOutput: output, MimeType: { JSON: 'json' } },
    HtmlService: { createHtmlOutput: output },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: key => cache.get(key), put: (key, value) => cache.set(key, value) }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet }), flush() { if (options.flushFailure) throw Error('flush'); } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => options.cap ? '60' : props.get(key), setProperty: (key, value) => props.set(key, value) }) },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, computeDigest: (_, value) => createHash('sha256').update(value).digest(), base64EncodeWebSafe: value => value.toString('base64url'), formatDate: () => 'test-day' },
    MailApp: { sendEmail(value) { if (options.mailFailure) throw Error('mail'); mail.push(value); } }
  });
  vm.runInContext(source, context);
  return { rows, mail, cache, post: parameter => context.doPost({ parameter }), page: outcome => context.inquiryPage_(outcome) };
}
const input = { name: 'Private Visitor', email: 'private@example.org', organization: '=organization', message: '=private message' };
test('accepted lead saves safely before acknowledging; no personal data in HTML', () => {
  const h = handler(), page = h.post(input);
  assert.match(page.html, /your inquiry is saved/);
  assert.equal(h.rows.length, 2); assert.equal(h.mail.length, 1);
  assert.equal(h.rows[1][2], "'=organization"); assert.equal(h.rows[1][6], "'=private message");
  for (const value of Object.values(input)) assert.ok(!page.html.includes(value));
  assert.equal(page.viewport, 'width=device-width, initial-scale=1');
});
test('invalid and spam submissions never claim a save', () => {
  for (const fields of [{ name: 'Name', email: 'bad' }, { ...input, np_hp: 'bot' }]) {
    const h = handler(), page = h.post(fields);
    assert.doesNotMatch(page.html, /your inquiry is saved/); assert.equal(h.rows.length, 0); assert.equal(h.mail.length, 0);
  }
});
test('write and flush failures acknowledge uncertainty without success', () => {
  for (const options of [{ writeFailure: true }, { flushFailure: true }]) {
    const h = handler(options);
    assert.match(h.post(input).html, /could not confirm/); assert.equal(h.mail.length, 0);
  }
});
test('notification failure or cap leaves a saved acknowledgment', () => {
  for (const options of [{ mailFailure: true }, { cap: true }]) {
    const h = handler(options);
    assert.match(h.post(input).html, /your inquiry is saved/); assert.equal(h.rows.length, 2); assert.equal(h.mail.length, 0);
  }
});
test('recent identical POST saves and notifies once; cache eviction permits retry', () => {
  const h = handler(); h.post(input);
  assert.match(h.post(input).html, /your inquiry is saved/); assert.equal(h.rows.length, 2); assert.equal(h.mail.length, 1);
  h.cache.clear(); h.post(input); assert.equal(h.rows.length, 3);
});
if (process.env.LEAD_PAGE_PREVIEW) {
  mkdirSync(process.env.LEAD_PAGE_PREVIEW, { recursive: true });
  for (const outcome of ['saved', 'invalid', 'rejected', 'uncertain']) {
    writeFileSync(`${process.env.LEAD_PAGE_PREVIEW}/${outcome}.html`, handler().page(outcome).html.replace('<head>', '<head><meta name="viewport" content="width=device-width, initial-scale=1">'));
  }
}
