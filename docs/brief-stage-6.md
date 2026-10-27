# detent for GitHub: brief for stage 6 (few layers, generated files out of the way)

Owner verdict on 2026-09-11 after the first real run (a 39-file billing pull request, +6774/-362 of which ~4000 lines are a migration snapshot): 15 layers for roughly 2000 real lines is unacceptable. Model labels were fine; the count was not. Settled decisions:

## 1. Budget

- `MAX_LAYERS` derived from the number of reviewable files (everything except generated and migration files): up to 12 files → 3 layers, 13–30 → 4, 31–60 → 5, more → 6. Never more than 6. Never fewer than 1.
- Reviewable file count excludes the trailing group below; a PR whose reviewable files all belong together produces one layer plus the trailing group.

## 2. Trailing group

- Role `generated` (lockfiles, snapshots, `*.gen.*`, `/dist/`, `/migrations/meta/`, minified) and role `migration` (new: `/migrations/*.sql`, `/migrations/**/*.{ts,js}` that are not under `meta`, `*.migration.*`, `prisma/migrations/**`) go to one trailing layer named `Generated & migrations`, collapsed by default in the panel (a collapsed layer shows the name, the file count and an expand chevron; expanding lists the files). Its files are dimmed on the page like any other non-current layer and are skipped by `j`/`k` unless the layer is expanded or current.
- Reading order still ends with it; `n` reaches it as the last layer.
- Config and docs keep attaching to the closest layer as today; when there is none, they join `Generated & migrations` instead of a separate `Configuration` layer.

## 3. Merging down to the budget

After union-find components and the existing oversized split, while `layers.length > MAX_LAYERS`:

1. Merge the smallest layer into the layer it has the most edges to (either direction). Ties: the neighbour with the longest shared directory prefix, then the earlier one in order.
2. If it has no edges, merge into the layer with the longest shared directory prefix; if that is zero segments beyond the repo root, merge into the smallest other layer.

Merged layers keep the rank of the earlier one and re-sort files by role rank then path. Fallback names are recomputed after merging (the common directory of the merged set; `Changes` when nothing is shared).

Tests must be attached after merging, so a layer's tests follow the code they test.

## 4. Model contract

- The condensed input states the budget: `Name between 1 and N layers. You may merge layers by returning several skeleton ids in one entry, never split one.` where N is `MAX_LAYERS`.
- `LabelEntry` gets an optional `mergeIds: string[]` (strict schema: required, may be empty). `applyLabels` merges the listed skeleton layers into the entry's layer (files appended, re-sorted by role rank), ignoring unknown or already-consumed ids. A merge that leaves more than `MAX_LAYERS` layers is impossible by construction; one that reduces below 1 is ignored.
- The system prompt adds: `Prefer fewer, larger layers. Group by what a reviewer needs to understand together, not by directory.`

## 5. Expected outcome on the fixtures

- `fixtures/tessera-165.diff` (26 files): 4 layers at most; `web` and the contract/api layers as today, but the `github-import · presentation` two-file layer is merged into `api · github-import`.
- `fixtures/tanstack-router-8170.diff` (36 files): 5 layers at most, `pnpm-lock.yaml` and `routeTree.gen.ts` in `Generated & migrations`.
- A new fixture for the owner's case is not available (private repo); write a synthetic unit test with 39 paths mirroring its shape (env schema, 2 migration files + 2 snapshot files, 14 billing application files, 4 billing infrastructure, 6 web files, tests next to each) and assert the reviewable count is 35, `MAX_LAYERS` is 5, and the result has at most 5 layers plus the trailing group.

## 6. Verification

Unit tests for the budget table, the migration role, the trailing group, the merge loop (edges, prefix, smallest fallback), `mergeIds` handling, and the fixture expectations above. `bun run typecheck`, `bun run check`, `bun run test`, `bun run build`, then the Helium e2e (`PROBE_EXECUTABLE="/Applications/Helium.app/Contents/MacOS/Helium" bun tooling/panel-e2e.mjs`) must still pass; its printed layer list for tessera-165 must have at most 4 entries plus `Generated & migrations` if present.
