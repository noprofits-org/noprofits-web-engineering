// extract.mjs — parse .astro pages into editable text blocks + outbound links,
// and splice edited text back into the source with byte-exact offsets.
//
// This site's pages carry copy in four places, and each becomes a block "kind":
//   fm     — frontmatter string consts (title/description/og*/twitter*)
//   text   — plain HTML text nodes in the template body
//   attr   — string-literal component props (CtaBand heading/body) and
//            human-readable quoted attributes (alt/placeholder/aria-label/title)
//   shtml  — text nodes inside set:html={"…"} string payloads (the guide pages)
//
// Every block records the exact source span it came from; applyEdits() re-encodes
// only the blocks the user changed and splices them back highest-offset-first, so
// untouched bytes stay untouched.

// ---------------------------------------------------------------- entities

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  nbsp: ' ', mdash: '—', ndash: '–',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  hellip: '…', middot: '·', bull: '•',
  larr: '←', rarr: '→', le: '≤', ge: '≥',
  deg: '°', times: '×', Prime: '″', prime: '′',
  copy: '©', reg: '®', trade: '™',
  frac12: '½', frac14: '¼', frac34: '¾',
  laquo: '«', raquo: '»', sect: '§', para: '¶',
};

// House entity style for re-encoding edited text (about-us.astro, the guides,
// etc. all use named entities for typographic characters).
const ENCODE_MAP = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;',
  // Braces are ALWAYS encoded in HTML contexts: Astro evaluates {…} in
  // templates as JS expressions at build time, so a raw brace in saved copy
  // could execute code inside CI. &#123;/&#125; render as literal braces.
  '{': '&#123;', '}': '&#125;',
  ' ': '&nbsp;', '—': '&mdash;', '–': '&ndash;',
  '’': '&rsquo;', '‘': '&lsquo;', '”': '&rdquo;', '“': '&ldquo;',
  '…': '&hellip;', '·': '&middot;', '•': '&bull;',
  '←': '&larr;', '→': '&rarr;', '≤': '&le;', '≥': '&ge;',
  '°': '&deg;', '×': '&times;', '″': '&Prime;', '′': '&prime;',
  '©': '&copy;', '®': '&reg;', '™': '&trade;',
  '½': '&frac12;', '¼': '&frac14;', '¾': '&frac34;',
  '«': '&laquo;', '»': '&raquo;', '§': '&sect;', '¶': '&para;',
};
const ENCODE_RE = new RegExp('[' + Object.keys(ENCODE_MAP).join('') + ']', 'g');
// The mandatory subset: HTML-significant chars + the invisible nbsp trap.
const ENCODE_MIN_RE = /[&<>{}\u00A0]/g;

// Style detection: does a piece of source use named typographic entities, or
// literal Unicode punctuation? (Repos differ — GWC uses &mdash;, this one is
// mostly literal — so each edited block keeps the convention it already had.)
const TYPO_ENT_RE = /&(mdash|ndash|rsquo|lsquo|rdquo|ldquo|hellip|middot|bull|larr|rarr|le|ge|deg|times|Prime|prime|copy|reg|trade|frac12|frac14|frac34|laquo|raquo|sect|para);/;
const TYPO_CHAR_RE = new RegExp(
  '[' + Object.keys(ENCODE_MAP).filter((c) => !'&<>{}\u00A0'.includes(c)).join('') + ']');

export function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body)
      ? NAMED_ENTITIES[body]
      : m;
  });
}

export function encodeEntities(s, useTypoEntities = true) {
  const re = useTypoEntities ? ENCODE_RE : ENCODE_MIN_RE;
  return s.replace(re, (ch) => ENCODE_MAP[ch]);
}

// ---------------------------------------------------------------- JS strings

// Decode a JS string/template literal (raw includes its quotes). Returns null
// for anything we can't round-trip safely (template interpolation, bad escape).
export function decodeJsString(raw) {
  const q = raw[0];
  if (q !== '"' && q !== "'" && q !== '`') return null;
  if (raw[raw.length - 1] !== q || raw.length < 2) return null;
  let out = '';
  for (let i = 1; i < raw.length - 1; i++) {
    const c = raw[i];
    if (c === '\\') {
      const n = raw[++i];
      if (n === undefined) return null;
      switch (n) {
        case 'n': out += '\n'; break;
        case 't': out += '\t'; break;
        case 'r': out += '\r'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'v': out += '\v'; break;
        case '0': out += '\0'; break;
        case 'x': {
          const hex = raw.slice(i + 1, i + 3);
          if (!/^[0-9a-fA-F]{2}$/.test(hex)) return null;
          out += String.fromCharCode(parseInt(hex, 16)); i += 2; break;
        }
        case 'u': {
          if (raw[i + 1] === '{') {
            const close = raw.indexOf('}', i + 2);
            if (close < 0) return null;
            out += String.fromCodePoint(parseInt(raw.slice(i + 2, close), 16));
            i = close;
          } else {
            const hex = raw.slice(i + 1, i + 5);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null;
            out += String.fromCharCode(parseInt(hex, 16)); i += 4;
          }
          break;
        }
        case '\n': break; // line continuation
        default: out += n;
      }
    } else if (q === '`' && c === '$' && raw[i + 1] === '{') {
      return null; // interpolation — not a plain string, don't touch
    } else if (c === q) {
      return null; // unescaped quote before the end — scan bug
    } else {
      out += c;
    }
  }
  return out;
}

export function encodeJsString(s, q) {
  if (q === '"') return JSON.stringify(s);
  let body;
  if (q === '`') {
    body = s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  } else {
    body = s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
      .replace(/\n/g, '\\n').replace(/\r/g, '\\r');
  }
  return q + body + q;
}

// Scan a balanced {…} Astro/JS expression starting at src[i] === '{'.
// Quote- and template-literal-aware. Returns index just past the closing '}'.
function scanExpr(src, i) {
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '{') { depth++; i++; }
    else if (c === '}') { depth--; i++; if (depth === 0) return i; }
    else if (c === '"' || c === "'" || c === '`') { i = scanString(src, i); }
    else if (c === '/' && src[i + 1] === '/') { i = skipTo(src, i, '\n'); }
    else if (c === '/' && src[i + 1] === '*') { i = skipTo(src, i, '*/'); }
    else i++;
  }
  return i;
}

// Scan a string starting at its opening quote; returns index past closing quote.
function scanString(src, i) {
  const q = src[i++];
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === q) return i + 1;
    if (q === '`' && c === '$' && src[i + 1] === '{') { i = scanExpr(src, i + 1); continue; }
    i++;
  }
  return i;
}

function skipTo(src, i, needle) {
  const at = src.indexOf(needle, i);
  return at < 0 ? src.length : at + needle.length;
}

// ---------------------------------------------------------------- HTML scan

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img',
  'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

// Quoted attributes whose values are human-readable copy.
const TEXT_ATTRS = new Set(['alt', 'placeholder', 'aria-label', 'title']);
// Component props (expression attributes) that carry copy when their value is
// a single plain string/template literal (CtaBand heading/body etc.).
const TEXT_PROPS = new Set(['heading', 'body', 'title', 'description', 'label', 'text']);

function hasWords(s) { return /[A-Za-z0-9]/.test(s); }

// Scan an HTML fragment. Returns:
//   texts:    [{start, end, tag}]           — text-node spans with words
//   attrs:    [{start, end, quote, name, tag, kind:'quoted'|'expr'}]
//              (span covers the value INCLUDING its quotes/literal quotes)
//   setHtml:  [{litStart, litEnd, quote, raw}] — set:html string-literal spans
//   links:    [href strings]
export function scanHtml(src) {
  const texts = [], attrs = [], setHtml = [], links = [];
  const stack = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '<') {
      if (src.startsWith('<!--', i)) { i = skipTo(src, i, '-->'); continue; }
      if (src[i + 1] === '!') { i = skipTo(src, i, '>'); continue; }
      if (src[i + 1] === '/') { // closing tag
        const end = src.indexOf('>', i);
        const name = src.slice(i + 2, end < 0 ? src.length : end).trim().toLowerCase();
        for (let s = stack.length - 1; s >= 0; s--) {
          if (stack[s] === name) { stack.length = s; break; }
        }
        i = end < 0 ? src.length : end + 1;
        continue;
      }
      if (!/[A-Za-z]/.test(src[i + 1] || '')) { i++; continue; }
      // opening tag
      const tag = parseTag(src, i);
      i = tag.end;
      for (const a of tag.attrs) {
        if (a.name === 'href' && a.kind === 'quoted') {
          links.push(decodeEntities(src.slice(a.valStart + 1, a.valEnd - 1)));
        }
        if (a.kind === 'quoted' && TEXT_ATTRS.has(a.name)) {
          const inner = src.slice(a.valStart + 1, a.valEnd - 1);
          if (hasWords(inner)) {
            attrs.push({ start: a.valStart, end: a.valEnd, quote: src[a.valStart],
              name: a.name, tag: tag.name, kind: 'quoted' });
          }
        }
        if (a.kind === 'expr') {
          const exprBody = src.slice(a.valStart + 1, a.valEnd - 1).trim();
          const isLit = /^["'`]/.test(exprBody);
          if (!isLit) continue;
          const litStart = src.indexOf(exprBody[0], a.valStart + 1);
          const litEnd = scanString(src, litStart);
          // literal must be the whole expression
          if (src.slice(litEnd, a.valEnd - 1).trim() !== '') continue;
          const raw = src.slice(litStart, litEnd);
          if (a.name === 'set:html') {
            setHtml.push({ litStart, litEnd, quote: raw[0], raw });
          } else if (TEXT_PROPS.has(a.name) && decodeJsString(raw) !== null
                     && hasWords(raw)) {
            attrs.push({ start: litStart, end: litEnd, quote: raw[0],
              name: a.name, tag: tag.name, kind: 'expr' });
          }
        }
      }
      const lname = tag.name.toLowerCase();
      if (lname === 'script' || lname === 'style') {
        if (!tag.selfClosed) i = skipTo(src, i, '</' + lname);
        continue;
      }
      if (!tag.selfClosed && !VOID_TAGS.has(lname)) stack.push(lname);
      continue;
    }
    if (c === '{') { i = scanExpr(src, i); continue; }
    // text run
    let j = i;
    while (j < src.length && src[j] !== '<' && src[j] !== '{') j++;
    const run = src.slice(i, j);
    if (hasWords(decodeEntities(run))) {
      texts.push({ start: i, end: j, tag: stack[stack.length - 1] || '' });
    }
    i = j;
  }
  return { texts, attrs, setHtml, links };
}

// Parse one tag starting at '<'. Quote/brace-aware so `>` inside attr
// expressions (arrow fns, template strings) doesn't end the tag early.
function parseTag(src, i) {
  const m = /^<([A-Za-z][A-Za-z0-9:._-]*)/.exec(src.slice(i));
  const name = m ? m[1] : '';
  let p = i + 1 + name.length;
  const attrs = [];
  let selfClosed = false;
  while (p < src.length) {
    const c = src[p];
    if (c === '>') { p++; break; }
    if (c === '/' && src[p + 1] === '>') { selfClosed = true; p += 2; break; }
    if (/\s/.test(c)) { p++; continue; }
    // attribute name
    const am = /^[^\s=/>]+/.exec(src.slice(p));
    if (!am) { p++; continue; }
    const aname = am[0];
    p += aname.length;
    while (p < src.length && /\s/.test(src[p])) p++;
    if (src[p] !== '=') { attrs.push({ name: aname, kind: 'bare' }); continue; }
    p++;
    while (p < src.length && /\s/.test(src[p])) p++;
    const vc = src[p];
    if (vc === '"' || vc === "'") {
      const vEnd = skipTo(src, p + 1, vc);
      attrs.push({ name: aname, kind: 'quoted', valStart: p, valEnd: vEnd });
      p = vEnd;
    } else if (vc === '{') {
      const vEnd = scanExpr(src, p);
      attrs.push({ name: aname, kind: 'expr', valStart: p, valEnd: vEnd });
      p = vEnd;
    } else {
      const vm = /^[^\s>]*/.exec(src.slice(p));
      p += vm[0].length;
      attrs.push({ name: aname, kind: 'bare' });
    }
  }
  return { name, attrs, end: p, selfClosed };
}

// ---------------------------------------------------------------- pages

export function routeForFile(rel) {
  let r = rel.replace(/\\/g, '/').replace(/\.astro$/, '');
  if (r === 'index') return '/';
  if (r.endsWith('/index')) r = r.slice(0, -'/index'.length);
  return '/' + r;
}

// Canonical origin — absolute self-links get stripped to routes when building
// the link graph. Configured by the server (auto-detected from the repo).
let SITE_ORIGIN = '';
export function setSiteOrigin(origin) {
  SITE_ORIGIN = String(origin || '').replace(/\/+$/, '');
}

export function normalizeHref(href) {
  if (!href) return null;
  let h = href.trim();
  if (SITE_ORIGIN && h.startsWith(SITE_ORIGIN)) h = h.slice(SITE_ORIGIN.length) || '/';
  if (/^(tel:|mailto:|https?:|#|javascript:)/i.test(h)) return null;
  h = h.split('#')[0].split('?')[0];
  if (h === '') return '/';
  if (!h.startsWith('/')) return null; // relative refs aren't used site-wide
  h = h.replace(/\.html$/, '');
  if (h.length > 1 && h.endsWith('/')) h = h.slice(0, -1);
  if (h === '/index') h = '/';
  return h;
}

const FM_KEYS = ['title', 'description', 'pageDescription', 'ogTitle',
  'ogDescription', 'twitterTitle', 'twitterDescription'];

// Extract everything editable from one .astro source file.
export function extractPage(source, relFile) {
  const blocks = [];
  const links = [];

  // Per-block entity style: keep whatever convention the block (or, when the
  // block itself gives no signal, the file) already uses.
  const fileEnt = TYPO_ENT_RE.test(source);
  const entFor = (raw) =>
    TYPO_ENT_RE.test(raw) ? true : (TYPO_CHAR_RE.test(raw) ? false : fileEnt);

  // ---- frontmatter
  let bodyStart = 0;
  const fmOpen = /^---\s*\n/.exec(source);
  let fmTitle = null;
  if (fmOpen) {
    const fmEnd = source.indexOf('\n---', fmOpen[0].length);
    if (fmEnd >= 0) {
      bodyStart = source.indexOf('\n', fmEnd + 1) + 1 || source.length;
      const fm = source.slice(0, fmEnd);
      for (const key of FM_KEYS) {
        const re = new RegExp('(^|\\n)\\s*const\\s+' + key + '\\s*=\\s*', 'g');
        const m = re.exec(fm);
        if (!m) continue;
        const litStart = m.index + m[0].length;
        const q = fm[litStart];
        if (q !== '"' && q !== "'" && q !== '`') continue;
        const litEnd = scanString(fm, litStart);
        const raw = fm.slice(litStart, litEnd);
        const val = decodeJsString(raw);
        if (val === null) continue;
        if (key === 'title') fmTitle = val;
        blocks.push({
          kind: 'fm', label: key, group: 'seo',
          start: litStart, end: litEnd, quote: q, text: val,
        });
      }
    }
  }

  // ---- template body
  const body = source.slice(bodyStart);
  const scan = scanHtml(body);

  for (const t of scan.texts) {
    const raw = body.slice(t.start, t.end);
    blocks.push({
      kind: 'text', label: t.tag || 'text', group: 'content',
      start: bodyStart + t.start, end: bodyStart + t.end,
      ent: entFor(raw), text: decodeEntities(raw),
    });
  }
  for (const a of scan.attrs) {
    const raw = body.slice(a.start, a.end);
    const inner = a.kind === 'quoted'
      ? decodeEntities(raw.slice(1, -1))
      : decodeEntities(decodeJsString(raw));
    blocks.push({
      kind: 'attr', label: `${a.tag}[${a.name}]`, group: 'content',
      start: bodyStart + a.start, end: bodyStart + a.end,
      quote: a.quote, attrKind: a.kind, ent: entFor(raw), text: inner,
    });
  }
  for (const h of scan.links) links.push(h);

  // ---- set:html payloads (guide pages): decode, scan the inner HTML
  for (const sh of scan.setHtml) {
    const decoded = decodeJsString(sh.raw);
    if (decoded === null) continue;
    const inner = scanHtml(decoded);
    for (const h of inner.links) links.push(h);
    for (const t of inner.texts) {
      const raw = decoded.slice(t.start, t.end);
      blocks.push({
        kind: 'shtml', label: t.tag || 'text', group: 'content',
        cStart: bodyStart + sh.litStart, cEnd: bodyStart + sh.litEnd,
        quote: sh.quote,
        innerStart: t.start, innerEnd: t.end,
        ent: entFor(raw), text: decodeEntities(raw),
      });
    }
    for (const a of inner.attrs) {
      if (a.kind !== 'quoted') continue; // no nested expressions inside payloads
      const raw = decoded.slice(a.start + 1, a.end - 1);
      blocks.push({
        kind: 'shtml', label: `${a.tag}[${a.name}]`, group: 'content',
        cStart: bodyStart + sh.litStart, cEnd: bodyStart + sh.litEnd,
        quote: sh.quote, attrQuote: decoded[a.start],
        innerStart: a.start, innerEnd: a.end, isAttr: true,
        ent: entFor(raw), text: decodeEntities(raw),
      });
    }
  }

  // Sort content blocks by document position so the editor reads top-to-bottom.
  blocks.sort((x, y) => (x.start ?? x.cStart) - (y.start ?? y.cStart)
    || (x.innerStart ?? 0) - (y.innerStart ?? 0));
  blocks.forEach((b, idx) => { b.id = idx; });

  // Page title for the node label: frontmatter title, else first h1 text.
  const h1 = blocks.find((b) => b.label === 'h1');
  const title = fmTitle || (h1 ? h1.text.trim() : routeForFile(relFile));

  const outLinks = [...new Set(links.map(normalizeHref).filter(Boolean))];
  return { file: relFile, route: routeForFile(relFile), title, blocks, links: outLinks };
}

// ---------------------------------------------------------------- write-back

function encodeForBlock(b, newText) {
  switch (b.kind) {
    case 'fm':
      return encodeJsString(newText, b.quote)
        .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
        .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    case 'text':
      return encodeEntities(newText, b.ent);
    case 'attr': {
      if (b.attrKind === 'quoted') {
        let enc = encodeEntities(newText, b.ent);
        enc = b.quote === '"' ? enc.replace(/"/g, '&quot;') : enc.replace(/'/g, '&#39;');
        return b.quote + enc + b.quote;
      }
      return encodeJsString(encodeEntities(newText, b.ent), b.quote);
    }
    default:
      throw new Error('unsupported kind: ' + b.kind);
  }
}

// Apply edits ([{id, text}]) to source, given the blocks from a fresh
// extractPage() of that same source. Returns the new source string.
export function applyEdits(source, blocks, edits) {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const splices = []; // {start, end, text}
  const shtmlGroups = new Map(); // cStart -> {block-level info, innerEdits[]}

  for (const e of edits) {
    const b = byId.get(e.id);
    if (!b) throw new Error('unknown block id: ' + e.id);
    if (b.kind === 'shtml') {
      let g = shtmlGroups.get(b.cStart);
      if (!g) { g = { cStart: b.cStart, cEnd: b.cEnd, quote: b.quote, inner: [] }; shtmlGroups.set(b.cStart, g); }
      g.inner.push({ b, text: e.text });
    } else {
      splices.push({ start: b.start, end: b.end, text: encodeForBlock(b, e.text) });
    }
  }

  for (const g of shtmlGroups.values()) {
    const raw = source.slice(g.cStart, g.cEnd);
    let decoded = decodeJsString(raw);
    if (decoded === null) throw new Error('set:html payload no longer decodable');
    g.inner.sort((a, z) => z.b.innerStart - a.b.innerStart);
    for (const { b, text } of g.inner) {
      let enc = encodeEntities(text, b.ent);
      let s = b.innerStart, en = b.innerEnd;
      if (b.isAttr) {
        enc = b.attrQuote === '"' ? enc.replace(/"/g, '&quot;') : enc.replace(/'/g, '&#39;');
        enc = b.attrQuote + enc + b.attrQuote;
      }
      decoded = decoded.slice(0, s) + enc + decoded.slice(en);
    }
    splices.push({ start: g.cStart, end: g.cEnd, text: encodeJsString(decoded, g.quote) });
  }

  splices.sort((a, z) => z.start - a.start);
  let out = source;
  let lastStart = Infinity;
  for (const sp of splices) {
    if (sp.end > lastStart) throw new Error('overlapping edits');
    lastStart = sp.start;
    out = out.slice(0, sp.start) + sp.text + out.slice(sp.end);
  }
  return out;
}
