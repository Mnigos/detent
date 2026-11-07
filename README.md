# detent for GitHub

A Chrome extension for reviewing GitHub pull requests. Source: https://github.com/Mnigos/detent

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
  `+additions −deletions · N files`, counted from the pull request's diff and cached for 10 minutes,
  and, when you are signed in, a red `Conflicts` marker on an open pull request whose branch
  conflicts with its base, read from GitHub's merge box and cached for 5 minutes.

The extension fetches each pull request's unified diff, classifies the changed files by role and
derives dependency edges from the added lines. With an OpenRouter API key saved in the popup, a
model of your choice names and orders the steps and ranks the files, in separate requests cached per
pull request, model and diff revision. Without a key the steps come from the file structure and the
priorities from a local path and size heuristic. On a pull request with more than 300 changed files
or 20,000 changed lines, detent waits until you click its corner badge before it fetches the diff,
and remembers that click for the pull request until the browser session ends. The popup also holds
two switches, one to turn detent off and one for the list diff sizes and conflicts, and a usage
counter. See
`PRIVACY.md` for what leaves the browser and `docs/store/listing.md` for the Chrome Web Store
material and release steps.

## Development

Install with `bun install`. Run `bun run dev` for a live-reloading development build, or
`bun run build` to produce `.output/chrome-mv3`, which you load through `chrome://extensions` with
developer mode on and "Load unpacked". Open a pull request on GitHub and check the page console for
`[detent]` lines. `bun run test` runs the Vitest suite against the diffs in `fixtures/`,
`bun run typecheck` runs the TypeScript compiler, `bun run check` runs Biome, and `bun run zip`
packs the store upload. `node tooling/store-screenshots.mjs` captures the store screenshots after a
build.

## License

GPL-3.0-only. See `LICENSE`.

Copyright (C) 2026 Igor Makowski
