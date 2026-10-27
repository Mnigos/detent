import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { browser } from 'wxt/browser'
import background from '../entrypoints/background'
import { fetchPullRequestDiff } from './lib/diff/fetch-diff'
import { resolveLayerLabels } from './lib/model/label-layers'
import { type PrioritizeResponse, resolvePriorities } from './lib/model/label-priorities'

vi.mock('wxt/browser', () => ({
	browser: {
		storage: { session: { setAccessLevel: vi.fn() } },
		runtime: { onMessage: { addListener: vi.fn() } },
	},
}))
vi.mock('./lib/diff/fetch-diff', () => ({
	FETCH_DIFF_MESSAGE: 'detent:fetch-diff',
	fetchPullRequestDiff: vi.fn(),
	PullRequestDiffError: class extends Error {},
}))
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
