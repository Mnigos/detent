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

- Source: `GET https://github.com/<owner>/<repo>/pull/<n>/page_data/merge_box`, the JSON GitHub's React merge box
  loads (route name `mergeBox: "merge_box"` in the PR page bundle), and for some rows a second
  `…/merge_box?merge_method=REBASE&bypass_requirements=false` (see Rebase). The bundle reads `pullRequest.state`,
  `pullRequest.mergeStateStatus` (GraphQL `MergeStateStatus`: `DIRTY` is a conflict, `UNKNOWN` still computing),
  `pullRequest.headRefOid`/`baseRefName`, and `mergeRequirements.conditions[]` with
  `type: "PULL_REQUEST_MERGE_CONFLICT_STATE"`, `result` and a `conflicts` list of files. The response shape comes
  from reading the bundle; the endpoint answers `404 {"error":"Not Found"}` to a signed-out visitor, and no signed-in
  answer is captured in this repository (the fixtures are hand-written).
- The query matters. The merge box hook builds it as
  `e.append("merge_method",g),e.append("bypass_requirements",f.toString())` with `g` the method selected in the
  merge box, which starts at the page payload's `defaultMergeMethod` (`"SQUASH"` on `Mnigos/detent`, present even
  signed out; `MERGE` when that is missing). Changing the method invalidates the merge box query and asks again, so
  the server checks the conflict condition for the asked method. Asked without the parameter, GitHub uses its
  default and reports `DIRTY` for a merge conflict.
- History: detent first asked only without the parameter and showed nothing on a `Mnigos/soonlane` pull request
  where GitHub said "This branch cannot be rebased due to conflicts" (the answer itself was not captured). It then
  asked only for `REBASE` (commit `b96b472`), and on a private organization repository that merges with squash
  (rebase merging most likely off) two pull requests GitHub showed as "Merge conflicts" were stored as clean, one of
  them stored as conflicts by the build before. A `REBASE` answer on a repository that does not allow rebase merging
  does not report the conflict; most likely the `PULL_REQUEST_MERGE_METHOD` condition fails and the status is not
  `DIRTY` (the answer was not captured). Hence the two requests below; the cache key moved to `mergeConflicts:v3`, so
  the wrong `clean` entries under `mergeConflicts:v2` are not read.
- Conflicts come from the request without the parameter. detent keeps the bundle's order for the statuses (next
  point): `DIRTY` is **Conflicts**, `UNKNOWN` asks again later, `BEHIND` (GitHub says only "out of date") gets no
  marker. Two rules are detent's own: a failed `PULL_REQUEST_MERGE_METHOD` condition is unknown too (the answer is
  about a method the repository refuses, so it may hide a conflict; never read as clean), and a failed conflict
  condition is **Conflicts** even without conflicting files, as before `b96b472`. The bundle would call the latter
  `HAS_REBASE_CONFLICTS`; whether GitHub sends it without a merge method for a pull request that merges but does not
  rebase is not verified (the `Mnigos/soonlane` case above suggests it does not).
- Rebase: the conflicts section of the bundle (`44-*.js` on github.githubassets.com, checked 2026-11-09) decides
  `if("BEHIND"===t)return"OUT_OF_DATE";if("UNKNOWN"===t)return"PENDING";if("FAILED"===n.result&&0===s.length)return"HAS_REBASE_CONFLICTS";`
  … `"DIRTY"===t&&"FAILED"===n.result` → `"HAS_CONFLICTS"`, with `t` the merge state status, `n` the conflict
  condition and `s` its `conflicts` list. `HAS_REBASE_CONFLICTS` is the heading "This branch cannot be rebased due
  to conflicts". Only when the first answer is clean and lists `REBASE` as `ALLOWED` or `ALLOWED_WITH_BYPASS` for the
  viewer does detent ask again with `merge_method=REBASE`. That second answer is read the same way, except that a
  failed conflict condition without conflicting files is **Can't rebase**; a failed merge method condition, an
  error or an unusable body there is unknown, not clean. A refusal (401, 403, 404) of either counts as one.
- Rate limits: a 429, or a 403 with `Retry-After`, `X-RateLimit-Remaining: 0` or "rate limit" in its body, on the
  merge box, the `.diff` or the list data is not a refusal. GitHub's 429 may come without CORS headers, so the
  service worker can see only `TypeError: Failed to fetch`; during a pause, or within a minute of one GitHub's own
  answer started, that counts as the limit too, so network errors alone never chain one pause onto the next. The
  service worker checks the stored pause before each list request it starts, so the rebase follow-up, the 5xx
  retries and requests other tabs queued earlier are not sent during a pause either.
  Both list pools then pause for every tab (`rateLimitedUntil` in `chrome.storage.local`) for `Retry-After`, or a
  minute, doubled for each repeat within ten minutes of the last pause, up to ten minutes. Nothing is cached for a
  rate-limited row; after the pause the list asks again only for rows still without fresh data.
- Merge methods: `pullRequest.viewerMergeActions[]` (`name`: `DIRECT_MERGE`, `AUTO_MERGE`, `MERGE_QUEUE`) each carry
  `mergeMethods[]` of `{name: "MERGE"|"SQUASH"|"REBASE", allowableStatus}`. The merge button offers a method when
  its status is `ALLOWED` or `ALLOWED_WITH_BYPASS`; the update branch menu also lists `UNAVAILABLE` ones, greyed out
  with "This branch cannot be rebased at this time.". A `PULL_REQUEST_MERGE_METHOD` condition is among the
  repository-level requirements that fail. A viewer who cannot merge gets no methods listed, so detent makes no
  rebase request and shows no **Can't rebase** for them. Which status a repository with rebase merging turned off
  reports is not checked.
- Signed out: the PR page renders no merge box ("Sign up for free to join this conversation"), the embedded React
  data carries only live-update channel names (`mergeboxChannels`, `gitMergeStateChannel`), the hovercard
  (`/pull/<n>/hovercard`, 5 KB) and the list page's own payload say nothing about conflicts, and `merge_box`,
  `merge_request_status`, `status_checks` under `page_data/` all answer 404. Other `page_data/` routes do answer
  signed out (`diffstat` 74 B, `tab_counts`, `timeline`, `description`, `labels`). `meta[name="user-login"]` is empty
  for a signed-out visitor, which is how detent skips the requests.
- Drafts are not asked about since they are not ready to merge; a draft's earlier marker is not shown.
- Not used: `api.github.com/repos/<o>/<r>/pulls/<n>` has `mergeable`/`mergeable_state` and sends
  `Access-Control-Allow-Origin: *`, but without a token it allows 60 requests an hour per IP (two list pages),
  answers 404 for a private repository because it does not take the github.com session, and returns
  `mergeable: null` until GitHub has computed it.
- The list row's state icon is the leading `svg.octicon`: `octicon-git-pull-request` (aria-label "Open pull
  request"), `octicon-git-pull-request-draft` ("Draft pull request"), `-closed`, or `octicon-git-merge`. Only the first
  is asked about for conflicts; all four get diff stats.

## Request cost of pull request lists

Read by `src/lib/list/heads.ts`, `src/lib/list/request-queue.ts`, `src/lib/list/list-requests.ts` and
`src/list/mount.ts`; observed 2026-11-11 on `TanStack/router/pulls`, signed out (the owner saw the same embedded data
signed in). The owner hit GitHub 429s on a private organization list (about 18 open pull requests, two browser
profiles, frequent reloads), which is why the list asks as little as below.

- Head commits: the list page embeds its route data in
  `<script type="application/json" data-target="react-app.embeddedData">` inside `<react-app app-name="repo">`,
  at `payload.repoPullsDashboardContentRoute.results[]` (plus `currentPage`, `totalPages`, `totalCount`,
  `openCount`, `closedCount`). Each result has `number`, `headSha` (40 hex), `createdAt`, `updatedAt`, `state`
  (`REPO_PULL_REQUEST_STATE_OPEN`), `displayState` (`REPO_PULL_REQUEST_DISPLAY_STATE_OPEN` or `…_DRAFT`), `id`,
  `globalId`, `repoNameWithOwner` (`TanStack/router`), `permalink`, `title` and `commitHeadShaChannel` (a live-update
  channel, not the SHA). detent looks for objects with `number`, `headSha` and `repoNameWithOwner` anywhere in the
  data and keys them `owner/repo/number`, lower-cased; `updatedAt` is kept but decides nothing.
- The script still holds the first URL's data after GitHub navigates the list on the client (filters, pages), so its
  head commits are dated to `performance.timeOrigin` and trusted for 10 minutes. When rows near the viewport have no
  trusted head commit, detent asks once (at most every 10 minutes per URL) for the list URL with
  `Accept: application/json`, `X-Requested-With: XMLHttpRequest` and `GitHub-Verified-Fetch: true`; GitHub answers
  the same route JSON (`{"meta":…,"payload":{"repoPullsDashboardContentRoute":…}}`, about 30 KB for 25 rows), the
  request its own client makes on navigation. Those rows wait for that answer; when it has nothing for them, they
  fall back on the 10-minute stats cache.
- Diff stats are stored with their code line counts and the head commit (`diffStats:v2`, optional `headSha` field;
  an entry without code counts is dropped on read, and the old `diffStats` key is removed on install) and reused
  for 7 days while the row shows that commit, 10 minutes when either side has no commit. A failure is retried after
  10 minutes.
  Conflict states (`mergeConflicts:v3`) carry the head commit too: 10 minutes, or at once when the row shows another
  commit. The base branch moving is not visible in the list data, hence the time limit.
- Viewport: an IntersectionObserver with `rootMargin: "0px 0px 100% 0px"` on each row's `<li>`; only rows inside it
  are queued, in page order, and a waiting row that leaves it is dropped until it comes back. Cached rows render
  everywhere.
- One queue: the service worker sends the diffs, merge boxes and list data of every tab, three at a time with at
  least 150 ms between two starts, and shares one request among tabs asking for the same key. Each tab still runs
  at most three diff and three merge box requests of its own. A service worker fetch to `github.com` with the host
  permission sends the same cookies as the page, `SameSite=Strict` and `__Host-` ones included (checked 2026-11-11
  in headless Chromium against a local server mapped to `github.com`); it differs only in `Sec-Fetch-Site: none`
  instead of `same-origin`. GitHub answered `page_data/diffstat`, `page_data/tab_counts`, `page_data/merge_box` (404
  signed out) and the list JSON identically for both. A signed-in `merge_box` answer from the service worker was not
  checked; the pull request diff, fetched the same way, has always worked on private repositories.
- Requests on the 25-row first page of `TanStack/router` in a 1400×600 window (11 rows near the viewport; stubbed
  merge box, every third row conflicting, one in three unknown), from `tooling/list-conflicts-e2e.mjs`: first load 11
  diffs and 11 merge box requests; scrolling to the end 14 diffs and 16 merge box requests more; opened again within
  a minute 0 diffs and only the unknown rows near the viewport; opened again with every cache entry 15 minutes old
  and no new commits 0 diffs, 11 merge box requests, 0 list data requests. The build before asked 25 diffs and 30
  merge box requests on every load past the cache times (stats 10 minutes, conflicts 5), drafts included.
