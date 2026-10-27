import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { anchorIdForPath } from '../lib/panel/github-dom'
import type { PanelLayer, PanelState } from '../lib/panel/store'
import { findNativeTree, readTemplates, type TreeTemplates } from '../lib/tree/native'

const COMMANDS = 'apps/api/src/modules/billing/application/commands'
export const ENV = 'apps/api/src/config/env/env.schema.ts'
export const HANDLER = `${COMMANDS}/deliver-billing-lifecycle-analytics.handler.ts`
export const HANDLER_SPEC = `${COMMANDS}/deliver-billing-lifecycle-analytics.handler.spec.ts`
export const COMMAND = `${COMMANDS}/deliver-billing-lifecycle-analytics.command.ts`
export const CANCEL = `${COMMANDS}/cancel-renewable-billing-plan.handler.ts`
export const LOCK = 'bun.lock'
export const ENV_ANCHOR = 'diff-cacb728022645523946d1da01344febbdd4aec98800e98c160b5d5fcf1d19340'
export const HANDLER_SPEC_ANCHOR =
	'diff-27b96060f215fc3c8f64112be37b99161a750657c3fbbf98663a3e7a1f839aca'

const layer = (id: string, name: string, summary: string, ...paths: string[]): PanelLayer => ({
	id,
	name,
	summary,
	isTrailing: id === 'generated',
	files: paths.map((path) => ({ path, role: 'other', additions: 1, deletions: 0 })),
})

export const LAYERS = [
	layer('env', 'Extend the environment schema', 'Check the new variables first.', ENV),
	layer(
		'billing',
		'Record lifecycle analytics',
		'Follow the command into its handler.',
		COMMAND,
		HANDLER,
		CANCEL,
		HANDLER_SPEC,
	),
	layer('generated', 'Generated', '', LOCK),
]

export const pageState = (overrides: Partial<PanelState> = {}): PanelState => ({
	layers: LAYERS,
	layerIndex: 1,
	fileIndex: 1,
	isRaw: false,
	isCollapsed: false,
	viewed: new Set([COMMAND]),
	status: 'Layer names come from the file structure.',
	isAnalyzing: false,
	isTrailingExpanded: false,
	...overrides,
})

export const nativeTree = () => findNativeTree() as HTMLUListElement

export async function loadChangesPage(): Promise<{
	anchorIds: Map<string, string>
	templates: TreeTemplates
}> {
	document.body.innerHTML = readFileSync(
		resolve(process.cwd(), 'fixtures/github-changes-tree.html'),
		'utf8',
	)
	window.location.hash = ''
	const anchorIds = new Map(
		await Promise.all(
			LAYERS.flatMap((entry) => entry.files).map(
				async ({ path }) => [path, await anchorIdForPath(path)] as const,
			),
		),
	)

	return { anchorIds, templates: readTemplates(nativeTree()) as TreeTemplates }
}
