// Runs the hosted grouping on a diff exactly as the worker does, without the browser.
// Usage: OPENROUTER_API_KEY=... bun tooling/grouping-probe.ts <diff file> [model] [title]
import { readFile } from 'node:fs/promises'
import { parseUnifiedDiff } from '../src/lib/diff/parse-diff'
import { buildSkeleton } from '../src/lib/layers/build-skeleton'
import {
	condenseForGrouping,
	diffExcerpts,
	RICH_BODY_LIMIT,
	RICH_BUDGET,
} from '../src/lib/layers/condense'
import { fileIds, resolveFileIds } from '../src/lib/layers/file-ids'
import { buildCochangeEdges, buildEdges } from '../src/lib/layers/graph'
import { applyGrouping } from '../src/lib/layers/grouping'
import { groupLayersWithOpenRouter } from '../src/lib/model/openrouter'
import { DEFAULT_MODEL } from '../src/lib/settings'

const [diffPath, model = DEFAULT_MODEL, title = '(untitled)'] = process.argv.slice(2)
const key = process.env.OPENROUTER_API_KEY ?? ''
if (!diffPath || !key) {
	console.error(
		'usage: OPENROUTER_API_KEY=... bun tooling/grouping-probe.ts <diff> [model] [title]',
	)
	process.exit(1)
}

const files = parseUnifiedDiff(await readFile(diffPath, 'utf8'))
const skeleton = buildSkeleton(files, buildEdges(files), buildCochangeEdges(files))
const body = process.env.PR_BODY ?? ''
const list = condenseForGrouping(
	skeleton,
	files,
	{ title, body },
	{ budget: RICH_BUDGET, bodyLimit: RICH_BODY_LIMIT },
)
const excerpts = [...diffExcerpts(files, skeleton).values()]
const input = `${list}\n\n## Diff\n\n${excerpts.join('\n\n')}`
console.error(
	`prompt: ${input.length} chars, ${files.length} files, max ${skeleton.maxLayers} steps, model ${model}`,
)

const started = Date.now()
const { layers, error } = await groupLayersWithOpenRouter({ key, model, input })
console.error(`took ${((Date.now() - started) / 1000).toFixed(1)}s`)
if (!layers) {
	console.error('error', error)
	process.exit(2)
}
const resolved = resolveFileIds(layers, fileIds(list))
for (const [index, layer] of (applyGrouping(skeleton, resolved) ?? []).entries()) {
	console.log(`\n${index + 1}. ${layer.name} (${layer.files.length})`)
	console.log(`   ${layer.summary}`)
	for (const file of layer.files) console.log(`   - ${file.path}`)
}
