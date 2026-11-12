# detent for GitHub

A Chrome extension for reviewing GitHub pull requests. Source: https://github.com/Mnigos/detent

## Install

- Chrome Web Store: link follows once the listing is published.
- From source: see [Development](#development) and load `.output/chrome-mv3` unpacked.

After installing, open a pull request on github.com. A model provider is optional; pick one in the
toolbar popup.

## Features

- **Layers.** The changed files of a pull request are grouped into ordered review steps: a side
  panel on the classic "Files changed" page, a Layers mode in the file tree on the new Changes page.
  Keyboard: j/k files, n/p steps, Enter scroll, v viewed, r GitHub's order.
- **Hide tests.** A beaker switch next to Layers | Priority | Files, and a Hide tests button in the
  classic panel's header, take test files off the page: their tree rows, their diffs, and any layer
  left empty. Viewed counters, j/k, n/p and the jump to the next unviewed file skip them, and a line
  above the files says how many are hidden, with Show to bring them back. The diff is not fetched
  again. The choice holds across pull requests and tabs.
- **Priority Review.** A third mode in the Changes page file tree (Layers | Priority | Files) ranks
  the files into Urgent (at most 10), High, Medium and Low.
- **Diff size and conflicts on pull request lists.** Each row of `/<owner>/<repo>/pulls` shows
  `+additions −deletions · N files`, counted from the pull request's diff. When tests, docs,
  lockfiles, generated files, blank and comment lines or whitespace-only changes account for part
  of it, the lines of code follow the totals in parentheses,
  `+additions −deletions (+a −d) · N files`; their tooltip lists what was left out. The counts are
  kept for the head commit the list shows and reused for up to a week until a new commit is pushed
  (10 minutes when the list does not say which commit it shows). When you are signed in, an open
  pull request (not a draft) whose branch conflicts with its base gets a red `Conflicts` marker, or
  an orange `Can't rebase` one when it merges but would not rebase cleanly. An orange
  `Unresolved comments` marker follows when the repository requires conversation resolution and
  open conversations block the merge; open threads alone never show it. Both come from GitHub's merge
  box and are cached for 10 minutes or until a new commit is pushed. Only rows on screen or one screen
  below are asked about; the rest are asked when you scroll to them. Every tab shares one queue of
  three requests at a time, and a pull request two tabs ask about is fetched once. When GitHub
  rate-limits these requests, the list waits as long as GitHub asks (a minute if it does not say,
  longer on repeats) and then fills in the rows still missing.
- **Lines of code in the pull request header.** On every tab of a pull request, GitHub's
  `+additions −deletions` in the header is followed by the lines of code in parentheses, styled and
  titled like the list's, and left out when nothing was excluded. The counts are the list's: reused
  for the head commit the page shows, taken from the diff detent already downloaded on Files changed
  or Changes, or downloaded once through the list queue and counted in the service worker, then
  stored for the list too. Large pull requests get them as well; the click only gates grouping.
- **Image preview.** Clicking an image in rendered Markdown on GitHub (descriptions, comments, README
  files) opens it over the page instead of a new tab; arrow keys step through that block's images. Cmd/Ctrl-click still opens the tab.

The extension fetches each pull request's unified diff, classifies the changed files by role and
derives dependency edges from the added lines. A model provider is optional and chosen in the popup:
OpenRouter with your API key, or ChatGPT, where "Continue with ChatGPT" signs in with your ChatGPT
account and the requests use your ChatGPT plan. The model you pick names and orders the steps and
ranks the files, in separate requests cached per pull request, provider, model and diff revision.
Without a provider the steps come from the file structure and the priorities from a local path and
size heuristic. On a pull request with more than 300 changed files
or 20,000 changed lines, detent waits until you click its corner badge before it fetches the diff,
and remembers that click for the pull request until the browser session ends. The popup also holds
three switches, one to turn detent off except for the image preview, one for the list diff sizes
and conflicts and the header's lines of code, and one for the image preview, and a usage counter. See
`PRIVACY.md` for what leaves the browser and `docs/store/listing.md` for the Chrome Web Store
material and release steps.

## Development

Install with `bun install`. Run `bun run dev` for a live-reloading development build, or
`bun run build` to produce `.output/chrome-mv3`, which you load through `chrome://extensions` with
developer mode on and "Load unpacked". Open a pull request on GitHub and check the page console for
`[detent]` lines. `bun run test` runs the Vitest suite against the diffs in `fixtures/`,
`bun run typecheck` runs the TypeScript compiler, `bun run check` runs Biome, and `bun run zip`
packs the store upload. `node tooling/store-screenshots.mjs` captures the store screenshots after a
build, in headless Chromium with a fresh profile, signed out, and `node tooling/chatgpt-e2e.mjs` checks the ChatGPT sign-in headlessly up to OpenAI's token
endpoint without signing in.

## ChatGPT sign-in

detent follows OpenAI's open-source flow for ChatGPT plan usage
(https://developers.openai.com/siwc/token-sharing-open-source). The service worker opens
`auth.openai.com` with PKCE (S256), a fresh state and nonce, a stable `urn:uuid` host ID, and
either `dynamic_agent_client` for the first registration or the issued client ID it saved. OpenAI
returns to `http://127.0.0.1:47801/auth/callback`; a declarativeNetRequest session rule redirects
that navigation to `chatgpt-callback.html` before it is sent. The worker checks the state and the
issued client ID, exchanges the code, verifies the ID token against OpenAI's JWKS (RS256, issuer,
audience, expiry, nonce) and requires the `chatgpt.tokens.use.direct` scope. Tokens live in the
extension's IndexedDB. The worker refreshes them five minutes before expiry, one refresh at a time,
and revokes the refresh token on sign-out. Model calls go to the Responses API with `store: false`
and `stream: true`, and only `response.completed` counts as an answer.

## License

GPL-3.0-only. See `LICENSE`.

Copyright (C) 2026 Igor Makowski
