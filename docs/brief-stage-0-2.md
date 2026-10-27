# detent for GitHub: brief for stages 0-2 (scaffold, Nano smoke test, diff data, layer skeleton)

Proof of concept of a Chrome extension that splits a GitHub pull request's "Files changed" page into named layers in reading order. Plan of record: the proof-of-concept plan (kept outside this repository). This brief covers stages 0, 1 and 2 only. Stages 3 (Gemini Nano labeling) and 4 (panel and navigation) are briefed separately after the smoke test.

## Settled decisions

1. Project root: the repository root (git already initialised, `fixtures/` present). Package manager and runner: Bun. No npm, no yarn.
2. Stack: WXT 0.21 with `@wxt-dev/module-react`, React 19, TypeScript strict, Tailwind v4 through `@tailwindcss/vite`, Vitest (use WXT's `WxtVitest` plugin from `wxt/testing`), Biome for lint and format (2-space? no: tabs, single quotes, no semicolons, to match the owner's other repos). Keep dependencies minimal.
3. Manifest (via `wxt.config.ts`): name `detent for GitHub`, MV3, `host_permissions: ["https://github.com/*"]`, `permissions: ["storage"]`. Add `offscreen` only if stage 0 proves it necessary (see below).
4. Entrypoints: `entrypoints/background.ts` (service worker), `entrypoints/github.content.ts` (matches `https://github.com/*/*/pull/*`, `runAt: 'document_idle'`), `entrypoints/popup/` (React, used for the Nano smoke test). The content script in this stage only logs the parsed pull request URL and the parsed diff summary to the console; the panel UI is stage 4.
5. All domain logic lives in `src/lib/**` as pure functions with unit tests. No React in `src/lib`.
6. Cache key is content-addressed: `sha256(diffText)` (Web Crypto), not the head SHA. Not used yet in these stages beyond exposing a helper.

## Stage 0: Gemini Nano smoke test

Goal: learn, empirically, in which extension context `LanguageModel` (Chrome Prompt API, Chrome 138+) is usable, and that a schema-constrained prompt returns JSON.

- Popup shows a button `Check Gemini Nano`. Clicking sends a message to the background service worker, which runs:
  1. `typeof LanguageModel` and `await LanguageModel.availability()`.
  2. If the result is `available` or `downloadable` or `downloading`: `const session = await LanguageModel.create({ initialPrompts: [{ role: 'system', content: 'You label groups of changed files in a pull request.' }], monitor(m) { m.addEventListener('downloadprogress', ...) } })`, then `session.prompt(input, { responseConstraint: schema })` where `input` is a small hard-coded description of three files, and `schema` is a JSON Schema for `{ layers: [{ name: string, summary: string, files: string[] }] }`. Report `session.contextWindow`, `session.contextUsage`, elapsed ms and the raw response.
  3. Every step reports success or the thrown error message; the popup renders the report as a `<pre>` with a `Copy` button.
- The popup also runs the same `typeof LanguageModel` and `availability()` check in its own context and shows both results side by side (`popup` vs `service worker`).
- If `LanguageModel` is undefined in the service worker, implement the fallback through an offscreen document (`chrome.offscreen.createDocument` with reason `WORKERS` or `DOM_PARSER`, whichever Chrome accepts for this) and repeat the check there; report which context worked. Only add the `offscreen` permission if you implement this path.
- Type the API locally in `src/types/language-model.d.ts` (a minimal ambient declaration for `LanguageModel.availability`, `create`, `prompt`, `promptStreaming`, `contextWindow`, `contextUsage`, `destroy`). Do not add a third-party types package.

## Stage 1: pull request data

- `src/lib/pull-request-url.ts`: `parsePullRequestUrl(url: string): { owner, repo, number, tab: 'conversation' | 'commits' | 'checks' | 'files' } | undefined`. Handles `/pull/123`, `/pull/123/files`, `/pull/123/files/<sha>`, `/pull/123/commits`, trailing slashes, query strings and hashes.
- `src/lib/diff/fetch-diff.ts`: `fetchPullRequestDiff({ owner, repo, number })` does `fetch('https://github.com/{owner}/{repo}/pull/{number}.diff', { credentials: 'include' })`, throws a typed error with status on non-200, returns the text. Nothing else.
- `src/lib/diff/parse-diff.ts`: `parseUnifiedDiff(text: string): DiffFile[]` where
  ```ts
  interface DiffFile {
  	path: string            // new path, or old path for deletions
  	oldPath?: string        // set for renames
  	status: 'added' | 'modified' | 'deleted' | 'renamed'
  	isBinary: boolean
  	additions: number
  	deletions: number
  	hunks: DiffHunk[]
  }
  interface DiffHunk {
  	oldStart: number; oldLines: number; newStart: number; newLines: number
  	header: string          // text after @@ ... @@
  	addedLines: string[]    // without the leading '+'
  	removedLines: string[]  // without the leading '-'
  }
  ```
  Must handle: `diff --git a/x b/x`, `new file mode`, `deleted file mode`, `rename from/to` with `similarity index`, `Binary files ... differ`, `--- /dev/null`, `\ No newline at end of file`, paths with spaces are out of scope (note it). Use the three fixtures in `fixtures/` as test inputs and assert exact file counts, a few statuses, and additions/deletions for two known files (compute the expected numbers from the fixture with `grep`, do not guess).
- `src/lib/diff/digest.ts`: `digestText(text: string): Promise<string>` returning hex SHA-256 via `crypto.subtle`.

## Stage 2: layer skeleton (deterministic, no model)

- `src/lib/layers/roles.ts`: `classifyRole(path: string): FileRole` with `FileRole = 'contract' | 'server' | 'ui' | 'test' | 'config' | 'generated' | 'docs' | 'other'` and `ROLE_RANK: Record<FileRole, number>` = contract 0, server 1, ui 2, other 3, docs 4, config 5, generated 6 (test has no rank: tests attach to the layer they test). Rules, first match wins:
  - generated: lockfiles (`bun.lock`, `bun.lockb`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `Cargo.lock`), `*.snap`, `*.gen.*`, `*.generated.*`, `/dist/`, `/build/`, `/migrations/meta/`, `routeTree.gen.ts`, minified `*.min.*`.
  - test: `*.spec.*`, `*.test.*`, `/__tests__/`, `/tests/`, `/e2e/`.
  - docs: `*.md`, `*.mdx`, `/docs/`.
  - config: `package.json`, `tsconfig*.json`, `*.config.*`, `.github/`, `Dockerfile`, `*.yml`/`*.yaml`, `.env*`, `biome.json`, `railway.json`.
  - contract: `/contracts/`, `/schema/`, `/schemas/`, `/migrations/`, `*.contract.*`, `*.schema.*`, `*.types.*`, `types.ts`, `*.d.ts`, `*.proto`, `*.graphql`, `/domain/` (domain models are contracts for the rest).
  - server: `/api/`, `/server/`, `/services/`, `/backend/`, `/infrastructure/`, `/application/`, `/presentation/`, `*.service.*`, `*.controller.*`, `*.repository.*`, `*.processor.*`, `*.rs`, `*.go`, `*.py` (non-UI).
  - ui: `*.tsx`, `*.jsx`, `*.vue`, `*.svelte`, `*.css`, `/components/`, `/routes/`, `/pages/`, `/app/`, `/web/`, `/hooks/`.
  - other: everything else.
  Note the order matters: a `*.spec.tsx` under `/components/` is `test`, not `ui`.
- `src/lib/layers/graph.ts`: `buildEdges(files: DiffFile[]): Edge[]` with `Edge = { from: string; to: string; kind: 'import' | 'identifier' }` meaning `from` depends on `to`.
  - import edges: for each added line matching an import or require (`import ... from '<spec>'`, `import '<spec>'`, `require('<spec>')`, `export ... from '<spec>'`, Rust `use crate::...` is out of scope), resolve `<spec>` against the other changed files by path suffix after stripping extensions and `index` files (`../hooks/use-x` matches `apps/web/src/modules/x/hooks/use-x.ts`); alias imports like `@/`, `@modules/`, `~/` match by the part after the alias. Ambiguous matches (more than one file) create no edge.
  - identifier edges: collect exported identifiers declared in added lines (`export (const|let|function|async function|class|interface|type|enum) (\w+)` and `export { A, B }`); for every other file whose added lines contain that identifier as a whole word, add an edge from that file to the declaring file. Ignore identifiers shorter than 4 characters and a small stop list (`Props`, `Input`, `Output`, `State`, `Error`, `Route`, `default`).
- `src/lib/layers/build-skeleton.ts`: `buildSkeleton(files: DiffFile[], edges: Edge[]): Skeleton`:
  ```ts
  interface SkeletonLayer { id: string; fallbackName: string; files: { path: string; role: FileRole }[]; rank: number }
  interface Skeleton { layers: SkeletonLayer[]; edges: Edge[] }
  ```
  Algorithm:
  1. Remove tests, generated, docs and config files from the graph pass; they are attached afterwards.
  2. Connected components over the remaining files using edges (union-find). Each component is a candidate layer. A component with more than 12 files is split by its deepest common directory prefix into sub-layers (one split level is enough).
  3. Layer rank = minimum `ROLE_RANK` among its files. Order layers by rank, then by dependency (if any file in A is imported by a file in B, A before B; resolve with a topological sort over layer-level edges, breaking cycles by rank then name), then by first path.
  4. Attach each test file to the layer containing the file it tests (same path with `.spec`/`.test` removed and `/__tests__/` stripped); if none, to the layer sharing the longest directory prefix; if none, to a trailing `Tests` layer.
  5. Docs and config files: attach to the layer sharing the longest directory prefix if that prefix has at least two segments beyond the repo root; otherwise a trailing `Configuration` layer. Generated files always go to a trailing `Generated` layer.
  6. Within a layer, order files by role rank, tests last, then path.
  7. `fallbackName`: the one or two most specific shared directory segments that are not generic (`src`, `lib`, `modules`, `app`, `apps`, `packages`, `index`), joined with ` · `, e.g. `contracts · github-import`, `api · github-import`, `web · github-import`, `Generated`, `Configuration`, `Tests`. `id` = stable slug of the sorted file paths' digest prefix (8 hex chars of SHA-256 of the joined paths; a synchronous non-crypto hash is fine here, e.g. FNV-1a).
- Tests (Vitest): table-driven `classifyRole` cases (at least 20 paths, including the order-sensitivity case); `buildEdges` on the tessera-165 fixture must include an edit-free assertion that `apps/web/src/modules/github-import/components/github-import-source-selector.tsx` depends on `apps/web/src/shared/components/search-input.tsx` and that `apps/api/src/modules/github-import/application/github-import.service.ts` depends on `apps/api/src/modules/github-import/infrastructure/github-octokit.client.ts`; `buildSkeleton` on tessera-165 must put the layer containing `packages/contracts/src/github-import.contract.ts` before any layer containing `apps/web/...` files, attach `github-octokit.client.spec.ts` to the layer of `github-octokit.client.ts`, and put `bun.lock` (if present) or any generated file into the trailing `Generated` layer; on tanstack-router-8170 assert the layer count is between 2 and 8 and every file appears exactly once across layers. Every fixture-based assertion must be checked against the fixture with `grep` before it is written.

## Repository hygiene

- `.gitignore` for `node_modules`, `.output`, `.wxt`, `dist`, `.DS_Store`.
- `README.md`: two paragraphs (what it is, how to run: `bun install`, `bun run dev`, load `.output/chrome-mv3` unpacked, `bun run test`, `bun run check`).
- Scripts: `dev`, `build`, `test` (`vitest run`), `check` (`biome check .`), `check:fix`, `typecheck` (`tsc --noEmit`).
- Conventional commits, one per stage (`chore: scaffold`, `feat: nano smoke test popup`, `feat: fetch and parse pull request diffs`, `feat: deterministic layer skeleton`). No `Co-Authored-By` lines.

## Code bar

Self-documenting code; comments only for a why the code cannot show, one line, at most four per file. No one-use helpers, no wrappers for later, no generics with one call site. No `useEffect` in React code (the popup needs none: state set in click handlers). Files under 250 lines. `bun run typecheck`, `bun run check`, `bun run test` must all pass before the final report.
