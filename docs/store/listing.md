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

detent changes how you read a GitHub pull request, and shows how big each pull request is, and
whether it has merge conflicts, before you open it.

Layers. The changed files are grouped into review steps instead of one alphabetical list: one
behavior change per step, with the data shape first, then the code that implements it, then its
tests and docs. Each step has a title and one sentence saying what to verify, and counts how many
of its files you already marked as viewed. Steps and files follow their dependencies, so you read
definitions before callers.

Priority Review. On GitHub's new Changes page the file tree gets three modes: Layers, Priority and
Files. Priority sorts the files into Urgent (at most 10), High, Medium and Low, with a one-line
reason on the Urgent and High ones, so a reviewer short on time knows what to read first. Low
starts folded.

Diff size and conflicts on pull request lists. On a repository's pull request list every row shows
+additions −deletions · N files, with the lines of code alone in parentheses after the totals when
tests, docs, lockfiles, generated files, blank and comment lines or whitespace-only changes make up
part of the diff, and a red Conflicts marker on an open pull request whose branch conflicts with its
base, or an orange Can't rebase one when it merges but would not rebase cleanly, followed by an
orange Unresolved comments marker when the repository requires conversation resolution and open
conversations block the merge (signed in to GitHub).

Lines of code in the pull request header. On every tab of a pull request, GitHub's +additions −deletions
is followed by the lines of code alone in parentheses, the same way, when part of the diff is not code.

On the pull request page:

- On the Changes page: the Layers | Priority | Files switch in GitHub's file tree, section headers
  between the steps and a step badge in every sticky file header.
- On the classic Files changed page: a side panel with the steps and their files.
- The active step is the first one with unviewed files. Finished steps are dimmed.
- Keyboard: j and k move between files, n and p between steps, Enter scrolls to the file, v marks
  it as viewed, r switches to GitHub's own order.

A model is optional. In the popup, choose OpenRouter and add your API key, or choose ChatGPT and
sign in with your ChatGPT account to use your ChatGPT plan. Then pick a model: it names and orders
the steps, following a description that tells reviewers where to start, and ranks the files for
Priority Review. Grouping and Priority Review are separate requests, each cached in the browser per
pull request, provider, model and diff revision, so switching models or pushing new commits asks
again. Without a provider the steps come from the file structure and the priorities from file paths
and change sizes, computed locally. The popup shows what your OpenRouter requests cost so far, or
how many requests went to your ChatGPT plan, and has switches to turn detent off or to hide the list
diff sizes and conflicts and the header's lines of code.

What leaves the browser: diffs are downloaded from GitHub with your GitHub session. Only when you
set up a provider, the title, description, changed file paths and diff excerpts of the pull request
you open go to OpenRouter under your key, or to OpenAI under your ChatGPT account. Diff sizes and
conflict states on lists never go to a model. There is no detent server and no analytics.

Source code (GPL-3.0): https://github.com/Mnigos/detent

## Permission justifications

- **storage**: keeps the settings (provider, OpenRouter key, OpenRouter and ChatGPT models, three
  switches), cached step groupings and priority rankings per pull request revision, cached diff
  sizes and conflict states for pull request lists and headers, and local usage counters in the
  browser. Session storage holds the review position of the open pull request. ChatGPT tokens are
  not kept here but in the extension's own IndexedDB, which content scripts cannot read.
- **declarativeNetRequestWithHostAccess**: one session rule. ChatGPT's sign-in returns to
  `http://127.0.0.1:47801/auth/callback`, the loopback address OpenAI requires for open-source
  apps. The rule turns that navigation into the extension's callback page before the browser sends
  it, so the one-time code never reaches a local program listening on that port.
- **Host permission `https://github.com/*`**: the extension renders inside GitHub pull request
  pages and pull request lists. It matches the whole site because GitHub moves between pages by
  in-page navigation, where a script matched only on `/pull/` or `/pulls` URLs would never run. On
  other pages it only watches the URL. The service worker downloads each pull request's diff from
  `https://github.com/<owner>/<repo>/pull/<number>.diff`: for the open pull request to build the
  steps, for each pull request listed on a `/<owner>/<repo>/pulls` page to count its additions,
  deletions, files and lines of code, and for the open pull request's header when those counts are
  not stored yet. On those lists the service worker also reads, with the user's
  GitHub session, the merge box state GitHub's own page loads from
  `https://github.com/<owner>/<repo>/pull/<number>/page_data/merge_box`, to mark pull requests with
  merge conflicts, a blocked rebase or unresolved conversations that block the merge, and after
  GitHub switches a list to another filter or page, that page's list data as JSON, to know each
  row's head commit.
- **Host permission `https://patch-diff.githubusercontent.com/*`**: GitHub redirects those diff
  downloads to this host, which sends no CORS headers for the page, so the service worker follows
  the redirect itself.
- **Host permission `https://openrouter.ai/*`**: sends the optional model requests (step grouping
  and Priority Review ranking) with the user's own key.
- **Host permission `https://auth.openai.com/*`**: the optional "Continue with ChatGPT" sign-in. The
  service worker exchanges the one-time code for tokens, refreshes them, revokes them on sign-out
  and loads OpenAI's public keys to verify the ID token.
- **Host permission `https://api.openai.com/*`**: sends the optional model requests to OpenAI's
  Responses API on the user's ChatGPT plan, and lists the models that account may use.
- **Host permission `http://127.0.0.1/*`**: Chrome applies a declarativeNetRequest redirect only to
  hosts the extension has access to. The extension never sends a request to 127.0.0.1; it only
  redirects the sign-in callback away from it.
- **Web accessible resource `chatgpt-callback.html`** (matches `https://auth.openai.com/*` only):
  Chrome lets a navigation that starts on a web page enter an extension page only when that page is
  web accessible to the starting site. OpenAI's consent page is that site.
- **Remote code:** none. All code ships in the package.

## Data usage disclosure (Privacy practices tab)

- Collects: **website content** (pull request diffs, titles and descriptions), **authentication
  information** (the user's own OpenRouter API key, or the OAuth tokens OpenAI issues when the user
  signs in with ChatGPT) and **personally identifiable information** (the email address and account
  ID in the ChatGPT ID token; the popup shows the email). All of it stays in the browser unless the user
  set up a provider; then the website content of the open pull request is sent to OpenRouter with
  the key, or to OpenAI with the access token, as the bearer token. Pull request numbers and diff
  counts kept in local caches never leave the browser.
- Not collected: health, financial or payment information,
  personal communications, location, web history, user activity.
- Certifications: not sold to third parties; not used or transferred for purposes unrelated to the
  single purpose; not used or transferred to determine creditworthiness or for lending.
- Privacy policy URL: https://github.com/Mnigos/detent/blob/main/PRIVACY.md

## Single purpose statement

Helps review GitHub pull requests: groups a pull request's files into ordered review steps, ranks
them by review priority, and shows the diff size and merge conflicts of each pull request on pull
request lists.

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
