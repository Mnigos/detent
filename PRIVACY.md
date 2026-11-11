# Privacy policy

Last updated: 11 November 2026

detent for GitHub is a browser extension that groups the files of a GitHub pull request into review
steps, ranks them by review priority, shows the diff size and merge conflicts of pull requests
on pull request lists, and the lines of code in a pull request's header. This policy describes what the extension does with data. It applies to the extension
published in the Chrome Web Store and to builds from this repository.

## What the extension processes

- **Pull request diffs and descriptions.** When you open a pull request on github.com, the extension
  downloads its unified diff from `github.com`, which redirects to `patch-diff.githubusercontent.com`,
  with your GitHub session, and reads the title and description of the pull request. It derives the
  review steps and the structural priorities from them.
- **Diff sizes on pull request lists.** On a repository's pull request list
  (`github.com/<owner>/<repo>/pulls`), the extension downloads the diff of each listed pull request
  on screen or one screen below the same way, three at a time across all tabs, and counts its added
  and deleted lines, its files, and how many of those lines are code rather than tests, docs,
  lockfiles, generated files, blank and comment lines or whitespace-only changes. Only these counts
  are kept, with the head commit the list showed; the diff text is discarded. The head commits come
  from the data GitHub puts in the list page; after GitHub switches the list to another filter or
  page without reloading it, the extension asks `github.com` once for that page's list data, as
  GitHub's own list does. Nothing from the list goes to a model.
- **Lines of code in the pull request header.** On every tab of a pull request, the extension shows
  how many of the changed lines are code next to GitHub's own count. It reuses the counts stored for
  the head commit the page shows, or the diff it already downloaded for the review steps; otherwise
  it downloads the diff once the same way, in the same queue as the lists, and keeps only the counts,
  stored with the lists' counts. The head commit comes from the data GitHub puts in the page.
- **Merge conflicts on pull request lists.** On the same lists, when you are signed in to GitHub, the
  extension asks `github.com` for the merge box state of each open pull request (not drafts) on
  screen or one screen below, in the same queue, with your GitHub session, the request GitHub's own
  pull request page makes for its merge box. Only whether the branch has conflicts, or cannot be
  rebased, and whether unresolved conversations block the merge is kept, with the head commit it was
  read for. No comment or thread content is read. Signed out it asks nothing.
  The "Show diff size and conflicts on pull request lists, and code lines in pull request headers" switch in the popup turns these and the header's lines of code off.
- **Model requests.** Only if you set up a model provider in the popup, requests go directly from
  your browser to that provider: to `openrouter.ai` with your OpenRouter API key, or to
  `api.openai.com` under your ChatGPT account when you chose ChatGPT and signed in. Each request
  carries:
  - to name and order the review steps: the pull request title and description, a condensed list of
    the changed files and short diff excerpts;
  - for Priority Review, once it is shown on a pull request's Changes page: the pull request title
    and description, the changed file paths with their status (added, modified,
    deleted, renamed) and line counts, and the same diff excerpts.

  Without a provider no request leaves the browser for a model: the steps come from the file
  structure and the priorities from file paths and change sizes.
- **ChatGPT sign-in.** "Continue with ChatGPT" opens OpenAI's sign-in page in a new tab. You sign in
  there, not in detent; detent never sees your password. OpenAI sends back a one-time code, which
  the extension exchanges at `auth.openai.com` for tokens. The code goes from OpenAI's page to an
  extension page inside the browser and is never sent to any local program. Requests to OpenAI's
  Responses API set `store: false`, so OpenAI is asked not to keep the responses, and they use your
  ChatGPT plan: they count toward its usage limits, which you can review and cap for detent at
  https://chatgpt.com/settings/usage. Detent asks for the scopes `openid profile email
  offline_access resource.invoke chatgpt.tokens.use.direct`. This gives it your account's email
  address and the right to send model requests on your plan. It gets no access to your ChatGPT
  conversations.
- **Viewed state and position.** Which files you marked as viewed and where you are in the review
  are read from the GitHub page and kept in the browser's session storage for the current pull
  request.

## What is stored, and where

Everything the extension stores stays in your browser's extension storage:

- your OpenRouter API key, the chosen provider, the chosen OpenRouter and ChatGPT models and the
  two switches of the popup,
- cached step groupings, per pull request, model and diff revision, so a model is not asked twice
  for the same diff (the last five revisions of each pull request),
- cached Priority Review rankings, per pull request, model and diff revision (the last five
  revisions of each pull request),
- whether the Hide tests switch is on,
- diff sizes for pull request lists and headers: owner, repository, pull request number,
  additions, deletions, file count, the code line counts with what each excluded kind took, the head commit they were
  counted for and the time they were counted, reused while the list shows that commit for up to 7
  days (10 minutes when the list does not say which commit it shows) and capped at 500 pull
  requests,
- merge conflict states for pull request lists: owner, repository, pull request number, whether it
  has conflicts or cannot be rebased, whether unresolved conversations block its merge, the head
  commit and when that was read, reused for 10
  minutes unless the list shows a newer commit, and capped at 500 pull requests,
- when GitHub last rate-limited the list requests and until when they wait, so other tabs wait too,
- a local counter of the tokens and cost your requests to OpenRouter reported, and a count of the
  requests sent on your ChatGPT plan,
- when you signed in with ChatGPT: the client ID OpenAI issued to detent, your account's ID and
  email address from the ID token, the access, refresh and ID tokens, and a random ID for this
  browser profile (`ext_agent_host_id`) that OpenAI uses to tell installs apart. These sit in the
  extension's own IndexedDB database, which only detent's service worker opens. Pages you visit and
  detent's script on github.com cannot read it. The access and refresh tokens never appear in a
  URL or a log; the ID token goes only to OpenAI's sign-in page, as a hint for the next sign-in.

The extension has no server of its own. It sends nothing to the author or any analytics service.

## Third parties

- **GitHub** serves the pages and diffs you open, under GitHub's own terms and privacy policy.
- **OpenRouter** receives the model requests described above when you configured a key, under
  OpenRouter's terms and privacy policy and those of the model provider you chose.
- **OpenAI** receives the sign-in and the model requests described above when you chose ChatGPT
  and signed in, under OpenAI's terms and privacy policy.

## Permissions

- `storage`: the settings, caches and counters listed above.
- `declarativeNetRequestWithHostAccess`: one rule that turns the ChatGPT sign-in's return address,
  `http://127.0.0.1:47801/auth/callback`, into detent's own callback page before the browser sends
  anything there.
- `https://github.com/*`: reading pull request pages and pull request lists, rendering the review
  steps, diff sizes and conflict markers in them, downloading diffs and reading merge box states.
- `https://patch-diff.githubusercontent.com/*`: following GitHub's redirect for those diff
  downloads.
- `https://openrouter.ai/*`: the optional model requests to OpenRouter.
- `https://auth.openai.com/*`: the ChatGPT sign-in, token refresh, sign-out and the keys that
  verify OpenAI's ID tokens.
- `https://api.openai.com/*`: the optional model requests to OpenAI and the list of models your
  ChatGPT account may use.
- `http://127.0.0.1/*`: required for the redirect rule above. Detent never sends a request to
  127.0.0.1.

## Removing data

Remove the extension to delete everything it stored. Clearing the OpenRouter key stops requests to
OpenRouter. "Sign out" in the popup asks OpenAI to end the session, then deletes the tokens; the
issued client ID and your account ID stay so the next sign-in returns to the same registration. You
can also disconnect detent in ChatGPT's settings. Each usage counter has its own reset in the popup.

## Contact

Questions go to the issue tracker of this repository: https://github.com/Mnigos/detent/issues
