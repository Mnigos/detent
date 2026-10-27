import { browser } from 'wxt/browser'
import type { Skeleton } from '../layers/build-skeleton'
import { RICH_BUDGET } from '../layers/condense'
import { fileIds, resolveFileIds } from '../layers/file-ids'
import type { GroupingEntry } from '../layers/grouping'
import type { LabelEntry } from '../layers/label-schema'
import { STEP_SIZE_LIMIT } from '../layers/layer-budget'
import { hasUnassigned, placeLeftovers } from '../layers/leftovers'
import { readSettings, type Settings } from '../settings'
import { type AnalysisFile, analysisKeys, readAnalysisCache, saveAnalysis } from './analysis-cache'
import { groupingRepairPaths, groupingSnapshot } from './grouping-quality'
import { prepareGroupingUpdate } from './incremental-grouping'
import { groupLayersWithOpenRouter, type OpenRouterError, timeoutFor } from './openrouter'
import { recordUsage } from './usage'

export const LABEL_LAYERS_MESSAGE = 'detent:label-layers'

export interface LabelLayersRequest {
	type: typeof LABEL_LAYERS_MESSAGE
	digest: string
	scope: string
	files: AnalysisFile[]
	maxLayers: number
	cacheOnly?: boolean
	skeleton?: Skeleton
	/** File list with its signals and the pull request description. */
	groupingInput: string
	/** Per-path diff excerpts the model reads after the list. */
	diffExcerpts?: Record<string, string>
}

export interface LabelLayersResponse {
	layers: LabelEntry[]
	grouping?: GroupingEntry[]
	source: 'model' | 'fallback'
	labeler: 'openrouter' | 'none'
	model?: string
	error?: OpenRouterError
	/** US dollars this very answer cost; absent for cached answers. */
	cost?: number
	isStale?: boolean
	cacheError?: boolean
	groupingChecked?: boolean
	qualityWarning?: boolean
}

const IN_FLIGHT = new Map<string, Promise<LabelLayersResponse>>()
const LATEST_REQUESTS = new Map<string, string>()
const RECENT_FAILURES = new Map<string, { response: LabelLayersResponse; until: number }>()
const FAILURE_COOLDOWN_MILLISECONDS = 30_000
const KEEPALIVE_MILLISECONDS = 20_000
// Splitting is one request per oversized step; a few cover any pull request without a runaway bill.
const SPLIT_REQUESTS = 4
const isOversized = (group: GroupingEntry) => group.files.length > STEP_SIZE_LIMIT * 1.6
const splitIntent = (name: string) =>
	`Split the step "${name}" into consecutive steps of at most ${STEP_SIZE_LIMIT} files each, one per behavior, each with its own title and summary, keeping the reading order. Return only those steps.`

// Chrome ends an idle MV3 worker after 30 seconds; a model call on a large pull request takes
// longer. Any extension API call resets that clock, so one is made while the request runs.
function keepWorkerAlive(): () => void {
	const timer = setInterval(() => {
		void browser.runtime.getPlatformInfo().catch(() => undefined)
	}, KEEPALIVE_MILLISECONDS)

	return () => clearInterval(timer)
}

async function fromOpenRouter(
	{ openRouterKey: key, model }: Settings,
	input: string,
	ids: Map<string, string>,
): Promise<LabelLayersResponse> {
	const release = keepWorkerAlive()
	const started = Date.now()
	// These lines are what a reviewer pastes when the layers stay structural; keep them complete.
	console.info(
		`[detent] openrouter ${model}: ${ids.size} files, ${input.length} chars, deadline ${Math.round(timeoutFor(input) / 1000)}s`,
	)
	let answer: Awaited<ReturnType<typeof groupLayersWithOpenRouter>>
	try {
		answer = await groupLayersWithOpenRouter({ key, model, input })
	} finally {
		release()
	}
	const { layers, error, usage } = answer
	const seconds = ((Date.now() - started) / 1000).toFixed(1)
	if (layers)
		console.info(
			`[detent] openrouter answered in ${seconds}s: ${layers.length} steps, ${layers.reduce((count, group) => count + group.files.length, 0)} files placed, cost ${usage?.cost ?? '?'}`,
		)
	else
		console.warn(
			`[detent] openrouter failed in ${seconds}s: ${error?.kind}${error?.status ? ` (HTTP ${error.status})` : ''}`,
		)
	if (usage) await recordUsage(usage).catch(() => undefined)
	if (!layers) return { layers: [], source: 'fallback', labeler: 'none', model, error }

	return {
		layers: [],
		grouping: resolveFileIds(layers, ids),
		source: 'model',
		labeler: 'openrouter',
		model,
		cost: usage?.cost,
	}
}

function withExcerpts(
	input: string,
	excerpts: Record<string, string> | undefined,
	paths?: Iterable<string>,
): string {
	if (!excerpts) return input
	const wanted = paths ? new Set(paths) : undefined
	const blocks = Object.entries(excerpts)
		.filter(([path]) => !wanted || wanted.has(path))
		.map(([, block]) => block)

	return blocks.length > 0 ? `${input}\n\n## Diff\n\n${blocks.join('\n\n')}` : input
}

export async function resolveLayerLabels(
	incoming: LabelLayersRequest,
): Promise<LabelLayersResponse | undefined> {
	const settings = await readSettings()
	// Without a key there is no model to ask and nothing cached under one.
	if (!settings.openRouterKey)
		return incoming.cacheOnly ? undefined : { layers: [], source: 'fallback', labeler: 'none' }

	const labeler = `openrouter:${settings.model}`
	const request = incoming
	const ids = fileIds(request.groupingInput)
	const excerpts = incoming.diffExcerpts
	const budget = RICH_BUDGET
	const keys = analysisKeys(request, labeler)
	LATEST_REQUESTS.set(keys.latest, request.digest)
	const cached = await readAnalysisCache(request, labeler).catch(() => undefined)
	const exact = groupingSnapshot(cached?.exact, request)
	const previous = exact ?? groupingSnapshot(cached?.previous, request)
	// A checked analysis is final, unless it still parks files as unassigned: those get asked again.
	const repairPaths =
		previous && (!previous.response.groupingChecked || hasUnassigned(previous.response.grouping))
			? groupingRepairPaths(previous.response.grouping ?? [], request)
			: []
	const needsRepair =
		repairPaths.length > 0 ||
		Boolean(exact && !exact.response.grouping && request.skeleton) ||
		// A saved answer with a step too big to review gets its split on the next visit.
		Boolean(exact?.response.grouping?.some(isOversized))
	if (exact && !needsRepair) {
		try {
			await saveAnalysis(
				request,
				labeler,
				exact.response,
				() => LATEST_REQUESTS.get(keys.latest) === request.digest,
			)
		} catch {
			return { ...exact.response, cacheError: true }
		}
		return exact.response
	}
	if (request.cacheOnly) return previous ? { ...previous.response, isStale: true } : undefined
	const pending = IN_FLIGHT.get(keys.exact)
	if (pending) return pending
	const recent = RECENT_FAILURES.get(keys.exact)
	if (recent && recent.until > Date.now()) return recent.response

	async function analyze(): Promise<LabelLayersResponse> {
		const update = prepareGroupingUpdate(
			previous ?? {
				digest: '',
				files: [],
				response: { layers: [], source: 'fallback', labeler: 'none' },
			},
			request,
			repairPaths,
			budget,
		)
		let candidate =
			update &&
			((update.changed.size === 0 && update.removed.size === 0) || update.paths.size === 0) &&
			previous
				? previous.response
				: await fromOpenRouter(
						settings,
						previous && update
							? withExcerpts(update.input, excerpts, update.paths)
							: withExcerpts(request.groupingInput, excerpts),
						ids,
					)
		const scopedRequest = {
			...request,
			files: request.files.filter((file) => update.paths.has(file.path)),
		}
		const issues = candidate.grouping ? groupingRepairPaths(candidate.grouping, scopedRequest) : []
		if (
			!needsRepair &&
			issues.length > 0 &&
			candidate.grouping?.some((group) => group.files.some((path) => update.paths.has(path)))
		) {
			const correction = prepareGroupingUpdate(
				{ digest: request.digest, files: scopedRequest.files, response: candidate },
				scopedRequest,
				issues,
				budget,
			)
			const corrected = await fromOpenRouter(
				settings,
				withExcerpts(correction.input, excerpts, correction.paths),
				ids,
			)
			if (
				corrected.grouping?.some((group) => group.files.some((path) => correction.paths.has(path)))
			)
				candidate = { ...corrected, grouping: correction.merge(corrected.grouping) }
		}
		// A step of 150 files is not reviewable; every oversized step is asked for its split at the
		// same time, then the answers are merged in one by one while the rest stays as answered.
		const oversized = (candidate.grouping ?? []).filter(isOversized).slice(0, SPLIT_REQUESTS)
		const base = candidate
		const answers = await Promise.all(
			oversized.map(async (group) => {
				const split = prepareGroupingUpdate(
					{ digest: request.digest, files: request.files, response: base },
					request,
					group.files,
					budget,
					splitIntent(group.name),
				)
				const answer = await fromOpenRouter(
					settings,
					withExcerpts(split.input, excerpts, split.paths),
					ids,
				)
				const pieces = answer.grouping?.filter((entry) =>
					entry.files.some((path) => split.paths.has(path)),
				)

				return { group, pieces }
			}),
		)
		for (const { group, pieces } of answers) {
			if (!pieces || pieces.length < 2) continue

			// Each merge is rebuilt on the candidate as it stands, so earlier splits are kept.
			const merge = prepareGroupingUpdate(
				{ digest: request.digest, files: request.files, response: candidate },
				request,
				group.files,
				budget,
			).merge
			candidate = { ...candidate, grouping: merge(pieces) }
		}
		const allowed = update?.paths ?? new Set(request.files.map((file) => file.path))
		const response: LabelLayersResponse =
			candidate.grouping &&
			allowed.size > 0 &&
			!candidate.grouping.some((group) => group.files.some((path) => allowed.has(path)))
				? { layers: [], source: 'fallback', labeler: 'none', error: { kind: 'invalid' } }
				: candidate
		if (response.source !== 'model') {
			const fallback = previous
				? {
						...previous.response,
						grouping: update?.merge([]) ?? previous.response.grouping,
						isStale: true,
						error: response.error ?? { kind: 'request' as const },
					}
				: response
			RECENT_FAILURES.set(keys.exact, {
				response: fallback,
				until: Date.now() + FAILURE_COOLDOWN_MILLISECONDS,
			})
			return fallback
		}
		const merged =
			update && response.grouping && (update.changed.size > 0 || update.removed.size > 0)
				? { ...response, grouping: update.merge(response.grouping) }
				: response
		// Whatever the model left out lands next to its neighbours rather than in a leftover bucket.
		const grouping =
			merged.grouping &&
			placeLeftovers(
				merged.grouping,
				request.files.map((file) => file.path),
			)
		const result = {
			...merged,
			grouping,
			groupingChecked: true,
			qualityWarning: groupingRepairPaths(grouping ?? [], request).length > 0 || undefined,
		}
		try {
			await saveAnalysis(
				request,
				labeler,
				result,
				() => LATEST_REQUESTS.get(keys.latest) === request.digest,
			)
		} catch {
			return { ...result, cacheError: true }
		}
		return result
	}

	const work = analyze()
	IN_FLIGHT.set(keys.exact, work)
	try {
		return await work
	} finally {
		IN_FLIGHT.delete(keys.exact)
	}
}

export async function requestLayerLabels(
	request: Omit<LabelLayersRequest, 'type'>,
): Promise<LabelLayersResponse | undefined> {
	return (await browser.runtime.sendMessage({ ...request, type: LABEL_LAYERS_MESSAGE })) as
		| LabelLayersResponse
		| undefined
}
