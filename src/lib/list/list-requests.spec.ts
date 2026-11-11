import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { PullRequestDiffError } from '../diff/fetch-diff'
import { RequestPausedError } from '../rate-limit'
import { createListRequests } from './list-requests'
import { RATE_LIMIT_KEY } from './rate-limit'

const ref = { owner: 'o', repo: 'r', number: 1 }

beforeEach(() => {
	fakeBrowser.reset()
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
})

afterEach(() => {
	vi.useRealTimers()
	vi.unstubAllGlobals()
})

// Counts the requests GitHub would see and answers each once the test lets it.
function stubGitHub(answer: (url: string) => Response) {
	const pending: (() => void)[] = []
	const fetch = vi.fn(
		(url: string) => new Promise<Response>((resolve) => pending.push(() => resolve(answer(url)))),
	)
	vi.stubGlobal('fetch', fetch)

	return {
		fetch,
		release: () => {
			for (const resolve of pending.splice(0)) resolve()
		},
	}
}

describe('createListRequests', () => {
	it("sends one diff request when two tabs ask for the same pull request's diff", async () => {
		const github = stubGitHub(() => new Response('diff --git a/a b/a\n'))
		const list = createListRequests()
		const tabs = [list.diff(ref), list.diff(ref), list.diff({ ...ref, number: 2 })]
		await vi.advanceTimersByTimeAsync(1000)
		github.release()

		await expect(Promise.all(tabs)).resolves.toEqual([
			'diff --git a/a b/a\n',
			'diff --git a/a b/a\n',
			'diff --git a/a b/a\n',
		])
		expect(github.fetch.mock.calls.map(([url]) => url)).toEqual([
			'https://github.com/o/r/pull/1.diff',
			'https://github.com/o/r/pull/2.diff',
		])
	})

	it('holds the slot until the body has arrived, so slow downloads still count against the three', async () => {
		const bodies: ReadableStreamDefaultController<Uint8Array>[] = []
		const fetch = vi.fn(
			async () =>
				new Response(
					new ReadableStream<Uint8Array>({
						start: (controller) => {
							bodies.push(controller)
						},
					}),
				),
		)
		vi.stubGlobal('fetch', fetch)
		const list = createListRequests()
		const diffs = [1, 2, 3, 4].map((number) => list.diff({ ...ref, number }))
		await vi.advanceTimersByTimeAsync(1000)
		expect(fetch).toHaveBeenCalledTimes(3)

		bodies[0]?.enqueue(new TextEncoder().encode('diff --git a/a b/a\n'))
		bodies[0]?.close()
		await vi.advanceTimersByTimeAsync(1000)
		expect(fetch).toHaveBeenCalledTimes(4)
		await expect(diffs[0]).resolves.toBe('diff --git a/a b/a\n')
		for (const body of bodies.slice(1)) body.close()
		await expect(Promise.all(diffs.slice(1))).resolves.toEqual(['', '', ''])
	})

	it('keeps diffs, merge boxes and list data of every tab to three requests at once', async () => {
		const github = stubGitHub((url) =>
			url.endsWith('.diff')
				? new Response('')
				: url.includes('merge_box')
					? Response.json({ pullRequest: { state: 'OPEN', mergeStateStatus: 'DIRTY' } })
					: Response.json({}),
		)
		const list = createListRequests()
		const requests = [
			list.diff(ref),
			list.conflicts(ref),
			list.heads('https://github.com/o/r/pulls'),
			list.diff({ ...ref, number: 2 }),
			list.conflicts({ ...ref, number: 2 }),
		]
		await vi.advanceTimersByTimeAsync(1000)
		expect(github.fetch).toHaveBeenCalledTimes(3)

		github.release()
		await vi.advanceTimersByTimeAsync(1000)
		github.release()
		await expect(Promise.all(requests)).resolves.toEqual([
			'',
			'conflicts',
			new Map(),
			'',
			'conflicts',
		])
		expect(github.fetch).toHaveBeenCalledTimes(5)
	})

	it("holds every request whose turn comes during any tab's rate limit pause", async () => {
		const github = stubGitHub(() => new Response(''))
		await fakeBrowser.storage.local.set({
			[RATE_LIMIT_KEY]: { until: Date.now() + 60_000, strikes: 1 },
		})
		const list = createListRequests()
		const [diff, conflicts, heads] = [
			list.diff(ref),
			list.conflicts(ref),
			list.heads('https://github.com/o/r/pulls'),
		].map((request) => (request as Promise<unknown>).catch((error: unknown) => error))
		await vi.advanceTimersByTimeAsync(1000)

		expect(await diff).toBeInstanceOf(PullRequestDiffError)
		expect(await diff).toMatchObject({ isPaused: true })
		expect(await conflicts).toBeInstanceOf(RequestPausedError)
		expect(await heads).toBeInstanceOf(RequestPausedError)
		expect(github.fetch).not.toHaveBeenCalled()
	})
})
