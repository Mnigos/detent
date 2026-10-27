import { GROUPING_SCHEMA, type GroupingEntry, parseGroupingResponse } from '../layers/grouping'
import { PRIORITY_SCHEMA, type PriorityEntry, parsePriorityResponse } from '../priority/schema'
import { type UsageDelta, usageOf } from './usage'

export const LABEL_TIMEOUT_MILLISECONDS = 20_000
const MAX_TIMEOUT_MILLISECONDS = 180_000
const MAX_ANSWER_TOKENS = 32_000

// A 400-file pull request is a 60k-token prompt and a 400-line answer: the deadline and the answer
// room grow with the input instead of failing at the size of a small PR.
export const timeoutFor = (input: string) =>
	Math.min(
		MAX_TIMEOUT_MILLISECONDS,
		LABEL_TIMEOUT_MILLISECONDS + Math.ceil(input.length / 2000) * 1000,
	)
export const answerTokensFor = (input: string, tokensPerFile = 24) =>
	Math.min(MAX_ANSWER_TOKENS, 4000 + (input.match(/ @\d+$/gm)?.length ?? 0) * tokensPerFile)
// A ranked file is its number, its priority and often a reason line.
const PRIORITY_TOKENS_PER_FILE = 40

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

export interface OpenRouterError {
	kind: 'unauthorized' | 'credits' | 'request' | 'timeout' | 'invalid'
	status?: number
}

export interface OpenRouterCall {
	key: string
	model: string
}

export interface OpenRouterGrouping {
	layers?: GroupingEntry[]
	error?: OpenRouterError
	usage?: UsageDelta
}

export interface OpenRouterPriorities {
	priorities?: PriorityEntry[]
	error?: OpenRouterError
	usage?: UsageDelta
}

interface Completion {
	content?: string
	error?: OpenRouterError
	usage?: UsageDelta
}

async function complete(
	{ key, model }: OpenRouterCall,
	body: object,
	timeout = LABEL_TIMEOUT_MILLISECONDS,
): Promise<Completion> {
	let response: Response
	try {
		response = await fetch(OPENROUTER_URL, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${key}`,
				'Content-Type': 'application/json',
				'HTTP-Referer': 'https://github.com/Mnigos/detent',
				'X-Title': 'detent for GitHub',
			},
			// The usage block carries the cost of this very response; the popup sums them up.
			body: JSON.stringify({ model, ...body, usage: { include: true } }),
			signal: AbortSignal.timeout(timeout),
		})
	} catch (error) {
		const isTimeout = error instanceof DOMException && error.name === 'TimeoutError'

		return { error: { kind: isTimeout ? 'timeout' : 'request' } }
	}
	const { status } = response
	if (!response.ok)
		return {
			error: {
				kind:
					status === 401 || status === 403
						? 'unauthorized'
						: status === 402
							? 'credits'
							: 'request',
				status,
			},
		}

	try {
		const payload = await response.json()
		const content = payload?.choices?.[0]?.message?.content
		const usage = usageOf(payload)

		return typeof content === 'string' ? { content, usage } : { error: { kind: 'invalid' }, usage }
	} catch {
		return { error: { kind: 'invalid' } }
	}
}

export async function groupLayersWithOpenRouter({
	input,
	...call
}: OpenRouterCall & { input: string }): Promise<OpenRouterGrouping> {
	const { content, error, usage } = await complete(
		call,
		{
			messages: [{ role: 'user', content: input }],
			response_format: {
				type: 'json_schema',
				json_schema: { name: 'layers', strict: true, schema: GROUPING_SCHEMA },
			},
			reasoning: { effort: 'low' },
			// Reasoning tokens count against this on OpenAI models; the answer lists every file once.
			max_tokens: answerTokensFor(input),
		},
		timeoutFor(input),
	)
	if (error) return { error, usage }

	const layers = parseGroupingResponse(content ?? '')

	return layers ? { layers, usage } : { error: { kind: 'invalid' }, usage }
}

export async function prioritizeWithOpenRouter({
	input,
	...call
}: OpenRouterCall & { input: string }): Promise<OpenRouterPriorities> {
	const { content, error, usage } = await complete(
		call,
		{
			messages: [{ role: 'user', content: input }],
			response_format: {
				type: 'json_schema',
				json_schema: { name: 'priorities', strict: true, schema: PRIORITY_SCHEMA },
			},
			reasoning: { effort: 'low' },
			max_tokens: answerTokensFor(input, PRIORITY_TOKENS_PER_FILE),
		},
		timeoutFor(input),
	)
	if (error) return { error, usage }

	const priorities = parsePriorityResponse(content ?? '')

	return priorities ? { priorities, usage } : { error: { kind: 'invalid' }, usage }
}

export async function testOpenRouter(call: OpenRouterCall): Promise<OpenRouterError | undefined> {
	const { error } = await complete(call, {
		messages: [{ role: 'user', content: 'Reply with OK.' }],
		max_tokens: 5,
	})

	return error
}
