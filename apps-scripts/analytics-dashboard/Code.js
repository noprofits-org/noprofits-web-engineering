/**
 * noprofits.org — LIVE analytics dashboard (STANDALONE Apps Script web app).
 *
 * Serves a read-only HTML dashboard rendered fresh from the Events tab on each
 * load (a short CacheService window bounds the sheet scans). Deliberately a
 * SEPARATE script + deployment from the lead/beacon handler so it can be gated
 * "Anyone with a Google account" WITHOUT putting the public form endpoint behind
 * a sign-in wall (the form + beacon must stay anonymous-"Anyone").
 *
 * Reads the Leads spreadsheet by id (Script Property SHEET_ID) via openById,
 * executing as the owner — so a signed-in viewer never needs sheet access.
 *
 * SETUP
 *   1. Script Property:  SHEET_ID = the Leads spreadsheet id (from its URL).
 *   2. Deploy ▸ New deployment ▸ Web app
 *        Execute as:      Me (the owner)
 *        Who has access:  Anyone with a Google account
 *   3. Put the /exec URL in the site's PUBLIC_DASHBOARD_URL repo Variable.
 */

var EVENTS_SHEET = 'Events';
var CACHE_KEY = 'dash_agg_v1';
var CACHE_TTL = 120; // seconds — ~2 min "near-live" window, caps sheet scans

// Chart palette (mirrors the marketing site's tokens).
var COLORS = { pageview: '#2F7DA3', visits: '#5B9FC0', inquiry: '#1C5572', call: '#9FD0BF' };

function doGet() {
  var data = getAggregateCached_();
  var t = HtmlService.createTemplateFromFile('Index');
  t.bodyHtml = buildBody_(data);
  t.generatedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MMMM d, yyyy 'at' h:mm a");
  return t.evaluate()
    .setTitle('noprofits.org — live site stats')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL); // allows embedding in /stats
}

// --- Data --------------------------------------------------------------------

function getSheetId_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('SHEET_ID script property is not set — add it in Project Settings.');
  return id;
}

/** Cached aggregate so popular loads don't re-scan the sheet every request. */
function getAggregateCached_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(CACHE_KEY);
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var data = aggregateEvents_();
  try { cache.put(CACHE_KEY, JSON.stringify(data), CACHE_TTL); } catch (e) {}
  return data;
}

/** Roll the Events tab into totals + daily (incl. distinct-session visits) + top referrers. */
function aggregateEvents_() {
  var ss = SpreadsheetApp.openById(getSheetId_());
  var sheet = ss.getSheetByName(EVENTS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) {
    return { totals: { pageview: 0, form_submit: 0, tel_click: 0, visits: 0 }, daily: [], referrers: [] };
  }
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues(); // ts,type,path,ref,detail,session
  var tz = Session.getScriptTimeZone();
  var totals = { pageview: 0, form_submit: 0, tel_click: 0, visits: 0 };
  var byDay = {};
  var allSessions = {};
  var refCounts = {};

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

  return { totals: totals, daily: daily, referrers: referrers };
}

// --- View model (HTML built server-side, injected into Index.html) -----------

function buildBody_(data) {
  var totals = data.totals || {};
  var daily = data.daily || [];
  var referrers = data.referrers || [];
  var visits = totals.visits || 0;
  var hasData = daily.length > 0 && visits > 0;
  if (!hasData) {
    return '<div class="card empty"><h2>Collecting data</h2>' +
      '<p class="lead">No events have been recorded yet. Page views, visits, inquiries, and ' +
      'phone clicks will appear here as soon as visitors arrive.</p></div>';
  }

  var pageviews = totals.pageview || 0;
  var inquiries = totals.form_submit || 0;
  var calls = totals.tel_click || 0;
  var contacts = inquiries + calls;
  var pagesPerVisit = safeDiv_(pageviews, visits);
  var inquiryRate = safeDiv_(inquiries, visits) * 100;
  var callRate = safeDiv_(calls, visits) * 100;
  var contactRate = safeDiv_(contacts, visits) * 100;
  var avgVisits = safeDiv_(visits, daily.length);

  var peak = daily.reduce(function (b, d) { return (!b || d.visits > b.visits) ? d : b; }, null);

  var cards = [
    { v: fmt_(visits), l: 'Visits', n: 'distinct browser sessions' },
    { v: fmt_(pageviews), l: 'Page views', n: dec_(pagesPerVisit) + ' pages per visit' },
    { v: fmt_(inquiries), l: 'Inquiries', n: dec_(inquiryRate) + '% of visits' },
    { v: fmt_(calls), l: 'Phone clicks', n: dec_(callRate) + '% of visits' },
    { v: fmt_(contacts), l: 'Total contacts', n: dec_(contactRate) + '% reach out' },
    { v: dec_(avgVisits), l: 'Avg / day', n: 'over ' + daily.length + ' days' }
  ];
  var cardsHtml = '<section class="cards">' + cards.map(function (c) {
    return '<div class="statcard"><span class="statcard__v">' + c.v + '</span>' +
      '<span class="statcard__l">' + c.l + '</span>' +
      '<span class="statcard__n">' + c.n + '</span></div>';
  }).join('') + '</section>';

  var trafficSvg = lineChart_(daily, [
    { key: 'pageview', color: COLORS.pageview },
    { key: 'visits', color: COLORS.visits }
  ]);
  var engagementSvg = stackChart_(daily, [
    { key: 'form_submit', color: COLORS.inquiry },
    { key: 'tel_click', color: COLORS.call }
  ]);

  var trafficSection =
    '<section class="card"><div class="chart__head"><h2>Traffic over time</h2>' +
    legend_([['Page views', COLORS.pageview], ['Visits', COLORS.visits]]) + '</div>' +
    trafficSvg +
    '<p class="cap">Daily page views and distinct visits.' +
    (peak ? ' Busiest day: <strong>' + longDate_(peak.date) + '</strong> (' + fmt_(peak.visits) +
      ' visits) — the kind of lift a campaign or a mention creates.' : '') + '</p></section>';

  var engagementSection =
    '<section class="card"><div class="chart__head"><h2>People reaching out</h2>' +
    legend_([['Inquiries', COLORS.inquiry], ['Phone clicks', COLORS.call]]) + '</div>' +
    engagementSvg +
    '<p class="cap">Genuine form submissions and taps on the phone number, per day — the events ' +
    'that turn a visitor into a conversation.</p></section>';

  var refSection = '';
  if (referrers.length > 0) {
    var top = referrers[0].count || 1;
    refSection = '<section class="card"><h2>Where visitors come from</h2><ul class="sources">' +
      referrers.map(function (r) {
        var pct = Math.max(4, safeDiv_(r.count, top) * 100);
        return '<li class="source"><span class="source__host">' + escapeHtml_(r.host) + '</span>' +
          '<span class="source__bar"><span class="source__fill" style="width:' + dec_(pct, 0) + '%"></span></span>' +
          '<span class="source__count">' + fmt_(r.count) + '</span></li>';
      }).join('') +
      '</ul><p class="cap">Only the referring site\'s domain is ever recorded — never a full ' +
      'web address, and never anything about the person.</p></section>';
  }

  return cardsHtml + trafficSection + engagementSection + refSection;
}

function legend_(items) {
  return '<div class="legend">' + items.map(function (it) {
    return '<span class="key"><span class="swatch" style="background:' + it[1] + '"></span>' + it[0] + '</span>';
  }).join('') + '</div>';
}

// --- Dependency-free SVG charts (server-rendered strings) ---------------------

var W = 760, H = 260, PAD = { t: 18, r: 16, b: 28, l: 40 };
var INW = W - PAD.l - PAD.r, INH = H - PAD.t - PAD.b;
var MONTHS_ = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
var MONTHSL_ = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function niceMax_(v) {
  if (v <= 5) return 5;
  var pow = Math.pow(10, Math.floor(Math.log(v) / Math.LN10));
  var n = v / pow;
  var step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}
function xAt_(i, n) { return PAD.l + (n <= 1 ? INW / 2 : (INW * i) / (n - 1)); }
function yAt_(v, max) { return PAD.t + INH * (1 - safeDiv_(v, max)); }

function monthTicks_(days) {
  var ticks = [], last = -1;
  days.forEach(function (d, i) {
    var m = ymd_(d.date).m;
    if (m !== last) { ticks.push({ i: i, label: MONTHS_[m] }); last = m; }
  });
  return ticks;
}
function gridAndTicks_(days, grid, max) {
  var n = days.length;
  var g = grid.map(function (val) {
    var y = yAt_(val, max);
    return '<line x1="' + PAD.l + '" y1="' + y.toFixed(1) + '" x2="' + (W - PAD.r) + '" y2="' + y.toFixed(1) + '" class="grid"/>' +
      '<text x="' + (PAD.l - 8) + '" y="' + (y + 4).toFixed(1) + '" class="ylab">' + fmt_(val) + '</text>';
  }).join('');
  var t = monthTicks_(days).map(function (tk) {
    return '<text x="' + xAt_(tk.i, n).toFixed(1) + '" y="' + (H - 8) + '" class="xlab">' + tk.label + '</text>';
  }).join('');
  return g + t;
}

function lineChart_(days, series) {
  var n = days.length;
  var max = niceMax_(Math.max.apply(null, [1].concat(days.map(function (d) {
    return Math.max.apply(null, series.map(function (s) { return Number(d[s.key]); }));
  }))));
  var lines = series.map(function (s) {
    var pts = days.map(function (d, i) { return xAt_(i, n).toFixed(1) + ',' + yAt_(Number(d[s.key]), max).toFixed(1); }).join(' ');
    var dots = days.map(function (d, i) {
      return '<circle cx="' + xAt_(i, n).toFixed(1) + '" cy="' + yAt_(Number(d[s.key]), max).toFixed(1) + '" r="2.5" fill="' + s.color + '"/>';
    }).join('');
    return '<polyline points="' + pts + '" fill="none" stroke="' + s.color + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>' + dots;
  }).join('');
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="svg" preserveAspectRatio="xMidYMid meet" role="img">' +
    gridAndTicks_(days, [0, max / 2, max], max) + lines + '</svg>';
}

function stackChart_(days, series) {
  var n = days.length;
  var max = niceMax_(Math.max.apply(null, [1].concat(days.map(function (d) {
    return series.reduce(function (a, s) { return a + Number(d[s.key]); }, 0);
  }))));
  var bw = Math.max(2, (INW / n) * 0.7);
  var bars = days.map(function (d, i) {
    var x = xAt_(i, n) - bw / 2;
    var yTop = PAD.t + INH;
    return series.map(function (s) {
      var v = Number(d[s.key]);
      if (v <= 0) return '';
      var h = (INH * v) / max;
      yTop -= h;
      return '<rect x="' + x.toFixed(1) + '" y="' + yTop.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + s.color + '"/>';
    }).join('');
  }).join('');
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="svg" preserveAspectRatio="xMidYMid meet" role="img">' +
    gridAndTicks_(days, [0, max], max) + bars + '</svg>';
}

// --- Helpers -----------------------------------------------------------------

function safeDiv_(a, b) { return b > 0 ? a / b : 0; }
function dec_(n, p) { if (p == null) p = 1; return (Number(n) || 0).toFixed(p); }
function fmt_(n) {
  n = Math.round(Number(n) || 0);
  var s = String(Math.abs(n)), out = '';
  while (s.length > 3) { out = ',' + s.slice(-3) + out; s = s.slice(0, -3); }
  return (n < 0 ? '-' : '') + s + out;
}
function ymd_(iso) { var p = String(iso).slice(0, 10).split('-'); return { y: +p[0], m: +p[1] - 1, d: +p[2] }; }
function longDate_(iso) { var x = ymd_(iso); return MONTHSL_[x.m] + ' ' + x.d + ', ' + x.y; }
function escapeHtml_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
