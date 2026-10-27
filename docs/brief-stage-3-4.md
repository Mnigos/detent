# detent for GitHub: brief for stages 3-4 (Gemini Nano labeling, panel and navigation)

Builds on `docs/brief-stage-0-2.md` (scaffold, diff data, deterministic skeleton). Stage 3 depends on the stage 0 smoke test result recorded in `docs/nano-smoke-test.md`; the context that worked there (service worker or offscreen document) is where the model runs.

## Stage 3: layer labeling with Gemini Nano

1. `src/lib/layers/condense.ts`: `condenseForModel(skeleton, files, pullRequest: { title, body })` returns a compact text under a hard budget of 6000 characters: PR title, first 600 characters of the body, then per candidate layer: fallback name, files with role, and for each file up to 6 "signals" from added lines: exported declarations (`export function x(...)`, `export const X`), class/interface/type names, route paths, SQL statements' first words, test names (`it('...')`, `test('...')`). Larger PRs get fewer signals per file, never a truncated file list. The function is pure and unit-tested on the three fixtures (budget respected, every file name present).
2. `src/lib/layers/label-schema.ts`: JSON Schema for the model response:
   ```json
   { "type": "object", "required": ["layers"], "properties": { "layers": { "type": "array", "items": { "type": "object", "required": ["id", "name", "summary"], "properties": { "id": { "type": "string" }, "name": { "type": "string", "maxLength": 48 }, "summary": { "type": "string", "maxLength": 160 }, "moveFiles": { "type": "array", "items": { "type": "object", "required": ["path", "toLayerId"], "properties": { "path": { "type": "string" }, "toLayerId": { "type": "string" } } } } } } } } }
   ```
   plus `applyLabels(skeleton, response)`: validates ids exist, applies `moveFiles` only when both the path and the target layer exist (a move that would empty a layer is ignored), returns `LabeledLayer[]` with `name`, `summary`, `files`, and `source: 'model' | 'fallback'`.
3. `src/lib/model/nano.ts` (runs in the context proven by stage 0): `labelLayers(input: string, schema)`; system prompt (in `initialPrompts`): "You name the logical layers of a pull request for a code reviewer. Each layer gets a short imperative name (max 6 words) describing what the change does there, and one sentence explaining why a reviewer reads it at that point. Keep the given layer ids. Only move a file when it clearly belongs elsewhere." Use `responseConstraint: schema`. Timeout 20 s. Any failure returns `undefined` and the caller falls back to the skeleton names.
4. Messaging: the content script sends `{ type: 'label-layers', digest, input }` to the background; the background answers from cache (`chrome.storage.local`, key `layers:<digest>`, value `{ layers, source, createdAt }`) or from the model, then caches. Cache entries older than 30 days are dropped lazily on read.
5. Availability states surfaced to the UI: `available` (labels come from the model), `downloading` (show progress, use fallback names meanwhile, re-label when done), `unavailable` (fallback names, one-line hint in the panel footer: "Gemini Nano is not available in this Chrome; layer names come from the file structure.").

## Stage 4: panel and navigation

Layout: a fixed panel on the right edge of the `Files changed` page, 320 px wide, collapsible with `\`` (backtick) and a small handle; it must not cover GitHub's own review controls (offset below the sticky header, respect the page's `--sticky-header` height if present). Dark and light follow `data-color-mode` on `<html>`.

Contents, top to bottom:
1. Header: "detent" wordmark, layer progress `2 / 5`, a `Raw order` toggle (`r`).
2. Layer list: each layer as a row with index, name, summary (2 lines, ellipsis), `N files`, and a viewed counter `3/7`. The current layer is highlighted; completed layers get a check.
3. Current layer's file list: each file row shows the path (directory dimmed, basename normal), role badge, additions/deletions, and its viewed state mirrored from GitHub's checkbox.
4. Footer: model status line (see stage 3, item 5) and keyboard hints.

Behaviour:
- Reading order = layers in skeleton order, files in layer order. `j`/`k` move to the next/previous file in reading order, `n`/`p` move to the next/previous layer, `Enter` scrolls to the current file, `v` toggles the current file's GitHub `Viewed` checkbox. Keys are ignored when focus is in an input, textarea or contenteditable, or when GitHub's own dialogs are open.
- Scrolling to a file uses the file's anchor: `#diff-<sha256 hex of the path>` (GitHub's convention; verify against the page and note in the report if a fallback by `data-path`/`data-tagsearch-path` attributes is needed). If the file section is collapsed or virtualised and the anchor is missing, click GitHub's file-tree entry for that path as a fallback, then retry once.
- Viewed sync: observe GitHub's `Viewed` checkboxes (`MutationObserver` on the files container, matching by file path) so the panel's counters reflect real state; when the user marks the current file viewed (by `v` or by clicking GitHub's checkbox), advance to the next unviewed file; when a layer becomes fully viewed, advance to the next layer with a brief toast in the panel ("Layer 2 done. Next: Billing redirect coordination").
- Files outside the current layer are dimmed (`opacity: .45` on their file sections, transition 150 ms); `Raw order` disables dimming and hides the current-layer highlight while keeping the panel.
- State per PR (current layer/file, raw toggle) lives in the content script's module store, persisted in `chrome.storage.session` under the digest key so a reload keeps the position.
- No `useEffect`: DOM observation through callback refs or a small module-level store with `useSyncExternalStore`; keyboard through one `keydown` listener registered by the mount function and removed on unmount.

Out of scope for stage 4: hunk-level ranges, editing layers, comments, anything that writes to GitHub, Firefox.

## Verification for stages 3-4

- Unit: `condenseForModel` budget and coverage; `applyLabels` validation cases; store transitions (next/previous file and layer, viewed advancing, raw toggle).
- Manual, on `https://github.com/Mnigos/tessera/pull/165/files` and `/166/files` and `https://github.com/TanStack/router/pull/8170/files` (public, logged out is fine for these): panel renders, labels appear (model or fallback), `j`/`k`/`n`/`p`/`v`/`r` work, dimming follows the layer, position survives reload. Record screenshots in `docs/screenshots/`.
- `bun run typecheck`, `bun run check`, `bun run test`, `bun run build` all green.
