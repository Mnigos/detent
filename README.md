# detent for GitHub

A proof-of-concept Chrome extension that splits a GitHub pull request's "Files changed" page into
named layers in reading order. It fetches the pull request's unified diff, classifies each changed
file by role, derives dependency edges from the added lines, and groups the result into an ordered
layer skeleton. The service worker then asks an OpenRouter model with the API key from the popup
settings to name those layers, caching the answer per diff and model and keeping the structural
names whenever the key is missing or the model is slow or wrong. The popup stores the key and model
and tests the connection.

A model needs an OpenRouter API key, entered in the extension popup; without one the layers are
named from the file structure. See `PRIVACY.md` for what leaves the browser and `docs/store/listing.md`
for the Chrome Web Store material and release steps.

Install with `bun install`. Run `bun run dev` for a live-reloading development build, or
`bun run build` to produce `.output/chrome-mv3`, which you load through `chrome://extensions` with
developer mode on and "Load unpacked". Open a pull request on GitHub and check the page console for
`[detent]` lines. `bun run test` runs the Vitest suite against the diffs in `fixtures/`,
`bun run typecheck` runs the TypeScript compiler, and `bun run check` runs Biome.

## License

GPL-3.0-only. See `LICENSE`.

Copyright (C) 2026 Igor Makowski
