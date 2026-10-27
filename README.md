# detent for GitHub

A Chrome extension for reviewing GitHub pull requests. Source: https://github.com/Mnigos/detent

- **Layers.** The changed files of a pull request are grouped into ordered review steps: a side
  panel on the classic "Files changed" page, a Layers mode in the file tree on the new Changes page.
  Keyboard: j/k files, n/p steps, Enter scroll, v viewed, r GitHub's order.
- **Priority Review.** A third mode in the Changes page file tree (Layers | Priority | Files) ranks
  the files into Urgent (at most 10), High, Medium and Low.
- **Diff size on pull request lists.** Each row of `/<owner>/<repo>/pulls` shows
  `+additions −deletions · N files`, counted from the pull request's diff and cached for 10 minutes.

The extension fetches each pull request's unified diff, classifies the changed files by role and
derives dependency edges from the added lines. With an OpenRouter API key saved in the popup, a
model of your choice names and orders the steps and ranks the files, in separate requests cached
per pull request, model and diff revision. Without a key the steps come from the file structure and
the priorities from a local path and size heuristic. The popup also holds two switches, one to turn
detent off and one for the list diff sizes, and a usage counter. See `PRIVACY.md` for what leaves
the browser and `docs/store/listing.md` for the Chrome Web Store material and release steps.

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
