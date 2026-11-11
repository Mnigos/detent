# Privacy policy

Last updated: 11 November 2026

detent for GitHub is a browser extension that groups the files of a GitHub pull request into review
steps, ranks them by review priority, and shows the diff size and merge conflicts of pull requests
on pull request lists. This policy describes what the extension does with data. It applies to the extension
published in the Chrome Web Store and to builds from this repository.

## What the extension processes

- **Pull request diffs and descriptions.** When you open a pull request on github.com, the extension
  downloads its unified diff from `github.com`, which redirects to `patch-diff.githubusercontent.com`,
  with your GitHub session, and reads the title and description of the pull request. It derives the
  review steps and the structural priorities from them.
- **Diff sizes on pull request lists.** On a repository's pull request list
  (`github.com/<owner>/<repo>/pulls`), the extension downloads the diff of each listed pull request
  on screen or one screen below the same way, three at a time across all tabs, and counts its added
  and deleted lines and its files. Only these three numbers are kept, with the head commit the list
  showed; the diff text is discarded. The head commits come from the data GitHub puts in the list
  page; after GitHub switches the list to another filter or page without reloading it, the
  extension asks `github.com` once for that page's list data, as GitHub's own list does. Nothing
  from the list goes to OpenRouter.
- **Merge conflicts on pull request lists.** On the same lists, when you are signed in to GitHub, the
  extension asks `github.com` for the merge box state of each open pull request (not drafts) on
  screen or one screen below, in the same queue, with your GitHub session, the request GitHub's own
  pull request page makes for its merge box. Only whether the branch has conflicts, or cannot be
  rebased, is kept, with the head commit it was read for. Signed out it asks nothing.
  The "Show diff size and conflicts on pull request lists" switch in the popup turns both off.
- **Model requests.** Only if you saved an OpenRouter API key in the popup, requests go directly
  from your browser to `openrouter.ai` with your key:
  - to name and order the review steps: the pull request title and description, a condensed list of
    the changed files and short diff excerpts;
  - for Priority Review, once it is shown on a pull request's Changes page: the pull request title
    and description, the changed file paths with their status (added, modified,
    deleted, renamed) and line counts, and the same diff excerpts.

  Without a key no request leaves the browser for a model: the steps come from the file structure
  and the priorities from file paths and change sizes.
- **Viewed state and position.** Which files you marked as viewed and where you are in the review
  are read from the GitHub page and kept in the browser's session storage for the current pull
  request.

## What is stored, and where

Everything the extension stores stays in your browser's extension storage:

- your OpenRouter API key, the chosen model and the two switches of the popup,
- cached step groupings, per pull request, model and diff revision, so a model is not asked twice
  for the same diff (the last five revisions of each pull request),
- cached Priority Review rankings, per pull request, model and diff revision (the last five
  revisions of each pull request),
- whether the Hide tests switch is on,
- diff sizes for pull request lists: owner, repository, pull request number, additions, deletions,
  file count, the head commit they were counted for and the time they were counted, reused while
  the list shows that commit for up to 7 days (10 minutes when the list does not say which commit
  it shows) and capped at 500 pull requests,
- merge conflict states for pull request lists: owner, repository, pull request number, whether it
  has conflicts or cannot be rebased, the head commit and when that was read, reused for 10
  minutes unless the list shows a newer commit, and capped at 500 pull requests,
- when GitHub last rate-limited the list requests and until when they wait, so other tabs wait too,
- a local counter of the tokens and cost your requests to OpenRouter reported.

The extension has no server of its own. It sends nothing to the author or any analytics service.

## Third parties

- **GitHub** serves the pages and diffs you open, under GitHub's own terms and privacy policy.
- **OpenRouter** receives the model requests described above when you configured a key, under
  OpenRouter's terms and privacy policy and those of the model provider you chose.

## Permissions

- `storage`: the settings, caches and counter listed above.
- `https://github.com/*`: reading pull request pages and pull request lists, rendering the review
  steps, diff sizes and conflict markers in them, downloading diffs and reading merge box states.
- `https://patch-diff.githubusercontent.com/*`: following GitHub's redirect for those diff
  downloads.
- `https://openrouter.ai/*`: the optional model requests.

## Removing data

Remove the extension to delete everything it stored. Clearing the key in the popup stops all model
requests. The usage counter has its own reset in the popup.

## Contact

Questions go to the issue tracker of this repository: https://github.com/Mnigos/detent/issues
