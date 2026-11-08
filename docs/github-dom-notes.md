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

## Pull request size

Read before anything heavy runs, to decide whether detent waits for a click (`src/lib/panel/large-pull-request.ts`).

- Classic page, observed 2026-11-04 logged out on `https://github.com/TanStack/router/pull/8658/files` (trimmed copy in
  `fixtures/github-files-header.html`): the tab link `a[href="/<owner>/<repo>/pull/<n>/files"]` holds
  `span#files_tab_counter.Counter[title="570"]`, and the same `.tabnav` holds `#diffstat` with `.color-fg-success`
  (`+5,792`) and `.color-fg-danger` (`−5,344`). The link's href ties the counter to the pull request, so a counter left
  from the previous page after a soft navigation is not read.
- Changes page (logged in): the file tree's `ViewedFileProgress-module__ProgressContainer` is followed by
  `.sr-only` "0 of 39 files viewed" (verified in `fixtures/github-changes-tree.html`). A counter inside a
  `/changes` tab link and a pull request level "Lines changed: N additions & M deletions" are also read, but neither is
  verified on a real logged-in page. Every file header carries its own "Lines changed" line; those inside
  `[data-diff-header-wrapper]` are skipped.
- The tree carries nothing that names its pull request, so nothing is read until the page has a tab link
  `a[href="/<owner>/<repo>/pull/<n>/files"]` or `…/changes` for the pull request in the URL, with or without a
  counter. A tree left from the previous pull request is therefore not read while its own tab bar is still shown.
  Whether the logged-in Changes page has such a link is not verified; without one every pull request there counts
  as large.
- At or under 300 files the line count decides, so a file count without one keeps the wait going. When the page
  shows no complete size within 5 s, the pull request counts as large.


## Merge conflicts on pull request lists

Read by `src/lib/list/conflicts.ts`; observed 2026-11-07 logged out on `TanStack/router`, where the REST API reported
#8842 and #8829 as `mergeable: false, mergeable_state: "dirty"`.

- Source: `GET https://github.com/<owner>/<repo>/pull/<n>/page_data/merge_box?merge_method=REBASE&bypass_requirements=false`,
  the JSON GitHub's React merge box loads (route name `mergeBox: "merge_box"` in the PR page bundle). The bundle
  reads `pullRequest.state`, `pullRequest.mergeStateStatus` (GraphQL `MergeStateStatus`: `DIRTY` is a conflict,
  `UNKNOWN` still computing), `pullRequest.headRefOid`/`baseRefName`, and `mergeRequirements.conditions[]` with
  `type: "PULL_REQUEST_MERGE_CONFLICT_STATE"`, `result` and a `conflicts` list of files. The response shape comes
  from reading the bundle; the endpoint answers `404 {"error":"Not Found"}` to a signed-out visitor, so it is not yet
  checked against a real signed-in answer.
- The query matters. The merge box hook builds it as
  `e.append("merge_method",g),e.append("bypass_requirements",f.toString())` with `g` the method selected in the
  merge box, which starts at the page payload's `defaultMergeMethod` (`"SQUASH"` on `Mnigos/detent`, present even
  signed out; `MERGE` when that is missing). Changing the method invalidates the merge box query and asks again, so
  the server checks the conflict condition for the asked method. detent first asked without the parameter and showed
  nothing on a `Mnigos/soonlane` pull request where GitHub said "This branch cannot be rebased due to conflicts"
  (the answer itself was not captured), so detent now always asks for `REBASE`.
- Rebase: the conflicts section of the bundle (`44-*.js` on github.githubassets.com, checked 2026-11-09) decides
  `if("BEHIND"===t)return"OUT_OF_DATE";if("UNKNOWN"===t)return"PENDING";if("FAILED"===n.result&&0===s.length)return"HAS_REBASE_CONFLICTS";`
  … `"DIRTY"===t&&"FAILED"===n.result` → `"HAS_CONFLICTS"`, with `t` the merge state status, `n` the conflict
  condition and `s` its `conflicts` list. `HAS_REBASE_CONFLICTS` is the heading "This branch cannot be rebased due
  to conflicts". detent keeps that order: `DIRTY` is **Conflicts**, `UNKNOWN` asks again later, `BEHIND` (GitHub
  says only "out of date") gets no marker; otherwise a failed condition with conflicting files is **Conflicts** and
  one with none is **Can't rebase**. `DIRTY` is GraphQL's status
  for the merge commit, which does not take the method, so asking for `REBASE` still finds real conflicts.
- Merge methods: `pullRequest.viewerMergeActions[]` (`name`: `DIRECT_MERGE`, `AUTO_MERGE`, `MERGE_QUEUE`) each carry
  `mergeMethods[]` of `{name: "MERGE"|"SQUASH"|"REBASE", allowableStatus}`. The merge button offers a method when
  its status is `ALLOWED` or `ALLOWED_WITH_BYPASS`; the update branch menu also lists `UNAVAILABLE` ones, greyed out
  with "This branch cannot be rebased at this time.". A `PULL_REQUEST_MERGE_METHOD` condition is among the
  repository-level requirements that fail. detent hides **Can't rebase** when that condition failed or when the
  listed methods have no `REBASE` in one of those three statuses; with no methods listed (a viewer who cannot merge)
  it shows the marker. Which status a repository with rebase merging turned off reports is not checked.
- Signed out: the PR page renders no merge box ("Sign up for free to join this conversation"), the embedded React
  data carries only live-update channel names (`mergeboxChannels`, `gitMergeStateChannel`), the hovercard
  (`/pull/<n>/hovercard`, 5 KB) and the list page's own payload say nothing about conflicts, and `merge_box`,
  `merge_request_status`, `status_checks` under `page_data/` all answer 404. Other `page_data/` routes do answer
  signed out (`diffstat` 74 B, `tab_counts`, `timeline`, `description`, `labels`). `meta[name="user-login"]` is empty
  for a signed-out visitor, which is how detent skips the requests.
- Not used: `api.github.com/repos/<o>/<r>/pulls/<n>` has `mergeable`/`mergeable_state` and sends
  `Access-Control-Allow-Origin: *`, but without a token it allows 60 requests an hour per IP (two list pages),
  answers 404 for a private repository because it does not take the github.com session, and returns
  `mergeable: null` until GitHub has computed it.
- The list row's state icon is the leading `svg.octicon`: `octicon-git-pull-request` (aria-label "Open pull
  request"), `octicon-git-pull-request-draft` ("Draft pull request"), `-closed`, or `octicon-git-merge`. Only the first
  two are asked about.
