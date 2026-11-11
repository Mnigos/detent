// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://github.com/o/r/pull/1"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { requestPullRequestDiff } from '@/src/lib/diff/fetch-diff'
import { forgetPageDiff, requestPageDiff } from '@/src/lib/diff/page-diff'
import { FETCH_DIFF_STATS_MESSAGE } from '@/src/lib/header/fetch-stats'
import { HEADER_CODE_ATTRIBUTE } from '@/src/lib/header/header-dom'
import { readStatsCache, STATS_KEY } from '@/src/lib/list/cache'
import { RATE_LIMIT_KEY } from '@/src/lib/list/rate-limit'
import type { DiffStats } from '@/src/lib/list/stats'
import type { PullRequestLocation } from '@/src/lib/pull-request-url'
import { embeddedData, reactHeader } from '@/src/test/pull-request-header'
import { startHeaderStats } from './mount'

vi.mock('@/src/lib/diff/fetch-diff', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/src/lib/diff/fetch-diff')>()),
	requestPullRequestDiff: vi.fn(),
}))

const location: PullRequestLocation = { owner: 'o', repo: 'r', number: 1, tab: 'conversation' }
const HEAD = 'a'.repeat(40)
const OLD_HEAD = 'b'.repeat(40)

const stats = (codeAdditions: number): DiffStats => ({
	additions: 10,
	deletions: 2,
	files: 2,
	code: { additions: codeAdditions, deletions: 1 },
	excluded: { tests: { additions: 10 - codeAdditions, deletions: 1 } },
})

// One code file and one test file: code +1 −1, totals +2 −2.
const DIFF = [
	'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n',
	'diff --git a/src/a.spec.ts b/src/a.spec.ts\n--- a/src/a.spec.ts\n+++ b/src/a.spec.ts\n@@ -1 +1 @@\n-old\n+new\n',
].join('')

let answer: () => Promise<unknown>
const sendMessage = vi.fn(async (message: { type: string }) =>
	message.type === FETCH_DIFF_STATS_MESSAGE ? answer() : undefined,
)
let view: Awaited<ReturnType<typeof startHeaderStats>> | undefined

const markers = () => [...document.querySelectorAll(`[${HEADER_CODE_ATTRIBUTE}]`)]
const markerText = () => markers().map((marker) => marker.textContent)
const statsRequests = () =>
	sendMessage.mock.calls.filter(([message]) => message.type === FETCH_DIFF_STATS_MESSAGE)

async function mount() {
	view = await startHeaderStats(location)
	view.mount()
}

beforeEach(() => {
	fakeBrowser.reset()
	forgetPageDiff()
	sendMessage.mockClear()
	vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation(sendMessage as never)
	answer = async () => ({ stats: stats(3) })
	history.replaceState(null, '', '/o/r/pull/1')
	document.body.innerHTML = reactHeader() + embeddedData(1, HEAD)
})

// A tab switch inside GitHub's app: a new URL, and the page data and header GitHub renders for it.
function switchTab(path: string, headSha: string) {
	history.pushState(null, '', path)
	document.body.innerHTML = reactHeader() + embeddedData(1, headSha)
}

afterEach(() => {
	view?.remove()
	view = undefined
	vi.mocked(requestPullRequestDiff).mockReset()
})

describe('pull request header code lines', () => {
	it('reuses the cached counts of the head commit the page shows without asking', async () => {
		// An hour old: only the matching head commit keeps it fresh.
		await fakeBrowser.storage.local.set({
			[STATS_KEY]: { 'o/r/1': { ...stats(4), at: Date.now() - 60 * 60_000, headSha: HEAD } },
		})
		await mount()

		expect(markerText()).toEqual(['(+4−1)'])
		await new Promise((done) => setTimeout(done, 20))
		expect(statsRequests()).toEqual([])
	})

	it('asks again when the cache holds another head commit, and stores the counts with the new one', async () => {
		await fakeBrowser.storage.local.set({
			[STATS_KEY]: { 'o/r/1': { ...stats(4), at: Date.now() - 60_000, headSha: OLD_HEAD } },
		})
		await mount()
		expect(markerText()).toEqual([])

		await vi.waitFor(() => expect(markerText()).toEqual(['(+3−1)']))
		expect(statsRequests()).toEqual([
			[{ type: FETCH_DIFF_STATS_MESSAGE, owner: 'o', repo: 'r', number: 1 }],
		])
		await vi.waitFor(async () =>
			expect((await readStatsCache())['o/r/1']).toEqual({
				...stats(3),
				at: expect.any(Number),
				headSha: HEAD,
			}),
		)
	})

	it('counts the diff the layers already downloaded instead of asking for it', async () => {
		vi.mocked(requestPullRequestDiff).mockResolvedValue(DIFF)
		void requestPageDiff({ ...location, tab: 'files' })
		await mount()

		await vi.waitFor(() => expect(markerText()).toEqual(['(+1−1)']))
		expect(statsRequests()).toEqual([])
	})

	it('shows nothing when the code lines equal the totals', async () => {
		answer = async () => ({ stats: { ...stats(10), deletions: 1, excluded: {} } })
		await mount()

		await vi.waitFor(async () => expect((await readStatsCache())['o/r/1']).toBeDefined())
		expect(markers()).toEqual([])
	})

	it('puts the numbers back once after React re-renders the header', async () => {
		await mount()
		await vi.waitFor(() => expect(markers()).toHaveLength(1))
		;(document.querySelector('header') as HTMLElement).outerHTML = reactHeader()

		await vi.waitFor(() => expect(markers()).toHaveLength(1))
		expect(markers()[0]?.isConnected).toBe(true)
		await new Promise((done) => setTimeout(done, 50))
		expect(markers()).toHaveLength(1)
		expect(statsRequests()).toHaveLength(1)
	})

	it('removes the numbers and stops following the header when removed', async () => {
		await mount()
		await vi.waitFor(() => expect(markers()).toHaveLength(1))
		view?.remove()
		view = undefined
		expect(markers()).toEqual([])

		;(document.querySelector('header') as HTMLElement).outerHTML = reactHeader()
		await new Promise((done) => setTimeout(done, 50))
		expect(markers()).toEqual([])
	})

	it('asks for nothing while the lists are paused for a rate limit', async () => {
		await fakeBrowser.storage.local.set({
			[RATE_LIMIT_KEY]: { until: Date.now() + 60_000, strikes: 1 },
		})
		await mount()
		await new Promise((done) => setTimeout(done, 20))

		expect(statsRequests()).toEqual([])
	})

	it('pauses the lists on a rate limit and caches nothing', async () => {
		answer = async () => ({ status: 429, rateLimit: { retryAfterMilliseconds: 30_000 } })
		await mount()

		await vi.waitFor(async () =>
			expect((await fakeBrowser.storage.local.get(RATE_LIMIT_KEY))[RATE_LIMIT_KEY]).toBeDefined(),
		)
		expect(await readStatsCache()).toEqual({})
		expect(markers()).toEqual([])
	})

	it('remembers a failure so the header stays bare and is not asked again at once', async () => {
		answer = async () => ({ status: 404 })
		vi.spyOn(console, 'warn').mockImplementation(() => {})
		await mount()

		await vi.waitFor(async () =>
			expect((await readStatsCache())['o/r/1']).toEqual({
				failed: true,
				at: expect.any(Number),
				headSha: HEAD,
			}),
		)
		view?.remove()
		await mount()
		await new Promise((done) => setTimeout(done, 20))
		expect(statsRequests()).toHaveLength(1)
		expect(markers()).toEqual([])
	})

	it('asks again a second later when the queue held the download for a pause this tab did not see', async () => {
		let calls = 0
		answer = async () => {
			calls += 1
			return calls === 1 ? { status: 0, isPaused: true } : { stats: stats(3) }
		}
		await mount()

		await vi.waitFor(() => expect(markerText()).toEqual(['(+3−1)']), { timeout: 3000 })
		expect(statsRequests()).toHaveLength(2)
	})

	it('loads again when a tab switch shows a newer head commit, and stores the counts for it', async () => {
		await mount()
		await vi.waitFor(() => expect(markerText()).toEqual(['(+3−1)']))
		answer = async () => ({ stats: stats(5) })
		switchTab('/o/r/pull/1/commits', OLD_HEAD)

		await vi.waitFor(() => expect(markerText()).toEqual(['(+5−1)']))
		expect(statsRequests()).toHaveLength(2)
		await vi.waitFor(async () =>
			expect((await readStatsCache())['o/r/1']).toMatchObject({ headSha: OLD_HEAD }),
		)
	})

	it('keeps the counts on a tab switch that shows the same head commit', async () => {
		await mount()
		await vi.waitFor(() => expect(markerText()).toEqual(['(+3−1)']))
		switchTab('/o/r/pull/1/checks', HEAD)
		await new Promise((done) => setTimeout(done, 50))

		expect(markerText()).toEqual(['(+3−1)'])
		expect(statsRequests()).toHaveLength(1)
	})

	it('tries a remembered failure again on a tab switch once it is stale', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {})
		await fakeBrowser.storage.local.set({
			[STATS_KEY]: { 'o/r/1': { failed: true, at: Date.now() - 1000, headSha: HEAD } },
		})
		const now = Date.now()
		const clock = vi.spyOn(Date, 'now')
		await mount()
		await new Promise((done) => setTimeout(done, 20))
		expect(statsRequests()).toEqual([])

		clock.mockReturnValue(now + 11 * 60_000)
		switchTab('/o/r/pull/1/commits', HEAD)
		await vi.waitFor(() => expect(markerText()).toEqual(['(+3−1)']))
		clock.mockRestore()
	})
})
