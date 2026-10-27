// Measures what the worker would send for a diff, without any model. Usage: bun tooling/offline-probe.ts <diff>
import { readFile } from 'node:fs/promises'
import { parseUnifiedDiff } from '../src/lib/diff/parse-diff'
import { buildSkeleton } from '../src/lib/layers/build-skeleton'
import { condenseForGrouping, diffExcerpts } from '../src/lib/layers/condense'
import { buildCochangeEdges, buildEdges } from '../src/lib/layers/graph'

const files = parseUnifiedDiff(await readFile(process.argv[2] ?? '', 'utf8'))
const skeleton = buildSkeleton(files, buildEdges(files), buildCochangeEdges(files))
const list = condenseForGrouping(skeleton, files, { title: 'T', body: '' })
const excerpts = [...diffExcerpts(files, skeleton).values()]
const input = `${list}\n\n## Diff\n\n${excerpts.join('\n\n')}`
console.log({
	files: files.length,
	reviewable: skeleton.layers.flatMap((l) => l.files).filter((f) => f.role !== 'generated').length,
	maxLayers: skeleton.maxLayers,
	listChars: list.length,
	excerptChars: excerpts.join('\n\n').length,
	promptChars: input.length,
	layers: skeleton.layers.map(
		(l) => `${l.fallbackName}:${l.files.length}${l.isTrailing ? ' (trailing)' : ''}`,
	),
})
console.log(list.split('\n').slice(0, 6).join('\n'))
