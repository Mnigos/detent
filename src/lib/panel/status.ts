import type { LabelLayersResponse } from '../model/label-layers'
import { formatCost } from '../model/usage'

export const STATUS_LINES = {
	analyzing: 'Grouping the files with the model…',
	interrupted: 'The analysis did not come back; reload the page to try again.',
	missingKey: 'Add an OpenRouter key in the extension popup to name the layers.',
	fallback: 'Layer names come from the file structure.',
	unauthorized: 'OpenRouter rejected the API key. Check it in the extension popup.',
	credits: 'OpenRouter reports no credits left.',
	timeout: 'OpenRouter took too long; layer names come from the file structure.',
	request: 'OpenRouter request failed; layer names come from the file structure.',
}

export function statusLineFor({
	source,
	labeler,
	model,
	cost,
	error,
	isStale,
	cacheError,
	qualityWarning,
}: Omit<LabelLayersResponse, 'layers'>): string {
	if (qualityWarning)
		return 'Some review steps could not be grouped reliably. Unassigned files remain separate.'
	if (cacheError) return 'Analysis ready, but could not be saved. Reloading may run it again.'
	if (isStale)
		return error
			? 'Could not update analysis. Showing saved groups.'
			: 'Showing saved groups; updating changed files.'
	if (source === 'model')
		return cost === undefined
			? `Layer names from ${model}.`
			: `Layer names from ${model} · ${formatCost(cost)}.`
	if (error) return STATUS_LINES[error.kind === 'invalid' ? 'request' : error.kind]
	if (labeler === 'none') return STATUS_LINES.missingKey

	return STATUS_LINES.fallback
}
