# GitHub "Files changed" DOM notes

Observed 2026-09-02 on `https://github.com/Mnigos/tessera/pull/165/files`, fetched with `curl -sL` and a
desktop Chrome user agent (logged out, so GitHub served the **classic** server-rendered page). The
React-based page GitHub serves to some logged-in users could not be fetched and is **not verified**; every
selector below therefore has an attribute-based fallback. A trimmed copy of the fetched markup is saved at
`fixtures/github-files-page.html` and used by `src/lib/panel/github-dom.spec.ts`.

## Anchors (primary key)

- Every file section carries `id="diff-<sha256 hex of the path>"`. Verified: for both rendered files, the
  SHA-256 of the `data-tagsearch-path` value equals the anchor id suffix (2/2 paths, 2/2 anchors).
- Example: `apps/api/src/modules/github-import/application/github-import.service.ts` →
  `diff-4432f2710fdacec9d3206b2a3a078be5e55dc38e1db80e519c9a78437a10551e`.
- The file-tree entry for the same file is `li#file-tree-item-diff-<sha256>` containing
  `a.ActionList-content[href="#diff-<sha256>"]`.

## Path attributes (secondary key)

Three different attributes carry the path, on three nesting levels:

| attribute | element |
| --- | --- |
| `data-file-path` | `copilot-diff-entry` (outermost wrapper) |
| `data-tagsearch-path` | `div.file.js-file.js-details-container[id="diff-…"]` (the file section) |
| `data-path` | `div.file-header.js-file-header` (also has `data-anchor="diff-…"`) |

`data-path` is header-level, so a match on it is resolved back up with `closest()` to the file section.

## Containers

- Files list: `#files` inside `#diff-layout-component`; each progressive chunk is a
  `div.js-diff-progressive-container`. Only 2 of the PR's 26 files were rendered in the initial HTML — the
  rest load progressively, which is why the scroll fallback clicks the file-tree entry and retries.
- File tree: `<file-tree>` with `ul.ActionList` / `li.ActionList-item.js-tree-node[role="treeitem"]`.

## Viewed checkbox

Not present logged out (1 occurrence of "Viewed" on the page, in the file-filter menu:
`input.js-viewed-files-toggle[name="show-viewed-files"]`). The per-file markup was read from
`https://github.githubassets.com/assets/diffs-dddbddb2a1f916e3.js`, which does:

- `e.querySelector('.js-reviewed-toggle')` → the toggle container, then
  `.querySelector('.js-reviewed-checkbox')` → the `input[type="checkbox"]`;
- `n.querySelector('.js-reviewed-file')` to test the current state, where `n = e.closest('.js-details-container')`;
- `n.toggleAttribute('data-file-user-viewed')` on the file section and the same on
  `document.getElementById('file-tree-item-' + n.id)`.

The panel therefore treats a file as viewed when the section has `data-file-user-viewed` **or** its
`.js-reviewed-checkbox` / `input[type="checkbox"][name="viewed"]` is checked, and toggles it with
`checkbox.click()`.

## Sticky header

No `--sticky-header` variable. GitHub's own sidebar offsets itself with
`style="top: calc(var(--base-sticky-header-height, 0px) + var(--observed-header-height, 60px))"`, and the
toolbar is `div.pr-toolbar.js-toggle-stuck.js-observe-sticky-header-height`. The panel reuses the same two
custom properties with the same 60px fallback. `--observed-header-height` is written by GitHub's own JS, so
it may read as empty at mount time; the 60px fallback then applies.

On the new Changes page each `[data-diff-header-wrapper]` is sticky on its own and carries an inline
`--header-sticky-offset` that GitHub's JS writes and rewrites, so it is not a stable hook for stacking. A
second sticky bar of ours covered the file name, so the layer badge (`[data-detent-layer]`) is prepended to
the header's `[class*="file-path-section"]` instead and the layer divider stays in the flow.

## Theme

`<html lang="en" data-color-mode="auto" data-light-theme="light" data-dark-theme="dark">`. `data-color-mode`
is `auto | light | dark`; `auto` is resolved with `matchMedia('(prefers-color-scheme: dark)')`. Descendant
selectors do not cross the shadow boundary, so the resolved mode is mirrored as a `dark` class on the
shadow root's container and Tailwind's dark variant is redefined as `&:where(.dark, .dark *)`.
