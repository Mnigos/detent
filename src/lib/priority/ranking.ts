import type { DiffFile } from '../diff/parse-diff'
import type { PullRequestSummary } from '../layers/condense'
import { requestPriorities } from '../model/label-priorities'
import { STATUS_LINES } from '../panel/status'
import type { PanelFile, PanelLayer, PanelStore } from '../panel/store'
import { heuristicPriorities } from './heuristic'
import { condenseForPriorities } from './prompt'
import type { PriorityEntry } from './schema'
import { buildPrioritySections } from './sections'
import { PRIORITY_LINES, priorityStatusFor } from './status'

export interface PriorityPlan {
	files: PanelFile[]
	/** The structural ranking: shown at once and filling in whatever the model leaves out. */
	fallback: PriorityEntry[]
	sections: PanelLayer[]
	input: string
}

export function planPriorities(
	diffFiles: readonly DiffFile[],
	layers: readonly PanelLayer[],
	summary: PullRequestSummary,
): PriorityPlan {
	const statuses = new Map(diffFiles.map((file) => [file.path, file.status]))
	const files = layers.flatMap((layer) => layer.files)
	const ranked = files.map(({ path, role, additions, deletions }) => ({
		path,
		role,
		additions,
		deletions,
		status: statuses.get(path) ?? 'modified',
	}))
	const fallback = heuristicPriorities(ranked)

	return {
		files,
		fallback,
		sections: buildPrioritySections(files, fallback),
		input: condenseForPriorities(ranked, summary),
	}
}

interface PriorityRequestOptions {
	plan: PriorityPlan
	store: PanelStore
	scope: string
	digest: string
	diffExcerpts?: Record<string, string>
	isActive: () => boolean
}

/** Asks the model once per page, the first time Priority Review is on screen. */
export function createPriorityRequest({
	plan,
	store,
	scope,
	digest,
	diffExcerpts,
	isActive,
}: PriorityRequestOptions): () => void {
	let isAsked = false

	async function rank() {
		store.dispatch({
			type: 'priorities',
			layers: store.getSnapshot().priorityLayers,
			status: PRIORITY_LINES.analyzing,
		})
		const response = await requestPriorities({
			scope,
			digest,
			input: plan.input,
			diffExcerpts,
		}).catch(() => undefined)
		if (!isActive()) return

		const layers = response?.priorities
			? buildPrioritySections(plan.files, response.priorities, plan.fallback)
			: store.getSnapshot().priorityLayers
		store.dispatch({
			type: 'priorities',
			layers,
			status: response ? priorityStatusFor(response) : STATUS_LINES.interrupted,
		})
	}

	return () => {
		if (isAsked) return

		isAsked = true
		void rank()
	}
}
