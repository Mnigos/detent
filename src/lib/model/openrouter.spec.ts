import { afterEach, describe, expect, it, vi } from 'vitest'
import { GROUPING_SCHEMA } from '../layers/grouping'
import { PRIORITY_SCHEMA } from '../priority/schema'
import {
	answerTokensFor,
	groupLayersWithOpenRouter,
	OPENROUTER_URL,
	prioritizeWithOpenRouter,
	testOpenRouter,
	timeoutFor,
} from './openrouter'

const call = { key: 'sk-or-secret', model: 'openai/gpt-5.6-luna', input: 'condensed' }
const LAYERS = [
	{ name: 'Add the contract', summary: 'Read it first.', files: ['packages/contracts/a.ts'] },
]

const USAGE = { prompt_tokens: 1200, completion_tokens: 80, cost: 0.0031 }
const completion = (content: unknown, status = 200) =>
	new Response(JSON.stringify({ choices: [{ message: { content } }], usage: USAGE }), { status })

const stubFetch = (result: Response | Error) => {
	const fetchMock =
		result instanceof Error ? vi.fn().mockRejectedValue(result) : vi.fn().mockResolvedValue(result)
	vi.stubGlobal('fetch', fetchMock)

	return fetchMock
}

const requestBody = (fetchMock: ReturnType<typeof vi.fn>) =>
	JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('request sizing', () => {
	it('grows the deadline with the prompt and the answer room with the file count, both capped', () => {
		const files = Array.from({ length: 400 }, (_, i) => `- f${i}.ts [ui] @${i + 1}`).join('\n')
		expect(timeoutFor('short')).toBe(21_000)
		expect(timeoutFor('x'.repeat(235_000))).toBe(138_000)
		expect(timeoutFor('x'.repeat(1_000_000))).toBe(180_000)
		expect(answerTokensFor('- a.ts [ui] @1')).toBe(4024)
		expect(answerTokensFor(files)).toBe(4000 + 400 * 24)
		expect(
			answerTokensFor(
				Array.from({ length: 2000 }, (_, i) => `- f${i}.ts [ui] @${i + 1}`).join('\n'),
			),
		).toBe(32_000)
	})
})

describe('groupLayersWithOpenRouter', () => {
	it('posts the strict schema request with the key in the headers and parses the layers', async () => {
		const fetchMock = stubFetch(completion(JSON.stringify({ layers: LAYERS })))

		await expect(groupLayersWithOpenRouter(call)).resolves.toEqual({
			layers: LAYERS,
			usage: { promptTokens: 1200, completionTokens: 80, cost: 0.0031 },
		})
		expect(fetchMock).toHaveBeenCalledWith(
			OPENROUTER_URL,
			expect.objectContaining({
				method: 'POST',
				headers: {
					Authorization: 'Bearer sk-or-secret',
					'Content-Type': 'application/json',
					'HTTP-Referer': 'https://github.com/Mnigos/detent',
					'X-Title': 'detent for GitHub',
				},
				signal: expect.any(AbortSignal),
			}),
		)
		expect(requestBody(fetchMock)).toEqual({
			model: 'openai/gpt-5.6-luna',
			messages: [{ role: 'user', content: 'condensed' }],
			response_format: {
				type: 'json_schema',
				json_schema: { name: 'layers', strict: true, schema: GROUPING_SCHEMA },
			},
			reasoning: { effort: 'low' },
			max_tokens: 4000,
			usage: { include: true },
		})
	})

	it.each([
		[401, 'unauthorized'],
		[403, 'unauthorized'],
		[402, 'credits'],
		[429, 'request'],
		[500, 'request'],
	])('maps a %i response to %s', async (status, kind) => {
		stubFetch(new Response('', { status }))

		await expect(groupLayersWithOpenRouter(call)).resolves.toEqual({ error: { kind, status } })
	})

	it('reports a request error without a status when the network fails', async () => {
		stubFetch(new TypeError('Failed to fetch'))

		await expect(groupLayersWithOpenRouter(call)).resolves.toEqual({ error: { kind: 'request' } })
	})

	it('reports a timeout when the deadline aborts the request', async () => {
		stubFetch(new DOMException('The operation timed out.', 'TimeoutError'))

		await expect(groupLayersWithOpenRouter(call)).resolves.toEqual({ error: { kind: 'timeout' } })
	})

	it('reports invalid content when the reply is not the layer shape', async () => {
		stubFetch(completion('sorry, no json today'))

		await expect(groupLayersWithOpenRouter(call)).resolves.toMatchObject({
			error: { kind: 'invalid' },
		})

		stubFetch(completion(null))

		await expect(groupLayersWithOpenRouter(call)).resolves.toMatchObject({
			error: { kind: 'invalid' },
		})

		stubFetch(new Response('not json', { status: 200 }))

		await expect(groupLayersWithOpenRouter(call)).resolves.toEqual({ error: { kind: 'invalid' } })
	})
})

describe('testOpenRouter', () => {
	it('sends one tiny completion and answers nothing on success', async () => {
		const fetchMock = stubFetch(completion('OK'))

		await expect(testOpenRouter(call)).resolves.toBeUndefined()
		expect(requestBody(fetchMock)).toEqual({
			model: 'openai/gpt-5.6-luna',
			messages: [{ role: 'user', content: 'Reply with OK.' }],
			max_tokens: 5,
			usage: { include: true },
		})
	})

	it('answers the mapped error on failure', async () => {
		stubFetch(new Response('', { status: 401 }))

		await expect(testOpenRouter(call)).resolves.toEqual({ kind: 'unauthorized', status: 401 })
	})
})

describe('prioritizeWithOpenRouter', () => {
	it('uses the separate strict priority schema and numbered files with usage counting', async () => {
		const input = '- src/a.ts [server] modified +20/-0 @1\n- src/b.ts [ui] modified +4/-0 @2'
		const fetchMock = stubFetch(
			completion(
				JSON.stringify({
					files: [
						{ file: '@2', priority: 'high', reason: 'May hide checkout.' },
						{ file: '@1', priority: 'low', reason: 'Discard.' },
					],
				}),
			),
		)
		await expect(prioritizeWithOpenRouter({ ...call, input })).resolves.toEqual({
			priorities: [
				{ path: '@2', priority: 'high', reason: 'May hide checkout.' },
				{ path: '@1', priority: 'low' },
			],
			usage: { promptTokens: 1200, completionTokens: 80, cost: 0.0031 },
		})
		expect(fetchMock).toHaveBeenCalledTimes(1)
		expect(fetchMock.mock.calls[0]?.[0]).toBe(OPENROUTER_URL)
		expect(requestBody(fetchMock)).toEqual({
			model: call.model,
			messages: [{ role: 'user', content: input }],
			response_format: {
				type: 'json_schema',
				json_schema: { name: 'priorities', strict: true, schema: PRIORITY_SCHEMA },
			},
			reasoning: { effort: 'low' },
			max_tokens: 4080,
			usage: { include: true },
		})
	})

	it.each([
		[401, 'unauthorized'],
		[403, 'unauthorized'],
		[402, 'credits'],
		[429, 'request'],
		[500, 'request'],
	])('maps priority HTTP %i to %s', async (status, kind) => {
		stubFetch(new Response('', { status }))
		await expect(prioritizeWithOpenRouter(call)).resolves.toEqual({ error: { kind, status } })
	})

	it.each([
		[new DOMException('deadline', 'TimeoutError'), 'timeout'],
		[new TypeError('Failed to fetch'), 'request'],
	])('maps rejected priority fetch %s to %s', async (error, kind) => {
		stubFetch(error)
		await expect(prioritizeWithOpenRouter(call)).resolves.toEqual({ error: { kind } })
	})

	it.each([
		'not JSON',
		'```json\n{"files":[]}\n```',
		'{"files":[]}',
		'{"files":[{"file":"@1","priority":"critical","reason":"bad"}]}',
	])('rejects invalid priority content %s while retaining charged usage', async (content) => {
		stubFetch(completion(content))
		await expect(prioritizeWithOpenRouter(call)).resolves.toEqual({
			error: { kind: 'invalid' },
			usage: { promptTokens: 1200, completionTokens: 80, cost: 0.0031 },
		})
	})
})
