import type { LabelLayersResponse } from '../model/label-layers'
import type { ModelError } from '../model/provider'
import { formatCost } from '../model/usage'

export const STATUS_LINES = {
	analyzing: 'Grouping the files with the model…',
	interrupted: 'The analysis did not come back; reload the page to try again.',
	missingKey: 'Set up a model provider in the extension popup to name the layers.',
	fallback: 'Layer names come from the file structure.',
	unauthorized: 'OpenRouter rejected the API key. Check it in the extension popup.',
	credits: 'OpenRouter reports no credits left.',
	timeout: 'OpenRouter took too long; layer names come from the file structure.',
	request: 'OpenRouter request failed; layer names come from the file structure.',
}

/** A ChatGPT failure in one short line; `outcome` says what the page shows instead. */
export function chatGptErrorLine(kind: ModelError['kind'], outcome: string): string {
	const cause = {
		unauthorized: 'Sign in to ChatGPT again in the extension popup',
		limit: 'ChatGPT plan usage limit reached',
		unavailable: 'ChatGPT plan usage is unavailable right now',
		ineligible: 'ChatGPT plan usage is not available for this account',
		timeout: 'ChatGPT took too long',
	}[kind as string]

	return `${cause ?? 'ChatGPT request failed'}; ${outcome}.`
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
	if (error?.provider === 'chatgpt')
		return chatGptErrorLine(error.kind, 'layer names come from the file structure')
	if (error)
		return STATUS_LINES[
			error.kind === 'unauthorized' || error.kind === 'credits' || error.kind === 'timeout'
				? error.kind
				: 'request'
		]
	if (labeler === 'none') return STATUS_LINES.missingKey

	return STATUS_LINES.fallback
}
