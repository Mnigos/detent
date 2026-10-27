import type { PrioritizeResponse } from '../model/label-priorities'
import { formatCost } from '../model/usage'
import { STATUS_LINES } from '../panel/status'

export const PRIORITY_LINES = {
	analyzing: 'Ranking the files with the model…',
	fallback: 'Priorities come from the file structure.',
	missingKey:
		'Priorities come from the file structure. Add an OpenRouter key in the extension popup to rank them with a model.',
	timeout: 'OpenRouter took too long; priorities come from the file structure.',
	request: 'OpenRouter request failed; priorities come from the file structure.',
}

export function priorityStatusFor({
	source,
	labeler,
	model,
	cost,
	error,
	cacheError,
}: Omit<PrioritizeResponse, 'priorities'>): string {
	if (cacheError) return 'Priorities ready, but could not be saved. Reloading may rank them again.'
	if (source === 'model')
		return cost === undefined
			? `Priorities from ${model}.`
			: `Priorities from ${model} · ${formatCost(cost)}.`
	if (error?.kind === 'unauthorized' || error?.kind === 'credits') return STATUS_LINES[error.kind]
	if (error) return PRIORITY_LINES[error.kind === 'timeout' ? 'timeout' : 'request']
	if (labeler === 'none') return PRIORITY_LINES.missingKey

	return PRIORITY_LINES.fallback
}
