import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { browser } from 'wxt/browser'
import background from '../entrypoints/background'
import { fetchPullRequestDiff, PullRequestDiffError } from './lib/diff/fetch-diff'
import { MergeBoxUnavailableError } from './lib/list/conflicts'
import { resolveLayerLabels } from './lib/model/label-layers'
import { type PrioritizeResponse, resolvePriorities } from './lib/model/label-priorities'
import { RateLimitError, RequestPausedError } from './lib/rate-limit'

vi.mock('wxt/browser', () => ({
	browser: {
		storage: { session: { setAccessLevel: vi.fn() }, local: { remove: vi.fn() } },
		runtime: { onMessage: { addListener: vi.fn() }, onInstalled: { addListener: vi.fn() } },
	},
}))
vi.mock('./lib/diff/fetch-diff', () => ({
	FETCH_DIFF_MESSAGE: 'detent:fetch-diff',
	fetchPullRequestDiff: vi.fn(),
	PullRequestDiffError: class extends Error {
		constructor(
			readonly status: number,
			readonly rateLimit?: object,
			readonly isPaused = false,
		) {
			super()
		}
	},
}))
const list = vi.hoisted(() => ({ diff: vi.fn(), conflicts: vi.fn(), heads: vi.fn() }))
vi.mock('./lib/list/list-requests', () => ({ createListRequests: () => list }))
vi.mock('./lib/model/label-layers', () => ({
	LABEL_LAYERS_MESSAGE: 'detent:label-layers',
	resolveLayerLabels: vi.fn(),
}))
vi.mock('./lib/model/label-priorities', () => ({
	PRIORITIZE_MESSAGE: 'detent:prioritize',
	resolvePriorities: vi.fn(),
}))

type Listener = (message: unknown, sender: object, reply: (value: unknown) => void) => boolean
let listener: Listener
const request = {
	type: 'detent:prioritize',
	scope: 'owner/repo/1',
	digest: 'r1',
	input: '- src/a.ts [server] @1',
}

beforeEach(() => {
	vi.resetAllMocks()
	vi.mocked(browser.storage.session.setAccessLevel).mockResolvedValue(undefined)
	background.main()
	listener = vi.mocked(browser.runtime.onMessage.addListener).mock.calls[0]?.[0] as Listener
})
afterEach(() => vi.restoreAllMocks())

describe('background priorities message', () => {
	it('allows content-script session persistence', () => {
		expect(browser.storage.session.setAccessLevel).toHaveBeenCalledExactlyOnceWith({
			accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS',
		})
	})

	it('removes the list stats caches of older versions on install and update', async () => {
		vi.mocked(browser.storage.local.remove).mockResolvedValue(undefined)
		const onInstalled = vi.mocked(browser.runtime.onInstalled.addListener).mock.calls[0]?.[0] as (
			details: object,
		) => void
		onInstalled({ reason: 'update' })

		expect(browser.storage.local.remove).toHaveBeenCalledExactlyOnceWith(['diffStats'])
	})

	it('keeps the channel open and sends exactly the asynchronous ranking answer', async () => {
		let finish!: (value: PrioritizeResponse) => void
		vi.mocked(resolvePriorities).mockReturnValue(
			new Promise((resolve) => {
				finish = resolve
			}),
		)
		const reply = vi.fn()
		expect(listener(request, {}, reply)).toBe(true)
		expect(reply).not.toHaveBeenCalled()
		expect(resolvePriorities).toHaveBeenCalledExactlyOnceWith(request)
		expect(resolveLayerLabels).not.toHaveBeenCalled()
		expect(fetchPullRequestDiff).not.toHaveBeenCalled()
		const response: PrioritizeResponse = {
			source: 'model',
			labeler: 'openrouter',
			model: 'm',
			cost: 0.002,
			priorities: [{ path: 'src/a.ts', priority: 'high', reason: 'May lose data.' }],
		}
		finish(response)
		await vi.waitFor(() => expect(reply).toHaveBeenCalledExactlyOnceWith(response))
	})

	it.each(['unauthorized', 'credits', 'timeout', 'request', 'invalid'] as const)(
		'preserves a %s error response for the priority footer',
		async (kind) => {
			const response: PrioritizeResponse = {
				source: 'fallback',
				labeler: 'none',
				model: 'm',
				error: { kind },
			}
			vi.mocked(resolvePriorities).mockResolvedValue(response)
			const reply = vi.fn()
			expect(listener(request, {}, reply)).toBe(true)
			await vi.waitFor(() => expect(reply).toHaveBeenCalledExactlyOnceWith(response))
		},
	)

	it('returns an empty reply when the worker rejects, allowing the interrupted status', async () => {
		const error = new Error('storage unavailable')
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
		vi.mocked(resolvePriorities).mockRejectedValue(error)
		const reply = vi.fn()
		expect(listener(request, {}, reply)).toBe(true)
		await vi.waitFor(() => expect(reply).toHaveBeenCalledExactlyOnceWith(undefined))
		expect(warn).toHaveBeenCalledExactlyOnceWith('[detent] ranking failed', error)
	})

	it.each([null, undefined, 'detent:prioritize', {}, { type: 'unknown' }])(
		'ignores unrelated message %j',
		(message) => {
			const reply = vi.fn()
			expect(listener(message, {}, reply)).toBe(false)
			expect(resolvePriorities).not.toHaveBeenCalled()
			expect(reply).not.toHaveBeenCalled()
		},
	)
})

describe('background diff message', () => {
	const diffRequest = { type: 'detent:fetch-diff', owner: 'o', repo: 'r', number: 1 }

	it('passes a rate limit back with the status', async () => {
		vi.mocked(fetchPullRequestDiff).mockRejectedValue(
			new PullRequestDiffError(429, { retryAfterMilliseconds: 60_000 }),
		)
		const reply = vi.fn()
		expect(listener(diffRequest, {}, reply)).toBe(true)
		await vi.waitFor(() =>
			expect(reply).toHaveBeenCalledExactlyOnceWith({
				status: 429,
				rateLimit: { retryAfterMilliseconds: 60_000 },
				isPaused: false,
			}),
		)
	})

	it('answers status 0 for an error that is not GitHub answering', async () => {
		vi.mocked(fetchPullRequestDiff).mockRejectedValue(new TypeError('Failed to fetch'))
		const reply = vi.fn()
		expect(listener(diffRequest, {}, reply)).toBe(true)
		await vi.waitFor(() => expect(reply).toHaveBeenCalledExactlyOnceWith({ status: 0 }))
	})
})

describe('background list messages', () => {
	const ref = { owner: 'o', repo: 'r', number: 1 }

	it("sends a list's diff through the shared list queue and the panel's straight to GitHub", async () => {
		list.diff.mockResolvedValue('list diff')
		vi.mocked(fetchPullRequestDiff).mockResolvedValue('panel diff')
		const listReply = vi.fn()
		const panelReply = vi.fn()
		expect(listener({ type: 'detent:fetch-diff', ...ref, isList: true }, {}, listReply)).toBe(true)
		expect(listener({ type: 'detent:fetch-diff', ...ref }, {}, panelReply)).toBe(true)

		await vi.waitFor(() => expect(listReply).toHaveBeenCalledExactlyOnceWith({ text: 'list diff' }))
		await vi.waitFor(() =>
			expect(panelReply).toHaveBeenCalledExactlyOnceWith({ text: 'panel diff' }),
		)
		expect(list.diff).toHaveBeenCalledExactlyOnceWith(expect.objectContaining(ref))
		expect(fetchPullRequestDiff).toHaveBeenCalledExactlyOnceWith(expect.objectContaining(ref))
	})

	it('answers a merge box request with its state, or with what stopped it', async () => {
		const request = { type: 'detent:fetch-conflicts', ...ref }
		for (const [outcome, expected] of [
			[
				() => Promise.resolve({ state: 'conflicts', unresolved: true }),
				{ state: 'conflicts', unresolved: true },
			],
			[() => Promise.reject(new RequestPausedError()), { status: 0, isPaused: true }],
			[
				() => Promise.reject(new RateLimitError(30_000)),
				{ status: 429, isRateLimited: true, retryAfterMilliseconds: 30_000 },
			],
			[() => Promise.reject(new MergeBoxUnavailableError(404)), { status: 404 }],
			[() => Promise.reject(new TypeError('Failed to fetch')), { status: 0 }],
		] as const) {
			list.conflicts.mockImplementationOnce(outcome)
			const reply = vi.fn()
			expect(listener(request, {}, reply)).toBe(true)
			await vi.waitFor(() => expect(reply).toHaveBeenCalledExactlyOnceWith(expected))
		}
	})

	it("answers only a pull request list's own data", async () => {
		list.heads.mockResolvedValue(new Map([['o/r/1', { headSha: 'a'.repeat(40), at: 1 }]]))
		const reply = vi.fn()
		expect(
			listener(
				{ type: 'detent:fetch-list-heads', url: 'https://github.com/o/r/pulls?q=is%3Aopen' },
				{},
				reply,
			),
		).toBe(true)
		await vi.waitFor(() =>
			expect(reply).toHaveBeenCalledExactlyOnceWith({
				heads: [['o/r/1', { headSha: 'a'.repeat(40), at: 1 }]],
			}),
		)

		const refused = vi.fn()
		expect(
			listener(
				{ type: 'detent:fetch-list-heads', url: 'https://evil.example/o/r/pulls' },
				{},
				refused,
			),
		).toBe(false)
		expect(refused).toHaveBeenCalledExactlyOnceWith({ status: 0 })
		expect(list.heads).toHaveBeenCalledOnce()
	})
})
