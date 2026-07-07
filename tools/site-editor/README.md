# Site Map Editor — visual content editor for this site

A local dev tool that renders the whole site as a **node map** — one node per
URL, lines for the hyperlinks between pages — and lets you click any node to
open a text editor for that page. Edits are saved **directly back into the
`.astro` source files** under `src/pages/`, so the normal review flow (git
diff → commit → build → deploy) still applies to every change.

```bash
npm run edit          # → http://127.0.0.1:4400
```

No dependencies beyond Node (it's a single plain-Node server). Ported from
the Grey Wolfe marketing-site repo (`gwc-marketing-site/tools/site-editor`),
generalized: the canonical origin is auto-detected from `src/data/site.ts`
(`SITE_URL`, override with the `SITE_ORIGIN` env var) and sections/colors are
derived from the URL structure instead of being hardcoded.

## What you see

- **Nodes** = every routed page under `src/pages` (files/dirs prefixed `_`
  are skipped, matching Astro routing), sized by word count and colored by
  top-level URL section. Drag to pan, scroll to zoom, drag nodes to
  rearrange, hover for a summary, use the search box to spotlight a page.
- **Edges** = internal hyperlinks found in each page's own markup (header/
  footer nav links live in shared components and are intentionally excluded —
  they would connect every node to every other and hide the real structure).

## Editing

Click a node → a drawer opens with every piece of text on that page, in
document order, each labeled with where it lives (`h1`, `p`, `li`,
`img[alt]`, …). SEO strings (`title`, `description`/`pageDescription`,
`og*`, `twitter*` frontmatter consts) sit in a collapsed group below the
content. Edit any block and hit **Save** (or Ctrl/Cmd-S).

The server splices each changed block back into the source at its exact
offset. Supported authoring styles:

| where the copy lives | example |
|---|---|
| plain template HTML | every page in this repo |
| `set:html={"…"}` string payloads | (used by the GWC guide pages) |
| string-literal component props | `heading={\`…\`}` |
| human-readable attributes | `alt`, `placeholder`, `aria-label`, `title` |
| frontmatter string consts | `const title = '…'` |

Edited text is re-encoded in named-entity style (`—` → `&mdash;`,
`’` → `&rsquo;`, …), and **only changed blocks are touched** — saving a page
with no changes (or reverting an edit) leaves the file byte-identical.
A content hash guards every save: if the file changed on disk since the
editor loaded it (e.g. you edited it in your IDE), the save is rejected with
a "reload" error instead of clobbering anything.

## What it deliberately does not edit

Markup structure, expressions (`{title}`), JSON-LD frontmatter objects, CSS,
scripts, and shared components (Header/Footer/InquiryForm). Frontmatter
consts built with interpolation (`` `${SITE_NAME} — …` ``) are skipped —
only plain string literals are editable. Inline HTML *around* text
(`<em>…</em>` splitting a sentence) stays in the source, so a paragraph with
inline markup appears as a few consecutive blocks rather than one.

## Files

- `server.mjs` — HTTP server + save endpoint (`PORT`/`HOST` env to override)
- `extract.mjs` — .astro parsing, text-block extraction, offset-safe splice-back
- `app.html` — the canvas node map + editor drawer (no build step, no CDN)
