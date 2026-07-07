// verify-content-pr.mjs — CI guard for cms/* content PRs.
//
// The CMS function is the only intended writer of the cms/edits branch, and it
// can only produce text-block splices. This script re-verifies that claim from
// scratch on every PR, so even a STOLEN GitHub token (or a compromised
// function) cannot sneak executable changes through the review loop disguised
// as content:
//
//   1. every changed file must be a page: src/pages/*.astro
//   2. old and new versions must have the identical block skeleton
//      (same count, same kinds/labels, in the same order)
//   3. replaying the text edits through the engine must reproduce the new
//      file BYTE-FOR-BYTE — any stray byte outside an editable span fails
//
// Usage: node scripts/verify-content-pr.mjs <base-ref> <head-ref>
// (refs must exist locally — use fetch-depth: 0 in the workflow checkout)

import { execFileSync } from 'node:child_process';
import { extractPage, applyEdits } from '../tools/site-editor/extract.mjs';

const [base = 'origin/main', head = 'HEAD'] = process.argv.slice(2);
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

export function verifyPair(oldText, newText, file) {
  const oldPage = extractPage(oldText, file);
  const newPage = extractPage(newText, file);
  if (oldPage.blocks.length !== newPage.blocks.length) {
    return `block count changed (${oldPage.blocks.length} → ${newPage.blocks.length})`;
  }
  for (let i = 0; i < oldPage.blocks.length; i++) {
    const a = oldPage.blocks[i], b = newPage.blocks[i];
    if (a.kind !== b.kind || a.label !== b.label) {
      return `block #${i} shape changed (${a.kind}/${a.label} → ${b.kind}/${b.label})`;
    }
  }
  const edits = oldPage.blocks
    .filter((a, i) => a.text !== newPage.blocks[i].text)
    .map((a) => ({ id: a.id, text: newPage.blocks[a.id].text }));
  const rebuilt = applyEdits(oldText, oldPage.blocks, edits);
  if (rebuilt !== newText) {
    return 'diff is not reproducible as pure text-block edits (bytes changed outside editable spans)';
  }
  return null; // clean
}

// ---- CLI ----
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const mergeBase = git('merge-base', base, head).trim();
  const changed = git('diff', '--name-only', `${mergeBase}..${head}`).split('\n').filter(Boolean);
  if (!changed.length) { console.log('no changes'); process.exit(0); }

  let failed = 0;
  for (const file of changed) {
    if (!/^src\/pages\/[^_].*\.astro$/.test(file) || file.includes('/_')) {
      console.error(`✗ ${file}: content PRs may only change routed pages under src/pages/`);
      failed++;
      continue;
    }
    const oldText = git('show', `${mergeBase}:${file}`);
    const newText = git('show', `${head}:${file}`);
    const problem = verifyPair(oldText, newText, file);
    if (problem) { console.error(`✗ ${file}: ${problem}`); failed++; }
    else console.log(`✓ ${file}: text-block edits only`);
  }
  if (failed) {
    console.error(`\n${failed} file(s) failed content verification — DO NOT MERGE without a manual code review.`);
    process.exit(1);
  }
  console.log('\nall changed files verified as pure content edits');
}
