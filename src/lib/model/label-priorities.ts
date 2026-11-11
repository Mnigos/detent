import { browser } from 'wxt/browser'
import { fileIds } from '../layers/file-ids'
import type { PriorityEntry } from '../priority/schema'
import { readSettings } from '../settings'
import { keepWorkerAlive, withExcerpts } from './label-layers'
import { readPriorityCache, savePriorities } from './priority-cache'
import {
	failure,
	type ModelError,
	type ModelProvider,
	type ProviderId,
	resolveProvider,
} from './provider'

export const PRIORITIZE_MESSAGE = 'detent:prioritize'

export interface PrioritizeRequest {
	type: typeof PRIORITIZE_MESSAGE
	scope: string
	digest: string
	/** Pull request summary, the ranking instruction and one numbered line per file. */
	input: string
	/** Per-path diff excerpts the model reads after the list. */
	diffExcerpts?: Record<string, string>
}

export interface PrioritizeResponse {
	priorities?: PriorityEntry[]
	source: 'model' | 'fallback'
	labeler: ProviderId | 'none'
	model?: string
	error?: ModelError
	/** US dollars this very answer cost; absent for cached answers. */
	cost?: number
	cacheError?: boolean
}

const IN_FLIGHT = new Map<string, Promise<PrioritizeResponse>>()
const RECENT_FAILURES = new Map<string, { response: PrioritizeResponse; until: number }>()
const FAILURE_COOLDOWN_MILLISECONDS = 30_000

async function rank(
	provider: ModelProvider,
	{ input, diffExcerpts }: PrioritizeRequest,
): Promise<PrioritizeResponse> {
	const { id, model } = provider
	const release = keepWorkerAlive()
	const started = Date.now()
	const ids = fileIds(input)
	console.info(`[detent] ${id} ${model}: ranking ${ids.size} files`)
	let answer: Awaited<ReturnType<ModelProvider['prioritize']>>
	try {
		answer = await provider.prioritize(withExcerpts(input, diffExcerpts))
	} finally {
		release()
	}
	const { value: priorities, error, cost } = answer
	const seconds = ((Date.now() - started) / 1000).toFixed(1)
	if (priorities)
		console.info(
			`[detent] ${id} ranked ${priorities.length} files in ${seconds}s, cost ${cost ?? '?'}`,
		)
	else
		console.warn(
			`[detent] ${id} ranking failed in ${seconds}s: ${error?.kind}${error?.status ? ` (HTTP ${error.status})` : ''}`,
		)
	if (!priorities) return { source: 'fallback', labeler: 'none', model, error }

	const paths = new Map([...ids].map(([path, id]) => [id, path]))
	const known = new Set(ids.keys())
	const resolved = priorities
		.map((entry) => ({ ...entry, path: paths.get(entry.path) ?? entry.path }))
		.filter((entry) => known.has(entry.path))
	// An answer that names none of the files ranks nothing, whatever the model claims.
	if (resolved.length === 0)
		return { source: 'fallback', labeler: 'none', model, error: failure('invalid', id) }

	return { priorities: resolved, source: 'model', labeler: id, model, cost }
}

export async function resolvePriorities(request: PrioritizeRequest): Promise<PrioritizeResponse> {
	const configured = await resolveProvider(await readSettings())
	if (!configured) return { source: 'fallback', labeler: 'none' }

	const provider: ModelProvider = configured

	const { labeler, model } = provider
	const cached = await readPriorityCache(request.scope, request.digest, labeler).catch(
		() => undefined,
	)
	if (cached)
		return {
			priorities: cached.priorities,
			source: 'model',
			labeler: provider.id,
			model: cached.model ?? model,
		}

	const flightKey = `${request.scope}:${request.digest}:${labeler}`
	const pending = IN_FLIGHT.get(flightKey)
	if (pending) return pending
	const recent = RECENT_FAILURES.get(flightKey)
	if (recent && recent.until > Date.now()) return recent.response

	async function work(): Promise<PrioritizeResponse> {
		const response = await rank(provider, request)
		if (!response.priorities) {
			RECENT_FAILURES.set(flightKey, {
				response,
				until: Date.now() + FAILURE_COOLDOWN_MILLISECONDS,
			})
			return response
		}
		try {
			await savePriorities(request.scope, request.digest, labeler, {
				model,
				priorities: response.priorities,
			})
		} catch {
			return { ...response, cacheError: true }
		}
		return response
	}

	const running = work()
	IN_FLIGHT.set(flightKey, running)
	try {
		return await running
	} finally {
		IN_FLIGHT.delete(flightKey)
	}
}

export async function requestPriorities(
	request: Omit<PrioritizeRequest, 'type'>,
): Promise<PrioritizeResponse | undefined> {
	return (await browser.runtime.sendMessage({ ...request, type: PRIORITIZE_MESSAGE })) as
		| PrioritizeResponse
		| undefined
}
