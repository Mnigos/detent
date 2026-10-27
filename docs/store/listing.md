# Chrome Web Store listing

Everything below is ready to paste into the developer dashboard.

## Basics

- **Name:** detent for GitHub
- **Category:** Developer Tools
- **Language:** English
- **Visibility for the first release:** Unlisted (anyone with the link can install; no search listing)

## Short description (132 characters max)

Review GitHub pull requests in layers: files grouped into review steps, in reading order, named by a model you choose.

## Full description

detent turns the "Files changed" tab of a GitHub pull request into an ordered review.

Instead of one long alphabetical list, the changed files are grouped into review steps: one behavior
change per step, with the data shape first, then the code that implements it, then its tests and
docs. Each step has a title and one sentence saying what to verify, and a counter of how many of its
files you already marked as viewed. Steps and files are ordered by their dependencies, so you read
definitions before callers.

What you get on the pull request page:

- A "Layers" mode in GitHub's file tree, next to the plain "Files" mode.
- Section headers between the files of each step, and a small step badge in every sticky file header.
- The active step is the first one with unviewed files. Finished and inactive steps are dimmed.
- Keyboard navigation: j and k for files, n and p for steps, v to mark a file as viewed, Enter to jump.
- A pull request description that tells reviewers where to start is followed by the grouping.

Bring your own model. Add an OpenRouter API key in the popup and pick a model; the extension asks it
once per pull request revision and caches the answer. Without a key the steps come from the file
structure alone. The popup shows what your requests cost so far.

Works on the new "Changes" page and on the classic "Files changed" page. Nothing is sent anywhere
but GitHub and, when you configured a key, OpenRouter.

## Permission justifications

- **storage** — keeps the OpenRouter key, the chosen model, cached analyses per pull request
  revision and a local usage counter in the browser.
- **Host permission `https://github.com/*`** — the extension renders inside GitHub pull request
  pages. It matches the whole site because GitHub opens pull requests by in-page navigation from
  lists and notifications, where a script matched only on `/pull/` URLs would never run. On pages
  that are not a pull request it only watches the URL.
- **Host permission `https://patch-diff.githubusercontent.com/*`** — downloads the unified diff of
  the open pull request, which the grouping is computed from.
- **Host permission `https://openrouter.ai/*`** — sends the optional model request with the user's
  own key.
- **Remote code:** none. All code ships in the package.

## Data usage disclosure (Privacy practices tab)

- Collects: **website content** (pull request diffs and descriptions) and **authentication
  information** (the user's own OpenRouter API key, stored locally).
- Uses: only for the extension's single purpose. Not sold, not transferred for unrelated purposes,
  not used for creditworthiness or lending.
- Privacy policy URL: https://github.com/Mnigos/detent/blob/main/PRIVACY.md

## Single purpose statement

Groups the files of a GitHub pull request into ordered review steps and guides the reviewer through
them.

## Assets

- Icon 128×128: `docs/store/icon-128.png` (also shipped in the package under `icon/`).
- Small promo tile 440×280: `docs/store/promo-440x280.png`.
- Screenshots 1280×800: `docs/store/screenshot-*.png` (see `tooling/store-screenshots.mjs`).

## Release steps

1. Bump `version` in `package.json` (the manifest takes it from there).
2. `bun run build && bun run zip` → `.output/detent-for-github-<version>-chrome.zip`.
3. Upload the zip in the dashboard, paste the texts above, attach the assets, submit for review.
4. Tag the commit: `git tag v<version> && git push origin v<version>`.
