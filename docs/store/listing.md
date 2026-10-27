# Chrome Web Store listing

Everything below is ready to paste into the developer dashboard.

## Basics

- **Name:** detent for GitHub
- **Category:** Developer Tools (in the Productivity group)
- **Language:** English
- **Visibility for the first release:** Unlisted (anyone with the link can install; no search listing)

## Short description (132 characters max)

The store shows the manifest `description` from `wxt.config.ts` as the summary; keep both the same.

Review GitHub pull requests in ordered layers, rank files by review risk, and see diff sizes on pull request lists.

## Full description

detent changes how you read a GitHub pull request, and shows how big each pull request is before
you open it.

Layers. The changed files are grouped into review steps instead of one alphabetical list: one
behavior change per step, with the data shape first, then the code that implements it, then its
tests and docs. Each step has a title and one sentence saying what to verify, and counts how many
of its files you already marked as viewed. Steps and files follow their dependencies, so you read
definitions before callers.

Priority Review. On GitHub's new Changes page the file tree gets three modes: Layers, Priority and
Files. Priority sorts the files into Urgent (at most 10), High, Medium and Low, with a one-line
reason on the Urgent and High ones, so a reviewer short on time knows what to read first. Low
starts folded.

Diff size on pull request lists. On a repository's pull request list every row shows
+additions −deletions · N files.

On the pull request page:

- On the Changes page: the Layers | Priority | Files switch in GitHub's file tree, section headers
  between the steps and a step badge in every sticky file header.
- On the classic Files changed page: a side panel with the steps and their files.
- The active step is the first one with unviewed files. Finished steps are dimmed.
- Keyboard: j and k move between files, n and p between steps, Enter scrolls to the file, v marks
  it as viewed, r switches to GitHub's own order.

A model is optional. Add an OpenRouter API key in the popup and pick a model: it names and orders
the steps, following a description that tells reviewers where to start, and ranks the files for
Priority Review. It is asked once per pull request revision and the answers are cached in the
browser. Without a key the steps come from the file structure and the priorities
from file paths and change sizes, computed locally. The popup shows what your requests cost so
far, and has switches to turn detent off or to hide the list diff sizes.

What leaves the browser: diffs are downloaded from GitHub with your GitHub session. Only when you
saved an OpenRouter key, the title, description, changed file paths and diff excerpts of the pull
request you open go to OpenRouter under that key. Diff sizes on lists never go to OpenRouter.
There is no detent server and no analytics.

Source code (GPL-3.0): https://github.com/Mnigos/detent

## Permission justifications

- **storage**: keeps the settings (OpenRouter key, model, two switches), cached step groupings
  and priority rankings per pull request revision, cached diff sizes for pull request lists, and a
  local usage counter in the browser. Session storage holds the review position of the open pull
  request.
- **Host permission `https://github.com/*`**: the extension renders inside GitHub pull request
  pages and pull request lists. It matches the whole site because GitHub moves between pages by
  in-page navigation, where a script matched only on `/pull/` or `/pulls` URLs would never run. On
  other pages it only watches the URL. The service worker downloads each pull request's diff from
  `https://github.com/<owner>/<repo>/pull/<number>.diff`: for the open pull request to build the
  steps, and for each pull request listed on a `/<owner>/<repo>/pulls` page to count its additions,
  deletions and files.
- **Host permission `https://patch-diff.githubusercontent.com/*`**: GitHub redirects those diff
  downloads to this host, which sends no CORS headers for the page, so the service worker follows
  the redirect itself.
- **Host permission `https://openrouter.ai/*`**: sends the optional model requests (step grouping
  and Priority Review ranking) with the user's own key.
- **Remote code:** none. All code ships in the package.

## Data usage disclosure (Privacy practices tab)

- Collects: **website content** (pull request diffs, titles and descriptions) and **authentication
  information** (the user's own OpenRouter API key). Both stay in the browser unless the user saved
  a key; then the website content of the open pull request is sent to OpenRouter with that key as
  the bearer token. Pull request numbers and diff counts kept in local caches never leave the
  browser.
- Not collected: personally identifiable information, health, financial or payment information,
  personal communications, location, web history, user activity.
- Certifications: not sold to third parties; not used or transferred for purposes unrelated to the
  single purpose; not used or transferred to determine creditworthiness or for lending.
- Privacy policy URL: https://github.com/Mnigos/detent/blob/main/PRIVACY.md

## Single purpose statement

Helps review GitHub pull requests: groups a pull request's files into ordered review steps, ranks
them by review priority, and shows the diff size of each pull request on pull request lists.

## Assets

- Icon 128×128: `docs/store/icon-128.png` (also shipped in the package under `icon/`).
- Small promo tile 440×280: `docs/store/promo-440x280.png`.
- Screenshots 1280×800, in this order:
  1. `docs/store/screenshot-1-layers.png`: "A pull request split into review steps, in reading
     order."
  2. `docs/store/screenshot-2-navigation.png`: "Move file by file with j and k; the panel follows
     the diff."
  3. `docs/store/screenshot-3-next-layer.png`: "Jump to the next step with n."
  4. `docs/store/screenshot-4-list-stats.png`: "Additions, deletions and file count on every row of
     a pull request list."
  5. `docs/store/screenshot-5-priority.png`: "Priority Review: the files to read first, from Urgent
     to Low."

Screenshots 1 to 4 come from `bun run build && node tooling/store-screenshots.mjs` (logged out,
public repositories, Helium, dark theme, layers named from the file structure). Screenshot 5 needs
a logged-in session on the Changes page and is captured separately.

## Release steps

1. For a later release, bump `version` in `package.json` (the manifest takes it from there). The
   first release ships as 0.1.0.
2. `bun run typecheck && bun run check && bun run test`.
3. `bun run build && bun run zip` → `.output/detent-for-github-<version>-chrome.zip`.
4. In the dashboard: upload the zip; paste the full description, category and language; attach the
   icon, promo tile and the five screenshots in the order above.
5. Privacy practices tab: paste the single purpose statement, the permission justifications and
   the remote code answer, tick the data categories and certifications above, and set the privacy
   policy URL.
6. Distribution: Unlisted for the first release. Submit for review.
7. Tag the commit: `git tag v<version> && git push origin v<version>`.
