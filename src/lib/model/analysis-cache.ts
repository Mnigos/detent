import { browser } from 'wxt/browser'
import { toGroupingEntries } from '../layers/grouping'
import type { LabelLayersRequest, LabelLayersResponse } from './label-layers'

export interface AnalysisFile {
	path: string
	digest: string
}

export interface AnalysisSnapshot {
	digest: string
	files: AnalysisFile[]
	response: LabelLayersResponse
}

const SAVES = new Map<string, Promise<void>>()
const HISTORY_LIMIT = 5
// Bump when the prompt or its inputs change shape: answers to the old prompt must not be reused.
export const PROMPT_VERSION = 'p3'

export function analysisKeys(request: LabelLayersRequest, labeler: string) {
	const scope = `analysis:${PROMPT_VERSION}:${request.scope.toLowerCase()}:${labeler}`
	return {
		exact: `${scope}:${request.digest}`,
		latest: `${scope}:latest`,
		history: `${scope}:history`,
	}
}

function readResponse(value: unknown): LabelLayersResponse | undefined {
	if (!value || typeof value !== 'object') return undefined
	const entry = value as Partial<LabelLayersResponse>
	const grouping = toGroupingEntries(entry.grouping)
	if (!grouping || entry.labeler !== 'openrouter') return undefined
	return {
		layers: [],
		grouping,
		source: 'model',
		labeler: 'openrouter',
		model: entry.model,
		groupingChecked: entry.groupingChecked === true || undefined,
		qualityWarning: entry.qualityWarning === true || undefined,
	}
}

function readSnapshot(value: unknown): AnalysisSnapshot | undefined {
	if (!value || typeof value !== 'object') return undefined
	const entry = value as Partial<AnalysisSnapshot>
	const response = readResponse(entry.response)
	if (typeof entry.digest !== 'string' || !Array.isArray(entry.files) || !response) return undefined
	if (
		!entry.files.every(
			(file) => file && typeof file.path === 'string' && typeof file.digest === 'string',
		)
	)
		return undefined
	return { digest: entry.digest, files: entry.files, response }
}

const STALE_KEY = new RegExp(`^(?:layers:|analysis:(?!${PROMPT_VERSION}:))`)
let swept = false

/** Answers to earlier prompts are never read again, so they only take quota: drop them once per worker life. */
async function sweepStaleAnalyses() {
	if (swept) return
	swept = true
	const stored = await browser.storage.local.get(null)
	const stale = Object.keys(stored).filter((key) => STALE_KEY.test(key))
	if (stale.length > 0) await browser.storage.local.remove(stale)
}

export async function readAnalysisCache(request: LabelLayersRequest, labeler: string) {
	const keys = analysisKeys(request, labeler)
	await sweepStaleAnalyses().catch(() => undefined)
	const stored = await browser.storage.local.get([keys.exact, keys.latest])
	const exact = readSnapshot(stored[keys.exact])
	const previous = readSnapshot(stored[keys.latest])
	const usable = (response: LabelLayersResponse) =>
		!response.grouping ||
		request.files.length === 0 ||
		response.grouping.some((group) =>
			group.files.some((path) => request.files.some((file) => file.path === path)),
		)
	if (exact?.digest === request.digest && usable(exact.response)) return { exact, previous }
	if (previous?.digest === request.digest && usable(previous.response))
		return { exact: previous, previous }
	return {
		exact: undefined,
		previous: previous && usable(previous.response) ? previous : undefined,
	}
}

export async function saveAnalysis(
	request: LabelLayersRequest,
	labeler: string,
	response: LabelLayersResponse,
	isLatest: () => boolean,
) {
	const keys = analysisKeys(request, labeler)
	const snapshot: AnalysisSnapshot = { digest: request.digest, files: request.files, response }
	async function save() {
		const stored = await browser.storage.local.get(keys.history)
		const value = stored[keys.history]
		const history: string[] = Array.isArray(value)
			? value.filter(
					(key: unknown): key is string =>
						typeof key === 'string' &&
						key.startsWith(keys.exact.slice(0, keys.exact.lastIndexOf(':') + 1)) &&
						key !== keys.latest &&
						key !== keys.history,
				)
			: []
		const ordered = [keys.exact, ...history.filter((key) => key !== keys.exact)]
		await browser.storage.local.set({
			[keys.exact]: snapshot,
			[keys.history]: ordered.slice(0, HISTORY_LIMIT),
			...(isLatest() ? { [keys.latest]: snapshot } : {}),
		})
		if (ordered.length > HISTORY_LIMIT)
			await browser.storage.local.remove(ordered.slice(HISTORY_LIMIT))
	}
	const work = (SAVES.get(keys.latest) ?? Promise.resolve()).catch(() => undefined).then(save)
	SAVES.set(keys.latest, work)
	try {
		await work
	} finally {
		if (SAVES.get(keys.latest) === work) SAVES.delete(keys.latest)
	}
}
