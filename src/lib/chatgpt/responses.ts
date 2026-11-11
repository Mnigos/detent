// Responses API on the ChatGPT plan, under the preview's rules: store false, stream true, an input
// array, instructions instead of system messages, none of the unsupported fields (max_output_tokens,
// temperature, metadata, user, ...), and success only on `response.completed`.
// https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
import type { ModelError } from '../model/provider'
import { API_URL } from './account'

export const RESPONSES_URL = `${API_URL}/responses`
export const INSTRUCTIONS =
	'You help a developer review a GitHub pull request. Follow the request in the input and answer only with JSON that matches the given schema.'

export function responsesRequest(model: string, input: string, name: string, schema: object) {
	return {
		model,
		instructions: INSTRUCTIONS,
		input: [{ role: 'user', content: input }],
		text: { format: { type: 'json_schema', name, strict: true, schema } },
		reasoning: { effort: 'low' },
		store: false,
		stream: true,
	}
}

export type StreamOutcome =
	| { kind: 'completed'; text: string }
	| { kind: 'failed'; code?: string }
	| { kind: 'incomplete'; reason?: string }
	| { kind: 'interrupted' }

interface StreamEvent {
	type?: string
	delta?: unknown
	code?: unknown
	error?: { code?: unknown }
	response?: {
		error?: { code?: unknown } | null
		incomplete_details?: { reason?: unknown } | null
		output?: { type?: string; content?: { type?: string; text?: unknown }[] }[]
	}
}

const text = (value: unknown) => (typeof value === 'string' ? value : undefined)

/** The final answer text of a completed response, when the event carries its output. */
function outputText(response: StreamEvent['response']): string | undefined {
	const parts = (response?.output ?? [])
		.filter((item) => item.type === 'message')
		.flatMap((item) => item.content ?? [])
		.filter((part) => part.type === 'output_text')
		.map((part) => text(part.text) ?? '')

	return parts.length > 0 ? parts.join('') : undefined
}

/** Reads a Responses event stream to its terminal event. */
export async function readResponseStream(body: ReadableStream<Uint8Array>): Promise<StreamOutcome> {
	const reader = body.getReader()
	const decoder = new TextDecoder()
	let buffer = ''
	let deltas = ''
	let outcome: StreamOutcome | undefined

	const handle = (block: string) => {
		const data = block
			.split('\n')
			.filter((line) => line.startsWith('data:'))
			.map((line) => line.slice(5).trimStart())
			.join('\n')
		if (!data || data === '[DONE]') return

		let event: StreamEvent
		try {
			event = JSON.parse(data)
		} catch {
			return
		}
		if (event.type === 'response.output_text.delta') deltas += text(event.delta) ?? ''
		else if (event.type === 'response.completed')
			outcome = { kind: 'completed', text: outputText(event.response) ?? deltas }
		else if (event.type === 'response.failed')
			outcome = { kind: 'failed', code: text(event.response?.error?.code) }
		else if (event.type === 'response.incomplete')
			outcome = { kind: 'incomplete', reason: text(event.response?.incomplete_details?.reason) }
		else if (event.type === 'error')
			outcome = { kind: 'failed', code: text(event.code) ?? text(event.error?.code) }
	}

	try {
		while (!outcome) {
			const { done, value } = await reader.read()
			if (done) break
			buffer += decoder.decode(value, { stream: true }).replaceAll('\r\n', '\n')
			for (let end = buffer.indexOf('\n\n'); end !== -1 && !outcome; end = buffer.indexOf('\n\n')) {
				handle(buffer.slice(0, end))
				buffer = buffer.slice(end + 2)
			}
		}
		if (!outcome && buffer.trim()) handle(buffer)
	} catch {
		return { kind: 'interrupted' }
	} finally {
		reader.cancel().catch(() => undefined)
	}

	return outcome ?? { kind: 'interrupted' }
}

// Codes with their own recovery in the errors-and-recovery docs; anything else is a failed request.
const CODE_KINDS: Record<string, ModelError['kind']> = {
	subscription_sharing_usage_limit_exceeded: 'limit',
	subscription_sharing_usage_unavailable: 'unavailable',
	subscription_sharing_user_unavailable: 'unavailable',
	subscription_sharing_user_not_eligible: 'ineligible',
	subscription_sharing_invalid_user: 'unauthorized',
}

export function chatGptError(status: number | undefined, code?: string): ModelError {
	const kind =
		(code && CODE_KINDS[code]) ||
		(status === 401
			? 'unauthorized'
			: status === 403
				? 'ineligible'
				: status === 429
					? 'limit'
					: status === 503
						? 'unavailable'
						: 'request')

	return { kind, provider: 'chatgpt', ...(status ? { status } : {}) }
}

export interface ResponsesAnswer {
	text?: string
	error?: ModelError
	/** The request reached the model, so it counts against the plan whatever came of it. */
	isCharged: boolean
}

/** One streamed Responses call; resolves to the answer text only on `response.completed`. */
export async function respond(
	token: string,
	request: ReturnType<typeof responsesRequest>,
	timeout: number,
): Promise<ResponsesAnswer> {
	const signal = AbortSignal.timeout(timeout)
	let response: Response
	try {
		response = await fetch(RESPONSES_URL, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
				Accept: 'text/event-stream',
			},
			body: JSON.stringify(request),
			signal,
		})
	} catch (error) {
		const isTimeout = error instanceof DOMException && error.name === 'TimeoutError'
		return {
			error: { kind: isTimeout ? 'timeout' : 'request', provider: 'chatgpt' },
			isCharged: false,
		}
	}
	if (!response.ok || !response.body) {
		// Admission errors may carry `{ detail }` instead of an error object; only a code is used.
		const body = (await response.json().catch(() => undefined)) as
			| { error?: { code?: unknown } }
			| undefined
		return { error: chatGptError(response.status, text(body?.error?.code)), isCharged: false }
	}

	const outcome = await readResponseStream(response.body)
	if (outcome.kind === 'completed') return { text: outcome.text, isCharged: true }
	if (outcome.kind === 'failed')
		return { error: chatGptError(undefined, outcome.code), isCharged: true }
	if (outcome.kind === 'incomplete')
		return { error: { kind: 'invalid', provider: 'chatgpt' }, isCharged: true }

	// A stream cut by the deadline reads the same as one cut by the network; the signal tells them apart.
	return {
		error: { kind: signal.aborted ? 'timeout' : 'request', provider: 'chatgpt' },
		isCharged: true,
	}
}
