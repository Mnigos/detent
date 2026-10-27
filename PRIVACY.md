# Privacy policy

detent for GitHub is a browser extension that groups the files of a GitHub pull request into review
steps. This policy describes what the extension does with data. It applies to the extension
published in the Chrome Web Store and to builds from this repository.

## What the extension processes

- **Pull request diffs and descriptions.** When you open a pull request on github.com, the extension
  downloads the unified diff from `patch-diff.githubusercontent.com` with your GitHub session and
  reads the title and description of the pull request. It derives the review steps from them.
- **Model requests.** If you saved an OpenRouter API key in the extension popup, a condensed list of
  the changed files with short code excerpts and the pull request description is sent to
  `openrouter.ai` to name and order the review steps. The request is made directly from your
  browser to OpenRouter with your key. Without a key, no request leaves the browser and the steps
  are derived from the file structure only.
- **Viewed state and position.** Which files you marked as viewed and where you are in the review
  are read from the GitHub page and kept in the browser's session storage for the current PR.

## What is stored, and where

Everything the extension stores stays in your browser's extension storage:

- your OpenRouter API key and the chosen model,
- cached analyses per pull request revision, so a model is not asked twice for the same diff,
- a local counter of the tokens and cost your requests to OpenRouter reported.

The extension has no server of its own. It sends nothing to the author or any analytics service.

## Third parties

- **GitHub** serves the pages and diffs you open, under GitHub's own terms and privacy policy.
- **OpenRouter** receives the model requests described above when you configured a key, under
  OpenRouter's terms and privacy policy and those of the model provider you chose.

## Permissions

- `storage`: the settings, caches and counter listed above.
- `https://github.com/*`: reading pull request pages and rendering the review steps in them.
- `https://patch-diff.githubusercontent.com/*`: downloading the diff of the open pull request.
- `https://openrouter.ai/*`: the optional model requests.

## Removing data

Remove the extension to delete everything it stored. Clearing the key in the popup stops all model
requests. The usage counter has its own reset in the popup.

## Contact

Questions go to the issue tracker of this repository.
