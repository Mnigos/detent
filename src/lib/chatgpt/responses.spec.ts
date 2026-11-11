import { afterEach, describe, expect, it, vi } from 'vitest'
import { completedEvents, sseBody } from '../../test/sse'
import { GROUPING_SCHEMA } from '../layers/grouping'
import {
	chatGptError,
	INSTRUCTIONS,
	RESPONSES_URL,
	readResponseStream,
	respond,
	responsesRequest,
} from './responses'

afterEach(() => vi.unstubAllGlobals())

// Fields the preview rejects on this route.
const FORBIDDEN = [
	'background',
	'conversation',
	'max_output_tokens',
	'max_tool_calls',
	'metadata',
	'moderation',
	'multi_agent',
	'prompt',
	'prompt_cache_retention',
	'safety_identifier',
	'temperature',
	'top_logprobs',
	'top_p',
	'truncation',
	'user',
	'previous_response_id',
]

describe('responsesRequest', () => {
	const request = responsesRequest('gpt-6-luna', 'the pull request', 'layers', GROUPING_SCHEMA)

	it('streams without storing, with instructions and an input array, and a strict schema', () => {
		expect(request).toEqual({
			model: 'gpt-6-luna',
			instructions: INSTRUCTIONS,
			input: [{ role: 'user', content: 'the pull request' }],
			text: {
				format: { type: 'json_schema', name: 'layers', strict: true, schema: GROUPING_SCHEMA },
			},
			reasoning: { effort: 'low' },
			store: false,
			stream: true,
		})
	})

	it('sends none of the unsupported fields and no system message', () => {
		for (const field of FORBIDDEN) expect(request).not.toHaveProperty(field)
		expect(request.input.every((item) => item.role !== 'system')).toBe(true)
	})
})

describe('readResponseStream', () => {
	it('joins the text deltas when the response completes', async () => {
		await expect(readResponseStream(sseBody(completedEvents('{"layers":[]}')))).resolves.toEqual({
			kind: 'completed',
			text: '{"layers":[]}',
		})
	})

	it('reads the same answer whatever the chunk boundaries, CRLFs split included', async () => {
		for (let size = 1; size <= 24; size++)
			await expect(
				readResponseStream(sseBody(completedEvents('{"layers":[]}'), size)),
			).resolves.toEqual({ kind: 'completed', text: '{"layers":[]}' })
	})

	it('prefers the output text the completed event carries', async () => {
		const events = [
			{ type: 'response.output_text.delta', delta: 'partial' },
			{
				type: 'response.completed',
				response: {
					output: [
						{ type: 'reasoning', content: [] },
						{ type: 'message', content: [{ type: 'output_text', text: '{"a":1}' }] },
					],
				},
			},
		]
		await expect(readResponseStream(sseBody(events))).resolves.toEqual({
			kind: 'completed',
			text: '{"a":1}',
		})
	})

	it('reports a failed response with its error code, even after text began', async () => {
		const events = [
			{ type: 'response.output_text.delta', delta: '{"lay' },
			{
				type: 'response.failed',
				response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } },
			},
		]
		await expect(readResponseStream(sseBody(events))).resolves.toEqual({
			kind: 'failed',
			code: 'subscription_sharing_usage_limit_exceeded',
		})
	})

	it('reports an incomplete response and an error event', async () => {
		await expect(
			readResponseStream(
				sseBody([
					{
						type: 'response.incomplete',
						response: { incomplete_details: { reason: 'max_output_tokens' } },
					},
				]),
			),
		).resolves.toEqual({ kind: 'incomplete', reason: 'max_output_tokens' })
		await expect(
			readResponseStream(
				sseBody([{ type: 'error', code: 'subscription_sharing_usage_unavailable' }]),
			),
		).resolves.toEqual({ kind: 'failed', code: 'subscription_sharing_usage_unavailable' })
	})

	it('treats a stream that ends without a terminal event as interrupted', async () => {
		const events = completedEvents('{"layers":[]}').slice(0, -1)
		await expect(readResponseStream(sseBody(events))).resolves.toEqual({ kind: 'interrupted' })
	})

	it('treats a broken stream as interrupted', async () => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('data: {"type":"response.created"}\n\n'))
				controller.error(new TypeError('network'))
			},
		})
		await expect(readResponseStream(body)).resolves.toEqual({ kind: 'interrupted' })
	})
})

describe('chatGptError', () => {
	it.each([
		[429, 'subscription_sharing_usage_limit_exceeded', 'limit'],
		[undefined, 'subscription_sharing_usage_limit_exceeded', 'limit'],
		[503, 'subscription_sharing_usage_unavailable', 'unavailable'],
		[undefined, 'subscription_sharing_usage_unavailable', 'unavailable'],
		[403, 'subscription_sharing_user_not_eligible', 'ineligible'],
		[401, 'subscription_sharing_invalid_user', 'unauthorized'],
		[401, undefined, 'unauthorized'],
		[403, undefined, 'ineligible'],
		[503, undefined, 'unavailable'],
		[400, 'subscription_sharing_unsupported_capability', 'request'],
		[undefined, 'server_error', 'request'],
	] as const)('maps HTTP %s with %s to %s', (status, code, kind) => {
		expect(chatGptError(status, code).kind).toBe(kind)
		expect(chatGptError(status, code).provider).toBe('chatgpt')
	})
})

describe('respond', () => {
	const request = responsesRequest('gpt-6-luna', 'input', 'layers', GROUPING_SCHEMA)
	const stub = (response: Response | Error) =>
		vi.stubGlobal(
			'fetch',
			response instanceof Error
				? vi.fn().mockRejectedValue(response)
				: vi.fn().mockResolvedValue(response),
		)

	it('posts the request with the bearer token and asks for an event stream', async () => {
		stub(new Response(sseBody(completedEvents('ok')), { status: 200 }))

		await expect(respond('access-1', request, 1000)).resolves.toEqual({
			text: 'ok',
			isCharged: true,
		})
		const [url, init] = vi.mocked(fetch).mock.calls[0] ?? []
		expect(url).toBe(RESPONSES_URL)
		expect(init?.headers).toMatchObject({
			Authorization: 'Bearer access-1',
			Accept: 'text/event-stream',
		})
		expect(JSON.parse(String(init?.body))).toEqual(request)
	})

	it('maps an error before the stream opens and does not count it', async () => {
		stub(
			Response.json(
				{ error: { code: 'subscription_sharing_usage_limit_exceeded' } },
				{ status: 429 },
			),
		)
		await expect(respond('t', request, 1000)).resolves.toEqual({
			error: { kind: 'limit', status: 429, provider: 'chatgpt' },
			isCharged: false,
		})
	})

	it('reads a `detail` admission body as a plain status error', async () => {
		stub(Response.json({ detail: 'Direct routing unavailable' }, { status: 503 }))
		await expect(respond('t', request, 1000)).resolves.toMatchObject({
			error: { kind: 'unavailable', status: 503 },
		})
	})

	it('fails a response that streamed and then failed', async () => {
		stub(
			new Response(
				sseBody([
					{
						type: 'response.failed',
						response: { error: { code: 'subscription_sharing_usage_unavailable' } },
					},
				]),
			),
		)
		await expect(respond('t', request, 1000)).resolves.toEqual({
			error: { kind: 'unavailable', provider: 'chatgpt' },
			isCharged: true,
		})
	})

	it('reports an unreachable API as a failed request', async () => {
		stub(new TypeError('offline'))
		await expect(respond('t', request, 1000)).resolves.toEqual({
			error: { kind: 'request', provider: 'chatgpt' },
			isCharged: false,
		})
	})
})
