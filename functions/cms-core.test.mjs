// cms-core.test.mjs — unit tests for the CMS brain against an in-memory
// GitHub fake. Run: node functions/cms-core.test.mjs  (exit 0 = all pass)
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCmsCore } from './cms-core.mjs';
import * as engine from './engine.mjs';

// ---- in-memory GitHub: branches are {path → text} maps; PRs a simple list
function fakeGithub(mainFiles) {
  const sha = (s) => createHash('sha1').update(s).digest('hex'); // 40-hex like a blob sha
  const branches = new Map([['main', new Map(Object.entries(mainFiles))]]);
  const prs = [];
  return {
    _branches: branches, _prs: prs,
    async branchSha(b) { return branches.has(b) ? 'head-' + b : null; },
    async createBranch(b, fromSha) {
      assert.equal(fromSha, 'head-main');
      branches.set(b, new Map(branches.get('main')));
    },
    async listPages(ref) {
      return [...branches.get(ref).keys()]
        .filter((p) => p.startsWith('src/pages/') && p.endsWith('.astro')
          && !p.split('/').some((s) => s.startsWith('_')))
        .map((p) => ({ path: p, sha: sha(branches.get(ref).get(p)) }));
    },
    async getFile(path, ref) {
      const text = branches.get(ref).get(path);
      return text === undefined ? null : { sha: sha(text), text };
    },
    async putFile(path, { text, sha: expect, branch }) {
      const cur = branches.get(branch).get(path);
      assert.equal(expect, sha(cur), 'stale sha must be rejected before this point');
      branches.get(branch).set(path, text);
      return { newSha: sha(text), commit: 'c1' };
    },
    async findOpenPr(head, base) {
      const pr = prs.find((p) => p.head === head && p.base === base && p.open);
      return pr ? { number: pr.number, url: pr.url } : null;
    },
    async createPr(head, base, title) {
      const pr = { head, base, title, open: true, number: prs.length + 1,
        url: 'https://github.com/x/y/pull/' + (prs.length + 1) };
      prs.push(pr);
      return { number: pr.number, url: pr.url };
    },
  };
}

const PAGES = {
  'src/pages/index.astro': `---
const title = 'Home';
---
<h1>Welcome home</h1>
<p>Read the <a href="/guide">guide</a>.</p>
`,
  'src/pages/guide.astro': `---
const title = 'Guide';
---
<h1>The guide</h1>
<p>Back <a href="/">home</a>.</p>
`,
  'src/pages/_secret.astro': `---
---
<h1>internal</h1>
`,
};

let ran = 0;
const test = async (name, fn) => { await fn(); ran++; console.log('  ✓', name); };

const gh = fakeGithub(PAGES);
const core = createCmsCore({ gh, engine });

await test('graph: routed pages only, correct edges, reads main before any edit', async () => {
  const g = await core.graph();
  assert.deepEqual(g.nodes.map((n) => n.route).sort(), ['/', '/guide']);
  assert.equal(g.edges.length, 2);
  assert.equal(g.ref, 'main');
  assert.equal(g.pendingPr, null);
});

await test('page: returns blocks + fileSha; unknown route 404s; bad route 400s', async () => {
  const p = await core.page('/guide');
  assert.equal(p.file, 'src/pages/guide.astro');
  assert.ok(p.blocks.find((b) => b.label === 'h1'));
  assert.ok(/^[0-9a-f]{40}$/.test(p.fileSha));
  await assert.rejects(core.page('/nope'), (e) => e.code === 404);
  await assert.rejects(core.page('../../etc/passwd'), (e) => e.code === 400);
});

let firstPr;
await test('save: creates cms/edits from main, commits, opens ONE PR', async () => {
  const p = await core.page('/');
  const h1 = p.blocks.find((b) => b.label === 'h1');
  const out = await core.save({
    route: '/', fileSha: p.fileSha,
    edits: [{ id: h1.id, text: 'Welcome — edited' }], editor: 'tester@example.com',
  });
  firstPr = out.pr;
  assert.equal(out.ok, true);
  assert.ok(gh._branches.has('cms/edits'), 'edits branch created');
  assert.ok(gh._branches.get('cms/edits').get('src/pages/index.astro').includes('Welcome'));
  assert.equal(gh._branches.get('main').get('src/pages/index.astro'), PAGES['src/pages/index.astro'],
    'main is untouched — publish only via PR merge');
  assert.equal(gh._prs.length, 1);
});

await test('second save reuses the same branch and PR', async () => {
  const p = await core.page('/guide');
  const h1 = p.blocks.find((b) => b.label === 'h1');
  const out = await core.save({
    route: '/guide', fileSha: p.fileSha,
    edits: [{ id: h1.id, text: 'The guide, v2' }], editor: 't@e.com',
  });
  assert.equal(out.pr.number, firstPr.number, 'no PR spam');
  assert.equal(gh._prs.length, 1);
});

await test('reads now come from the edits branch (editors see pending state)', async () => {
  const g = await core.graph();
  assert.equal(g.ref, 'cms/edits');
  assert.equal(g.pendingPr.number, firstPr.number);
  const p = await core.page('/');
  assert.ok(p.blocks.find((b) => b.label === 'h1').text.includes('edited'));
});

await test('stale fileSha is rejected with 409 (no lost updates)', async () => {
  const p = await core.page('/');
  const h1 = p.blocks.find((b) => b.label === 'h1');
  await core.save({ route: '/', fileSha: p.fileSha,
    edits: [{ id: h1.id, text: 'first writer wins' }], editor: 'a@e.com' });
  await assert.rejects(
    core.save({ route: '/', fileSha: p.fileSha,
      edits: [{ id: h1.id, text: 'second writer loses' }], editor: 'b@e.com' }),
    (e) => e.code === 409);
});

await test('input caps and shapes are enforced', async () => {
  const p = await core.page('/');
  const bad = (over) => core.save({ route: '/', fileSha: p.fileSha, editor: 'x@e.com', ...over });
  await assert.rejects(bad({ edits: [] }), (e) => e.code === 400);
  await assert.rejects(bad({ edits: [{ id: 'zero', text: 'x' }] }), (e) => e.code === 400);
  await assert.rejects(bad({ edits: [{ id: 0, text: 'x'.repeat(20_001) }] }), (e) => e.code === 400);
  await assert.rejects(bad({ edits: [{ id: 99999, text: 'x' }] }), (e) => e.code === 400);
  await assert.rejects(bad({ fileSha: 'not-a-sha', edits: [{ id: 0, text: 'x' }] }), (e) => e.code === 400);
  await assert.rejects(
    core.save({ route: '/x/../y', fileSha: p.fileSha, edits: [{ id: 0, text: 'x' }], editor: 'x@e.com' })
      .catch((e) => { if (e.code === 400 || e.code === 404) throw e; }),
    (e) => e.code === 400 || e.code === 404);
});

await test('hostile edit lands entity-encoded in the committed file', async () => {
  const p = await core.page('/guide');
  const h1 = p.blocks.find((b) => b.label === 'h1');
  await core.save({ route: '/guide', fileSha: p.fileSha,
    edits: [{ id: h1.id, text: '<script>x</script>{run()}' }], editor: 'x@e.com' });
  const committed = gh._branches.get('cms/edits').get('src/pages/guide.astro');
  assert.ok(!committed.includes('<script>x'), 'no live script');
  assert.ok(committed.includes('&lt;script&gt;'), 'escaped');
  assert.ok(committed.includes('&#123;run()&#125;'), 'braces neutralized');
});

console.log(`\nall ${ran} cms-core tests passed`);
