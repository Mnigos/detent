# Chrome Web Store listing

Material for the first submission of detent for GitHub 0.1.0. Each section maps to a field or tab in the
developer dashboard. Checked against the manifest that `bun run build` writes to
`.output/chrome-mv3/manifest.json`.

## Store listing tab

- Name: detent for GitHub
- Category: Developer Tools
- Language: English
- Visibility: Public

### Short description

The store shows the manifest `description` from `wxt.config.ts` as the summary, so the two stay the same
(128 of 132 characters):

Review GitHub pull requests in ordered layers, rank files by priority, and see diff sizes, code lines and conflicts on PR lists.

### Full description

```text
detent changes how you read a GitHub pull request, and shows how big each pull request is before you open it.

Layers
The changed files are grouped into review steps instead of one alphabetical list: the data shape first, then the code that implements it, then its tests and docs. Each step has a title and one sentence saying what to check, and counts how many of its files you marked as viewed. Files follow their dependencies, so you read definitions before callers.
- On GitHub's new Changes page, the file tree gets a Layers | Priority | Files switch, section headers between the steps and a step badge in every sticky file header.
- On the classic Files changed page, a side panel lists the steps and their files.
- Keyboard: j and k move between files, n and p between steps, Enter scrolls to the file, v marks it as viewed, r switches to GitHub's own order.
- A link to a review comment keeps that comment on screen while detent reorders the files, and makes its file the current one.

Priority Review
On the Changes page, Priority sorts the files into Urgent (at most 10), High, Medium and Low, with a one-line reason on the Urgent and High ones. Low starts folded.

Hide tests
A switch next to Layers | Priority | Files, and a Hide tests button in the classic panel, take test files off the page: their tree rows, their diffs and any step left empty. j/k, n/p and the viewed counters skip them. A line above the files says how many are hidden, with Show to bring them back. The choice holds across pull requests.

Large pull requests
On a pull request with more than 300 changed files or 20,000 changed lines, detent waits for a click on its badge before it groups the files. The header's lines of code are still counted.

Pull request lists
On a repository's pull request list every row shows +additions −deletions · N files. When tests, docs, lockfiles, generated files, blank and comment lines or whitespace-only changes make up part of the diff, the lines of code follow in parentheses: +a −d (+c −e) · N files. When you are signed in to GitHub, an open pull request also gets a red Conflicts marker when its branch conflicts with the base, an orange Can't rebase marker when it merges but would not rebase cleanly, and an orange Unresolved comments marker when the repository requires conversation resolution and open conversations block the merge.

Pull request header
On every tab of a pull request, GitHub's +additions −deletions is followed by the lines of code in parentheses, counted the same way.

Image preview
Clicking an image in rendered Markdown on GitHub (pull request and issue descriptions, comments, README files) opens it over the page instead of in a new tab. Arrow keys step through the images of that block. Cmd/Ctrl-click still opens the tab.

Model provider (optional)
In the popup, choose OpenRouter and paste your API key, or choose ChatGPT and sign in with your ChatGPT account to use your ChatGPT plan. The model then names and orders the steps and ranks the files for Priority Review. Answers are cached in the browser per pull request, provider, model and diff revision. Without a provider, the steps come from the file structure and the priorities from file paths and change sizes, computed in the browser. The popup shows what your OpenRouter requests cost so far, or how many requests went to your ChatGPT plan, and has three switches: detent on or off, list and header sizes, and the image preview.

What leaves the browser
detent downloads diffs and merge box states from GitHub with your GitHub session. Only when you set up a provider, the title, description, changed file paths and diff excerpts of the pull request you open go to OpenRouter under your key, or to OpenAI under your ChatGPT account. When new commits change only part of a pull request, the request also carries the earlier step names and which files they held. List sizes and merge states never go to a model. There is no detent server and no analytics.

Privacy policy: https://github.com/Mnigos/detent/blob/main/PRIVACY.md
Source code (GPL-3.0): https://github.com/Mnigos/detent
```

## Privacy practices tab

### Single purpose

Helps review code on GitHub: groups a pull request's changed files into ordered review steps, ranks them
by review priority, shows the size and merge state of pull requests on GitHub's pull request lists and
headers, and opens screenshots and other images from GitHub descriptions and comments over the page.

### Permission justifications

storage

: Keeps, in `chrome.storage.local`, the settings (provider, OpenRouter key, OpenRouter and ChatGPT model,
  the three popup switches), the Hide tests choice, cached step groupings and priority rankings per pull
  request and diff revision, cached diff sizes and merge states for lists and headers, GitHub rate-limit
  pauses, and the local usage counters. `chrome.storage.session` holds the review position on an open pull
  request and the click that lets a large pull request be grouped, until the browser closes. ChatGPT tokens
  are not kept here.

declarativeNetRequestWithHostAccess

: Installs one session rule for the optional "Continue with ChatGPT" sign-in. OpenAI's sign-in for
  open-source apps only accepts a loopback redirect address, so detent registers
  `http://127.0.0.1:47801/auth/callback`. The rule redirects that one navigation to the extension's own
  `chatgpt-callback.html` before the browser sends it, so the one-time code reaches the extension and never a
  program listening on that port. The "WithHostAccess" variant adds no install warning of its own and acts
  only on hosts listed in the host permissions. detent has no other rule: it blocks and modifies no other
  request.

Host `https://github.com/*`

: The content script runs on github.com and renders the steps, Priority Review, Hide tests, list sizes,
  conflict markers, header code lines and the image preview inside GitHub's pages. It matches the whole site
  because GitHub moves between pages without reloading, so a script matched only on `/pull/` or `/pulls`
  pages would never start. Elsewhere it watches the URL, and it handles clicks on images in rendered
  Markdown for the image preview. The service worker downloads
  `https://github.com/<owner>/<repo>/pull/<number>.diff` with the user's GitHub session (for the open pull
  request, for the rows of a list, and for a header whose counts are not cached), reads
  `/pull/<number>/page_data/merge_box` for open pull requests on a list when the user is signed in, and
  after GitHub switches a list to another filter or page, that page's list data as JSON, to learn each row's
  head commit. When the open page does not show the pull request description (Files changed, Changes), the
  content script loads the pull request's conversation page once to read it.

Host `https://patch-diff.githubusercontent.com/*`

: GitHub answers the `.diff` requests above with a redirect to this host. It sends no CORS headers, so
  the service worker needs host access to follow the redirect and read the diff.

Host `https://openrouter.ai/*`

: Only when the user picks OpenRouter and enters a key: sends the step-grouping and Priority Review
  requests to `https://openrouter.ai/api/v1/chat/completions` with that key.

Host `https://auth.openai.com/*`

: Only when the user picks ChatGPT and signs in: the service worker exchanges the one-time code for tokens,
  refreshes them, revokes them on sign-out, and loads OpenAI's public signing keys to verify the ID token.

Host `https://api.openai.com/*`

: Only when signed in with ChatGPT: sends the step-grouping and Priority Review requests to OpenAI's
  Responses API on the user's ChatGPT plan, and lists the models that account may use.

Host `http://127.0.0.1/*`

: Chrome applies a declarativeNetRequest redirect only on hosts the extension has access to, and the
  sign-in redirect above points at 127.0.0.1. detent never fetches anything from 127.0.0.1, injects nothing
  there and reads nothing from it; the host is listed only so the redirect rule can apply.

Web accessible resource `chatgpt-callback.html`

: Limited to `https://auth.openai.com/*`. Chrome lets a navigation that starts on a web page enter an
  extension page only if that page is web accessible to the starting site, and the sign-in redirect starts
  on OpenAI's consent page. (WXT also lists `content-scripts/github.css` for `https://github.com/*`, the
  content script's own stylesheet.)

### Remote code

No, I am not using remote code. All JavaScript ships in the package. Model answers are JSON data that the
extension parses; it never evaluates them.

### Data usage

Tick these categories:

- Personally identifiable information: the email address and account ID in the ID token OpenAI issues
  when the user signs in with ChatGPT. Stored in the extension's IndexedDB; the email is shown in the popup
  and sent back to `auth.openai.com` as a sign-in hint.
- Authentication information: the user's OpenRouter API key, or the OAuth tokens OpenAI issues after a
  ChatGPT sign-in. Sent only to the service that issued them, as the bearer token.
- Website content: pull request diffs, titles and descriptions from github.com. Processed in the browser;
  only when the user set up a provider, the title, description, changed file paths and diff excerpts of
  the open pull request go to OpenRouter or OpenAI.

- Web history: the caches name the pull requests you opened or saw on a list (owner, repository, number,
  head commit), and session storage keeps your review position on each. All of it stays in the browser.

Leave unticked: health, financial and payment information, personal communications, location, user
activity. detent reads keyboard shortcuts and clicks on its own controls to act on them; it does not log
them, and it keeps no record of clicks, keystrokes, scrolling or mouse movement beyond the review position
above.

Tick all three certifications:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

Privacy policy URL: https://github.com/Mnigos/detent/blob/main/PRIVACY.md

## Assets

- Icon 128×128: `docs/store/icon-128.png` (also in the package under `icon/`).
- Small promo tile 440×280: `docs/store/promo-440x280.png` (logo and name, no UI).
- Screenshots 1280×800 PNG, in this order. The dashboard has no caption field; the text after each file
  says what it shows.
  1. `docs/store/screenshot-1-layers-hide-tests.png`: "A pull request grouped into review steps, with test
     files hidden."
  2. `docs/store/screenshot-2-list-sizes-markers.png`: "Diff size, lines of code and merge state on every
     pull request in a list." The image carries a label saying its merge markers are illustrative and need a
     GitHub sign-in.
  3. `docs/store/screenshot-3-header-code-lines.png`: "Lines of code next to GitHub's own count in the pull
     request header."
  4. `docs/store/screenshot-4-image-preview.png`: "Images from descriptions and comments open over the
     page."
  5. `docs/store/screenshot-5-popup.png`: "Pick OpenRouter or your ChatGPT plan to name the steps, or use
     neither."

`bun run build && node tooling/store-screenshots.mjs` captures all five in headless Chromium with the built
extension, in a fresh profile, signed out of GitHub, on public TanStack/router pages, dark theme, steps
named from the file structure. Merge markers need a signed-in GitHub session, so for screenshot 2 the script
fills in the list's empty `user-login` tag and stubs the merge box answers in the service worker: the
Conflicts, Can't rebase and Unresolved comments markers on those rows are simulated. Priority Review has no
screenshot because GitHub serves the new Changes page, where it lives, only to signed-in users.

## Submit

1. Sign in to the Chrome Web Store developer dashboard (https://chrome.google.com/webstore/devconsole) with
   the developer account; pay the one-time registration fee and verify the contact email if not done yet.
2. Build the package: `bun run build && bun run zip` gives `.output/detent-for-github-0.1.0-chrome.zip`.
3. Add a new item and upload that zip.
4. Store listing tab: paste the full description, set the category and language, upload the icon, the promo
   tile and the five screenshots in the order above.
5. Privacy practices tab: paste the single purpose, every permission justification and the remote code
   answer, tick the data categories and the three certifications, and set the privacy policy URL
   https://github.com/Mnigos/detent/blob/main/PRIVACY.md.
6. Distribution tab: Public, all regions.
7. Submit for review. After it is published, replace the store link placeholder in `README.md` and tag the
   commit: `git tag v0.1.0 && git push origin v0.1.0`.

For a later release, bump `version` in `package.json` (the manifest takes it from there), run
`bun run typecheck && bun run check && bun run test`, then upload the new zip on the same item.
