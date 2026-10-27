# detent for GitHub: brief for stage 7 (model-first layers, sections inside GitHub's own file tree)

Owner verdict on 2026-09-11 after using the panel on a 39-file billing pull request: the right-hand overlay does not belong on GitHub's page; the grouping must live inside GitHub's own file tree on the left, styled exactly like GitHub. Also: migrations are the key to understanding the rest and must come first, not last; duplicate layer names ("web" twice) and the `Changes` fallback name are unacceptable; the structural skeleton produced groupings a reviewer cannot follow, so the model, not the skeleton, decides the grouping when a key is set.

Everything below is settled. Stage 6 (`docs/brief-stage-6.md`) shipped the layer budget and the trailing generated group; keep its budget table and its merge loop as the fallback path.

## 1. Reading order and roles

- New role rank: `migration` 0 (SQL migrations, migration scripts, Prisma/Drizzle migration files, but not `/migrations/meta/` snapshots), `contract` 1, `server` 2, `ui` 3, `other` 4, `docs` 5, `config` 6, `generated` 7, tests attach.
- Migrations form the first layer, named `Database migrations` in the fallback; snapshots and lockfiles stay in the trailing `Generated` layer (rename from `Generated & migrations`), collapsed by default.
- Fallback names never repeat: when two layers would share a name, append the next distinguishing directory segment (`web · billing`, `web · profile`); when nothing distinguishes them, merge them. `Changes` is gone: a layer with no shared non-generic segment is named after its dominant role (`API changes`, `Web changes`, `Shared changes`).

## 2. Model-first grouping

When an OpenRouter key is set, the model proposes the grouping; the skeleton is only the fallback (no key, Nano unavailable, model error).

- Input: the condensed file list (every reviewable file with role, +/- counts and signals as today) plus the PR title/body, and the instruction: `Group these files into between 1 and N layers a reviewer reads in order. Put database migrations and data-shape changes first, then contracts and types, then server logic, then UI, and tests next to the code they test. Every file appears in exactly one layer. Name each layer with a short imperative phrase (max 6 words) and one sentence saying what to look for. Fewer, larger layers are better than many small ones.` N is the stage 6 budget.
- Strict response schema: `{ layers: [{ name, summary, files: string[] }] }`, all required, `additionalProperties: false`.
- Validation (`applyGrouping`): drop unknown paths; a file listed twice stays in its first layer; files the model forgot are appended to the layer with the most files from the same directory (else the last layer); empty layers are removed; more than N layers are merged from the end into their predecessor; generated files always go to the trailing `Generated` layer regardless of the model. If validation leaves fewer than 1 layer or the response fails to parse, fall back to the skeleton.
- Cache key includes the labeler and a `grouping:v2` marker so old cached labels are ignored.
- Nano keeps the old label-only path (it cannot be trusted with grouping).

## 3. Sections inside GitHub's file tree (new "Files changed" page, `/changes`)

Facts from `fixtures/github-changes-page.html` (captured signed in, 2026-09-11):
- Tree: `ul[role="tree"][aria-label="File Tree"]` inside `[class*="FileTreeScrollable"]`. Directory items: `li[role="treeitem"][aria-expanded]` with `id` = directory path. File items: `li[role="treeitem"]` with `id` = full file path, `aria-label` = basename, containing `a[href="#diff-<sha256 of path>"]`. Classes are Primer React (`PRIVATE_TreeView-item`, `prc-TreeView-*`, level via `style="--level:N"` and one `PRIVATE_TreeView-item-level-line` per level).
- Diff sections: `div[role="region"][id="diff-<sha256>"]` inside `[data-testid="progressive-diffs-list"]`; 29 of 39 were placeholders without a header until scrolled into view (`content-visibility: auto`). Loaded headers contain `h3 a[href="#diff-…"] code` with the path and `button[data-file-path]`.
- Viewed control: `button[aria-pressed][aria-label="Viewed"|"Not Viewed"]` with a `MarkAsViewedButton-module__*` class in the loaded header; toggle by `click()`, state from `aria-pressed`.
- Progress: `[class*="ViewedFileProgress"]` shows `N / 39 viewed`.

Implementation:
- On `/changes` pages, do not mount the right-hand panel. Instead hide the native `ul[role="tree"]` (`display: none`, keep it in the DOM so GitHub's own state survives) and insert our own `ul` right after it, built by cloning native nodes as templates: clone one directory `li` for section rows and one file `li` for file rows, then rewrite `id`, `aria-label`, level lines, text and `href`. Sections are level 1 with `aria-expanded`; files are level 2. This keeps GitHub's exact look without depending on hashed class names.
- Section row content: the layer name in the normal item text, the summary as a second line in muted small text (`fgColor-muted`, 11px), and `3/7` viewed on the right in muted text. Completed sections get GitHub's check icon (clone the SVG from any native `Viewed` button when available; otherwise a `✓`).
- File rows: basename as in the native tree; the directory dimmed in a tooltip (`title`); viewed files use the same muted style GitHub uses for viewed tree entries (observe a native viewed file to copy its class list, otherwise `fgColor-muted` + strikethrough off).
- Clicking a file row sets `location.hash` to the anchor (GitHub scrolls and loads the placeholder) and marks it current. `j`/`k`/`n`/`p`/`v`/`r` keep working; `Enter` scrolls to the current file. The current file row gets `aria-selected="true"` and GitHub's selected styling (copy from a native item with `aria-selected="true"` when present; else a subtle `bg-neutral-muted` background).
- `Raw order` becomes a small toggle at the top of our list (`Layers` / `Files`); `Files` shows the native tree again and hides ours.
- Viewed sync: observe `[data-testid="progressive-diffs-list"]` for `aria-pressed` changes on the viewed buttons and header loads; map to paths through the section `id` (sha256 of path) since headers may not be loaded; counts update in the section rows; when a section completes, advance to the next one.
- Re-application: the React tree can re-render (filter box, toggles). A `MutationObserver` on the scrollable container re-hides the native tree and re-inserts ours if they disappear; keep our list's state in the existing store.
- The status line (`Layer names from …`) goes to a one-line muted footer under our list.
- Classic `/files` pages keep the current right-hand panel unchanged.

## 4. Verification

- Unit: role rank and first-layer migration placement; unique fallback names; `applyGrouping` validation cases (unknown path, duplicate path, forgotten file, too many layers, generated forced to trailing, empty response → fallback); condensed prompt contains the budget; cache key marker.
- jsdom: build the tree from a logged-in capture of the Changes page, trimmed to the tree and two diff entries in `fixtures/github-changes-tree.html`: native tree hidden, sections and files rendered with the expected anchors, viewed state read from `aria-pressed`, current row marked, `Files` toggle restores the native tree.
- Helium e2e: the classic page path stays green (`tooling/panel-e2e.mjs`). For the new page, the owner tests in their Helium; provide a precise manual script (open a PR at `/changes`, expect grouped sections in the left tree, click a section file, press `v`, watch the count, toggle `Files`).
- `bun run typecheck`, `bun run check`, `bun run test`, `bun run build`.
