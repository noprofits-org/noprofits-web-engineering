// cms-core.mjs — the CMS brain, pure and unit-testable: no Firebase imports,
// no network of its own. All GitHub access goes through the injected client,
// all parsing through the injected engine (engine.mjs = tools/site-editor/
// extract.mjs, synced by `npm run sync-engine`).
//
// Publish model (PR-gated): saves NEVER touch the deployed branch. Every save
// commits to the `cms/edits` branch and makes sure a pull request into main is
// open. Only a human merging that PR publishes anything — and the deploy
// workflow's WIF trust is pinned to main, so the edits branch cannot deploy.

const ROUTE_RE = /^\/[a-zA-Z0-9\-_/]{0,300}$|^\/$/;
const MAX_EDITS = 200;
const MAX_EDIT_CHARS = 20_000;
const MAX_TOTAL_CHARS = 400_000;

export function createCmsCore({ gh, engine, baseBranch = 'main', editsBranch = 'cms/edits' }) {
  const relOf = (path) => path.slice('src/pages/'.length);

  async function contentRef() {
    return (await gh.branchSha(editsBranch)) ? editsBranch : baseBranch;
  }

  async function pageIndex(ref) {
    const files = await gh.listPages(ref);
    return files.map((f) => ({ ...f, route: engine.routeForFile(relOf(f.path)) }));
  }

  function sectionMap(routes) {
    const seg = (r) => (r === '/' ? 'home' : r.split('/')[1]);
    const counts = new Map();
    for (const r of routes) counts.set(seg(r), (counts.get(seg(r)) || 0) + 1);
    return new Map(routes.map((r) => {
      const s = seg(r);
      return [r, s === 'home' ? 'home' : (counts.get(s) >= 2 ? s : 'other')];
    }));
  }

  return {
    async graph() {
      const ref = await contentRef();
      const idx = await pageIndex(ref);
      const pages = await Promise.all(idx.map(async (f) => {
        const file = await gh.getFile(f.path, ref);
        return { ...engine.extractPage(file.text, relOf(f.path)), path: f.path };
      }));
      const byRoute = new Map(pages.map((p) => [p.route, p]));
      const sections = sectionMap(pages.map((p) => p.route));
      const nodes = pages.map((p) => ({
        route: p.route, file: p.path, title: p.title,
        section: sections.get(p.route),
        blocks: p.blocks.length,
        words: p.blocks.reduce((n, b) => n + (b.group === 'content'
          ? b.text.split(/\s+/).filter(Boolean).length : 0), 0),
      }));
      const edgeMap = new Map();
      for (const p of pages) {
        for (const href of p.links) {
          if (!byRoute.has(href) || href === p.route) continue;
          const k = p.route + ' ' + href;
          edgeMap.set(k, (edgeMap.get(k) || 0) + 1);
        }
      }
      const edges = [...edgeMap].map(([k, n]) => {
        const [source, target] = k.split(' ');
        return { source, target, n };
      });
      const pr = await gh.findOpenPr(editsBranch, baseBranch);
      return { nodes, edges, ref, pendingPr: pr };
    },

    async page(route) {
      if (!ROUTE_RE.test(route)) { const e = new Error('bad route'); e.code = 400; throw e; }
      const ref = await contentRef();
      const idx = await pageIndex(ref);
      const hit = idx.find((f) => f.route === route);
      if (!hit) { const e = new Error('no page for route ' + route); e.code = 404; throw e; }
      const file = await gh.getFile(hit.path, ref);
      const page = engine.extractPage(file.text, relOf(hit.path));
      return {
        route: page.route, file: hit.path, title: page.title,
        fileSha: file.sha, ref,
        blocks: page.blocks.map((b) => ({
          id: b.id, label: b.label, kind: b.kind, group: b.group, text: b.text,
        })),
      };
    },

    async save({ route, fileSha, edits, editor }) {
      // ---- input validation (defense in depth on top of auth)
      if (!ROUTE_RE.test(String(route))) { const e = new Error('bad route'); e.code = 400; throw e; }
      if (!/^[0-9a-f]{40}$/.test(String(fileSha))) { const e = new Error('bad file sha'); e.code = 400; throw e; }
      if (!Array.isArray(edits) || edits.length === 0 || edits.length > MAX_EDITS) {
        const e = new Error('edits must be 1–' + MAX_EDITS + ' items'); e.code = 400; throw e;
      }
      let total = 0;
      for (const ed of edits) {
        if (!Number.isInteger(ed.id) || ed.id < 0 || typeof ed.text !== 'string'
            || ed.text.length > MAX_EDIT_CHARS) {
          const e = new Error('bad edit item'); e.code = 400; throw e;
        }
        total += ed.text.length;
      }
      if (total > MAX_TOTAL_CHARS) { const e = new Error('edits too large'); e.code = 400; throw e; }

      // ---- make sure the edits branch exists (from the CURRENT base head)
      let branchSha = await gh.branchSha(editsBranch);
      if (!branchSha) {
        const baseSha = await gh.branchSha(baseBranch);
        await gh.createBranch(editsBranch, baseSha);
      }

      // ---- locate the page ON THE EDITS BRANCH and check freshness
      const idx = await pageIndex(editsBranch);
      const hit = idx.find((f) => f.route === route);
      if (!hit) { const e = new Error('no page for route ' + route); e.code = 404; throw e; }
      const file = await gh.getFile(hit.path, editsBranch);
      if (file.sha !== fileSha) {
        const e = new Error('page changed since you loaded it — reload the editor');
        e.code = 409; throw e;
      }

      // ---- splice the edits in (all encoding/injection defenses live here)
      const page = engine.extractPage(file.text, relOf(hit.path));
      const ids = new Set(page.blocks.map((b) => b.id));
      for (const ed of edits) {
        if (!ids.has(ed.id)) { const e = new Error('unknown block id ' + ed.id); e.code = 400; throw e; }
      }
      const next = engine.applyEdits(file.text, page.blocks, edits);

      // ---- commit to the edits branch; GitHub re-checks the sha atomically
      const summary = edits.length === 1 ? '1 text block' : edits.length + ' text blocks';
      const { newSha } = await gh.putFile(hit.path, {
        text: next, sha: fileSha, branch: editsBranch,
        message: `content: edit ${summary} on ${route} (via site editor, by ${editor})`,
      });

      // ---- make sure the review PR is open
      let pr = await gh.findOpenPr(editsBranch, baseBranch);
      if (!pr) {
        pr = await gh.createPr(editsBranch, baseBranch,
          'Content edits via site editor',
          'Text-block edits saved from the visual site editor.\n\n' +
          'Every change in this PR should be copy only — if this diff touches ' +
          'anything other than text inside `src/pages/*.astro`, do not merge.\n\n' +
          'Merging publishes: the deploy workflow ships `main` to Firebase Hosting.');
      }
      return { ok: true, saved: edits.length, fileSha: newSha, pr };
    },
  };
}
