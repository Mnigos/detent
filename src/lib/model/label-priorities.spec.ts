import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { browser } from 'wxt/browser'
import {
	PRIORITIZE_MESSAGE,
	type PrioritizeRequest,
	requestPriorities,
	resolvePriorities,
} from './label-priorities'
import { prioritizeWithOpenRouter } from './openrouter'
import { priorityKeys } from './priority-cache'
import { recordUsage } from './usage'

vi.mock('wxt/browser', () => ({
	browser: {
		runtime: { sendMessage: vi.fn(), getPlatformInfo: vi.fn(async () => ({})) },
		storage: { local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } },
	},
}))
vi.mock('./openrouter', () => ({ prioritizeWithOpenRouter: vi.fn() }))
vi.mock('./usage', () => ({ recordUsage: vi.fn(async () => undefined) }))

const MODEL = 'test-model'
const INPUT = [
	'Pull request: Charge plans',
	'- src/billing.ts [server] modified +20/-2 @1',
	'- src/view.tsx [ui] modified +3/-1 @2',
].join('\n\n')
let stored: Record<string, unknown>
let request: PrioritizeRequest
let scenario = 0

beforeEach(() => {
	vi.resetAllMocks()
	stored = { settings: { openRouterKey: 'test-key', model: MODEL } }
	request = {
		type: PRIORITIZE_MESSAGE,
		scope: `owner/repo/${++scenario}`,
		digest: 'revision-a',
		input: INPUT,
		diffExcerpts: { 'src/billing.ts': '### src/billing.ts\n+charge()' },
	}
	vi.mocked(browser.storage.local.get).mockImplementation(async (keys) => {
		const selected =
			typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(stored)
		return Object.fromEntries(selected.map((key) => [key, stored[key]]))
	})
	vi.mocked(browser.storage.local.set).mockImplementation(async (items) => {
		Object.assign(stored, items)
	})
	vi.mocked(browser.storage.local.remove).mockImplementation(async (keys) => {
		for (const key of typeof keys === 'string' ? [keys] : keys) delete stored[key]
	})
	vi.mocked(prioritizeWithOpenRouter).mockResolvedValue({
		priorities: [
			{ path: '@1', priority: 'urgent', reason: 'Charges twice.' },
			{ path: '@9', priority: 'high' },
			{ path: '@2', priority: 'low' },
		],
		usage: { promptTokens: 100, completionTokens: 20, cost: 0.002 },
	})
})
afterEach(() => vi.restoreAllMocks())

describe('resolvePriorities', () => {
	it('falls back without a key and never calls the model', async () => {
		stored = {}

		expect(await resolvePriorities(request)).toEqual({ source: 'fallback', labeler: 'none' })
		expect(prioritizeWithOpenRouter).not.toHaveBeenCalled()
	})

	it('resolves @numbers to paths, drops unknown ones, sends the diff and counts usage', async () => {
		const response = await resolvePriorities(request)

		expect(response).toEqual({
			priorities: [
				{ path: 'src/billing.ts', priority: 'urgent', reason: 'Charges twice.' },
				{ path: 'src/view.tsx', priority: 'low' },
			],
			source: 'model',
			labeler: 'openrouter',
			model: MODEL,
			cost: 0.002,
		})
		const call = vi.mocked(prioritizeWithOpenRouter).mock.calls[0]?.[0]
		expect(call).toMatchObject({ key: 'test-key', model: MODEL })
		expect(call?.input).toContain('## Diff\n\n### src/billing.ts\n+charge()')
		expect(recordUsage).toHaveBeenCalledExactlyOnceWith({
			promptTokens: 100,
			completionTokens: 20,
			cost: 0.002,
		})
	})

	it('reuses the saved ranking of a revision, also after a worker restart', async () => {
		await resolvePriorities(request)
		vi.resetModules()
		const restarted = await import('./label-priorities')
		const cached = await restarted.resolvePriorities(request)

		expect(cached).toMatchObject({ source: 'model', model: MODEL })
		expect(cached.cost).toBeUndefined()
		expect(cached.priorities?.map((entry) => entry.path)).toEqual([
			'src/billing.ts',
			'src/view.tsx',
		])
		expect(prioritizeWithOpenRouter).toHaveBeenCalledTimes(1)
		const keys = priorityKeys(request.scope, request.digest, `openrouter:${MODEL}`)
		expect(stored[keys.history]).toEqual([keys.exact])
	})

	it('asks again for a new revision and keeps only the last five per pull request', async () => {
		for (const digest of ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'])
			await resolvePriorities({ ...request, digest })
		const labeler = `openrouter:${MODEL}`

		expect(prioritizeWithOpenRouter).toHaveBeenCalledTimes(6)
		expect(stored[priorityKeys(request.scope, 'r1', labeler).exact]).toBeUndefined()
		expect(stored[priorityKeys(request.scope, 'r6', labeler).history]).toHaveLength(5)
	})

	it('shares one running request and holds a failure for a while instead of retrying', async () => {
		vi.mocked(prioritizeWithOpenRouter).mockResolvedValue({ error: { kind: 'timeout' } })
		const [first, second] = await Promise.all([
			resolvePriorities(request),
			resolvePriorities(request),
		])
		const third = await resolvePriorities(request)

		expect(first).toEqual({
			source: 'fallback',
			labeler: 'none',
			model: MODEL,
			error: { kind: 'timeout' },
		})
		expect(second).toEqual(first)
		expect(third).toEqual(first)
		expect(prioritizeWithOpenRouter).toHaveBeenCalledTimes(1)
	})

	it('treats an answer naming none of the files as invalid', async () => {
		vi.mocked(prioritizeWithOpenRouter).mockResolvedValue({
			priorities: [{ path: '@7', priority: 'urgent' }],
		})

		expect(await resolvePriorities(request)).toMatchObject({
			source: 'fallback',
			error: { kind: 'invalid' },
		})
	})

	it('still answers when the ranking cannot be saved', async () => {
		vi.mocked(browser.storage.local.set).mockRejectedValue(new Error('quota'))

		expect(await resolvePriorities(request)).toMatchObject({ source: 'model', cacheError: true })
	})

	it('retries at exactly 30 seconds after a failure, keeping earlier attempts in cooldown', async () => {
		let now = 10_000
		vi.spyOn(Date, 'now').mockImplementation(() => now)
		vi.mocked(prioritizeWithOpenRouter).mockResolvedValue({ error: { kind: 'timeout' } })
		const failed = await resolvePriorities(request)
		now += 29_999
		expect(await resolvePriorities(request)).toEqual(failed)
		expect(prioritizeWithOpenRouter).toHaveBeenCalledTimes(1)
		now += 1
		vi.mocked(prioritizeWithOpenRouter).mockResolvedValue({
			priorities: [{ path: '@1', priority: 'high' }],
		})
		await expect(resolvePriorities(request)).resolves.toMatchObject({ source: 'model' })
		expect(prioritizeWithOpenRouter).toHaveBeenCalledTimes(2)
	})

	it('shares a successful in-flight answer and counts its usage once', async () => {
		let finish!: (answer: Awaited<ReturnType<typeof prioritizeWithOpenRouter>>) => void
		vi.mocked(prioritizeWithOpenRouter).mockReturnValue(
			new Promise((resolve) => {
				finish = resolve
			}),
		)
		const first = resolvePriorities(request)
		const second = resolvePriorities(request)
		await vi.waitFor(() => expect(prioritizeWithOpenRouter).toHaveBeenCalledTimes(1))
		finish({
			priorities: [{ path: '@1', priority: 'urgent' }],
			usage: { promptTokens: 12, completionTokens: 3, cost: 0.001 },
		})
		const answers = await Promise.all([first, second])
		expect(answers[0]).toEqual(answers[1])
		expect(answers[0]).toEqual({
			source: 'model',
			labeler: 'openrouter',
			model: MODEL,
			cost: 0.001,
			priorities: [{ path: 'src/billing.ts', priority: 'urgent' }],
		})
		expect(recordUsage).toHaveBeenCalledExactlyOnceWith({
			promptTokens: 12,
			completionTokens: 3,
			cost: 0.001,
		})
	})

	it.each(['revision', 'pr', 'model'] as const)(
		'does not share the %s identity during failure cooldown',
		async (identity) => {
			vi.mocked(prioritizeWithOpenRouter).mockResolvedValue({ error: { kind: 'timeout' } })
			await resolvePriorities(request)
			const other = { ...request }
			if (identity === 'revision') other.digest = 'revision-b'
			if (identity === 'pr') other.scope = `${request.scope}-other`
			if (identity === 'model')
				stored.settings = { openRouterKey: 'test-key', model: 'another-model' }
			await resolvePriorities(other)
			expect(prioritizeWithOpenRouter).toHaveBeenCalledTimes(2)
		},
	)

	it('counts charged usage even for an invalid answer and tolerates a failed usage write', async () => {
		vi.mocked(recordUsage).mockRejectedValue(new Error('quota'))
		vi.mocked(prioritizeWithOpenRouter).mockResolvedValue({
			priorities: [{ path: '@99', priority: 'high' }],
			usage: { promptTokens: 10, completionTokens: 2, cost: 0.001 },
		})
		await expect(resolvePriorities(request)).resolves.toEqual({
			source: 'fallback',
			labeler: 'none',
			model: MODEL,
			error: { kind: 'invalid' },
		})
		expect(recordUsage).toHaveBeenCalledExactlyOnceWith({
			promptTokens: 10,
			completionTokens: 2,
			cost: 0.001,
		})
		expect(browser.storage.local.set).not.toHaveBeenCalled()
	})

	it('recovers from a cache read failure by asking the model', async () => {
		vi.mocked(browser.storage.local.get).mockImplementation(async (keys) => {
			if (typeof keys === 'string' && keys.startsWith('priorities:'))
				throw new Error('storage unavailable')
			const selected =
				typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(stored)
			return Object.fromEntries(selected.map((key) => [key, stored[key]]))
		})
		await expect(resolvePriorities(request)).resolves.toMatchObject({
			source: 'model',
			cacheError: true,
		})
		expect(prioritizeWithOpenRouter).toHaveBeenCalledTimes(1)
	})

	it('forwards a content-script request using the priority-specific message type', async () => {
		const response = { source: 'fallback', labeler: 'none' } as const
		vi.mocked(browser.runtime.sendMessage).mockImplementation(async () => response)
		const { type: _type, ...payload } = request
		await expect(requestPriorities(payload)).resolves.toEqual(response)
		expect(browser.runtime.sendMessage).toHaveBeenCalledExactlyOnceWith({
			...payload,
			type: 'detent:prioritize',
		})
	})
})
