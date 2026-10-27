# detent for GitHub: brief for stage 8 (clean tree rows, diffs grouped and reordered by layer)

Owner feedback on 2026-09-11 after stage 7 on a 39-file billing pull request (`/changes` page, Helium):
1. Section rows in the tree overlap: name and summary are drawn on top of each other. Ugly, unacceptable.
2. Dimming everything is wrong. The diff list itself must be reordered into layer order and shown group by group, with only the diffs that do not belong to the current section dimmed (they end up below).

Settled decisions.

## 1. Tree rows

- A section row is a single line, exactly like a native directory row: name on the left, `viewed/total` on the right in muted text, check icon when complete. No summary inside the row. Do not override the container height.
- The summary is rendered as its own block **after** the Primer item container (`div[style*="--level"]`) and before the nested `ul[role="group"]`, inside the same `li`. Build it by cloning the item container so it inherits the exact grid geometry and spacer width, then empty the toggle and visual cells, replace the text cell with the summary (`fgColor-muted`, 11px, `white-space: normal`, `line-height: 1.35`, `padding-bottom: 4px`) and set `height: auto` only on that clone. Result: the summary sits under the name, aligned with it, wrapping over two or three lines without touching the row.
- File rows unchanged (basename, anchor, muted when viewed).
- Keep `Layers` / `Files` at the top; style it with Primer React classes seen on the page (`prc-Button-ButtonBase-9n-Xk`, `data-size="small"`, `data-variant="default"`/`"invisible"`) instead of `btn`/`BtnGroup`, which do not exist on the React page. Copy the class list of any small native button at runtime (`button[data-size="small"]`), the same way tree rows are cloned.

## 2. Diffs grouped and reordered

The diffs list `[data-testid="progressive-diffs-list"]` is a flex column. Never move its children (React owns them); use CSS `order` on the entry wrappers (`[class*="diffEntry"]`, one per file, each containing `div[role="region"][id="diff-<sha256>"]`).

- For layer `L` at index `i` and file at index `f` inside it: `wrapper.style.order = i * 1000 + f + 1`. Files unknown to the layers (should not happen) get `order = 999000 + position`.
- Insert one section header element per layer into the same flex container, with `order = i * 1000`, so it precedes its files. The header is ours (`data-detent-section`), built once and re-inserted if React drops it. Markup: a `div` styled like GitHub's diff file header bar (clone `[class*="diffHeaderWrapper"]`'s padding and border through the same class names when present, otherwise `border-bottom: 1px solid var(--borderColor-default); padding: 8px 16px`), containing the layer index and name in `text-bold`, the summary on a second line in `fgColor-muted`, and `viewed/total` on the right. Sticky is not required.
- Dimming: only entries whose layer is not the current one get `opacity: .45`; the current section's entries are fully visible. Headers of other sections are dimmed too. `Files` mode removes `order` (set to `''`), hides our headers and removes dimming.
- Re-application: React rewrites the wrapper `style` attribute when it loads a placeholder (`content-visibility`, `contain-intrinsic-size`). Observe the list for `childList` and attribute `style` changes, coalesce per frame, and re-apply `order`, dimming and headers only where they differ. Never fight React within the same frame more than once.
- Scrolling to a file (`Enter`, `j`/`k`, clicking a tree row) keeps using the hash anchor; after the hash change, if the region is not at the expected place because of `order`, scroll to its bounding rect with the sticky header offset (existing helper).
- The trailing `Generated` layer is placed last and starts collapsed in the tree; in the diff list its entries are simply last and dimmed until it becomes current.

## 3. Verification

- jsdom tests on the trimmed changes fixture: section row has no summary inside the item container and a summary block after it; `order` assignment for a two-layer state; headers inserted with the right `order`; dimming only outside the current layer; `Files` mode clears `order`, hides headers and removes dimming; a simulated React `style` rewrite is re-applied.
- `bun run typecheck`, `bun run check`, `bun run test`, `bun run build`, Helium e2e for the classic page still green.
- Manual script for the owner: on `/changes`, the first section's diffs are at the top under a header with its name and summary; later sections follow, dimmed; tree rows are single-line with the summary under them, no overlap; `n` moves the highlight and the fully visible group; `Files` restores GitHub's order.
