# detent for GitHub: brief for stage 5 (OpenRouter labeling with the user's key)

Gemini Nano turned out to be unavailable in the owner's browser (Helium, ungoogled Chromium) and in every non-Google Chromium. Decision (owner, 2026-09-11): layer names come from an OpenRouter model using the user's own API key; Gemini Nano stays as an automatic fallback when no key is set; the deterministic skeleton remains the last resort. Default model: `openai/gpt-5.6-luna` (OpenRouter id, supports `response_format` with a JSON schema and `reasoning.effort`).

Builds on stages 0-4 (`docs/brief-stage-0-2.md`, `docs/brief-stage-3-4.md`). Everything below is settled.

## 1. Settings

- Stored in `chrome.storage.local` under the key `settings`: `{ openRouterKey: string; model: string }`. Default model `openai/gpt-5.6-luna`. Module `src/lib/settings.ts` with `readSettings()` and `writeSettings(partial)`; both tiny, both unit-tested with the fake browser from `wxt/testing`.
- The popup (`entrypoints/popup/app.tsx`) becomes the settings page: a password field `OpenRouter API key`, a text field `Model` prefilled with the default, `Save`, and `Test` which sends one minimal chat completion (`max_tokens: 5`, user message `Reply with OK.`) and shows either `Connected: <model id>` or the mapped error. The existing Nano smoke test moves under a small `Check Gemini Nano` link at the bottom, unchanged in behaviour.
- Never log or echo the key; the field masks it; `Test` output never includes it.

## 2. OpenRouter client

`src/lib/model/openrouter.ts`, `labelLayersWithOpenRouter({ key, model, input })`:

- `POST https://openrouter.ai/api/v1/chat/completions`, headers `Authorization: Bearer <key>`, `Content-Type: application/json`, `HTTP-Referer: https://github.com/Mnigos/detent`, `X-Title: detent for GitHub`.
- Body: `{ model, messages: [{ role: 'system', content: LABEL_SYSTEM_PROMPT }, { role: 'user', content: input }], response_format: { type: 'json_schema', json_schema: { name: 'layers', strict: true, schema: STRICT_LABEL_SCHEMA } }, reasoning: { effort: 'low' }, max_tokens: 2000 }`.
- `STRICT_LABEL_SCHEMA` lives next to `LABEL_SCHEMA` in `src/lib/layers/label-schema.ts`: same shape, but every object has `additionalProperties: false` and lists all of its properties in `required` (so `moveFiles` is required and may be an empty array). Keep `LABEL_SCHEMA` for Nano.
- Timeout 20 s (`AbortSignal.timeout`). Parse `choices[0].message.content` through `parseLabelResponse`.
- Result type `{ layers?: LabelEntry[]; error?: { kind: 'unauthorized' | 'credits' | 'request' | 'timeout' | 'invalid'; status?: number } }`: 401/403 → `unauthorized`, 402 → `credits`, other non-2xx or network → `request`, abort → `timeout`, unparsable content → `invalid`.

## 3. Resolution order and cache

In `src/lib/model/label-layers.ts` (`resolveLayerLabels`):

1. If `settings.openRouterKey` is non-empty → OpenRouter with `settings.model`.
2. Else → Gemini Nano as today.
3. Else → fallback.

Cache key becomes `layers:<digest>:<labeler>` where labeler is the model id for OpenRouter and `nano` for Nano; only model results are cached. Response gains `labeler: 'openrouter' | 'nano' | 'none'`, `model?: string`, and `error?` from section 2.

## 4. Status lines (`src/lib/panel/status.ts`)

- model result from OpenRouter: `Layer names from <model id>.`
- model result from Nano: `Layer names from Gemini Nano.`
- OpenRouter errors: `unauthorized` → `OpenRouter rejected the API key. Check it in the extension popup.`; `credits` → `OpenRouter reports no credits left.`; `timeout` → `OpenRouter took too long; layer names come from the file structure.`; `request`/`invalid` → `OpenRouter request failed; layer names come from the file structure.`
- no key and Nano unavailable/missing: `Add an OpenRouter key in the extension popup to name the layers.`
- no key, Nano downloading: unchanged downloading line.
- anything else: `Layer names come from the file structure.`

## 5. Manifest

`host_permissions` adds `https://openrouter.ai/*`.

## 6. Verification

- Unit: settings read/write; OpenRouter client (exact request shape including headers, strict schema and `reasoning`, success parse, each error mapping, timeout); resolution precedence (key → OpenRouter, no key → Nano, neither → fallback) and the cache key per labeler; status lines table.
- `bun run typecheck`, `bun run check`, `bun run test`, `bun run build`.
- `tooling/panel-e2e.mjs`: add the new status strings to its allowed list; run it against Helium: `PROBE_EXECUTABLE="/Applications/Helium.app/Contents/MacOS/Helium" bun tooling/panel-e2e.mjs`. Never launch Google Chrome (the owner's rule).
- Optional and cheap: when `OPENROUTER_KEY` is set in the environment, the e2e seeds `settings` through the service worker (`worker.evaluate` writing `chrome.storage.local`) before opening the page and asserts the status line becomes `Layer names from <model>.` within 30 s, printing the layer names and summaries. Skip silently when the variable is absent.
