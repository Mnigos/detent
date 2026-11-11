// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { PullRequestDiffError, requestPullRequestDiff } from '@/src/lib/diff/fetch-diff'
import {
	CONFLICTS_KEY,
	CONFLICTS_TTL_MILLISECONDS,
	readConflictsCache,
	readStatsCache,
	STATS_KEY,
} from '@/src/lib/list/cache'
import { RATE_LIMIT_KEY } from '@/src/lib/list/rate-limit'
import { CONFLICTS_ATTRIBUTE, REBASE_BLOCKED_TITLE } from '@/src/lib/list/rows'
import { startListStats } from './mount'

vi.mock('@/src/lib/diff/fetch-diff', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/src/lib/diff/fetch-diff')>()),
	requestPullRequestDiff: vi.fn(async () => ''),
}))

const FIXTURE = readFileSync(resolve(process.cwd(), 'fixtures/github-pulls-list.html'), 'utf8')

type Row = { number: number; icon?: string }

// Clones the fixture's row once per pull request, with its own link, number and state icon.
function renderList(rows: Row[], login = 'octocat') {
	document.documentElement.innerHTML = FIXTURE
	document.head.innerHTML = `<meta name="user-login" content="${login}">`
	const template = document.querySelector('li') as HTMLLIElement
	const list = template.parentElement as HTMLElement
	template.remove()
	for (const { number, icon = 'octicon-git-pull-request' } of rows) {
		const row = template.cloneNode(true) as HTMLLIElement
		const link = row.querySelector('a[href*="/pull/"]') as HTMLAnchorElement
		link.href = `https://github.com/o/r/pull/${number}`
		row.querySelector('svg.octicon')?.setAttribute('class', `octicon ${icon}`)
		list.append(row)
	}
}

const markers = () =>
	[...document.querySelectorAll<HTMLElement>(`[${CONFLICTS_ATTRIBUTE}]`)].map((marker) => ({
		number: Number(
			/\/pull\/(\d+)/.exec(
				marker.closest('li')?.querySelector('a[href*="/pull/"]')?.getAttribute('href') ?? '',
			)?.[1],
		),
		state: marker.getAttribute(CONFLICTS_ATTRIBUTE),
		text: marker.textContent,
	}))

const marked = () =>
	[...document.querySelectorAll(`[${CONFLICTS_ATTRIBUTE}]`)].map((marker) =>
		marker.closest('li')?.querySelector('a[href*="/pull/"]')?.getAttribute('href'),
	)

// Answers each pull request number with a mergeStateStatus, REBASE_BLOCKED (clean by default and rebase merging
// offered, but the conflict condition fails when asked for rebase), or a status code. `delay` holds each answer back.
function stubMergeBox(states: Record<number, string | number>, delay = 0) {
	const fetch = vi.fn(async (url: string) => {
		if (delay) await new Promise((done) => setTimeout(done, delay))
		const number = Number(/\/pull\/(\d+)\//.exec(url)?.[1])
		const state = states[number] ?? 'CLEAN'
		if (typeof state === 'number') return new Response('', { status: state })
		if (state === 'REBASE_BLOCKED')
			return Response.json({
				pullRequest: {
					state: 'OPEN',
					mergeStateStatus: 'CLEAN',
					viewerMergeActions: [
						{
							name: 'DIRECT_MERGE',
							mergeMethods: [{ name: 'REBASE', allowableStatus: 'ALLOWED' }],
						},
					],
				},
				mergeRequirements: {
					conditions: url.includes('merge_method=REBASE')
						? [{ type: 'PULL_REQUEST_MERGE_CONFLICT_STATE', result: 'FAILED', conflicts: [] }]
						: [],
				},
			})

		return Response.json({ pullRequest: { state: 'OPEN', mergeStateStatus: state } })
	})
	vi.stubGlobal('fetch', fetch)

	return fetch
}

const mergeBoxCalls = (fetch: { mock: { calls: [string, ...unknown[]][] } }) =>
	fetch.mock.calls.map(([url]) => Number(/\/pull\/(\d+)\//.exec(url)?.[1])).sort((a, b) => a - b)

let view: Awaited<ReturnType<typeof startListStats>> | undefined

beforeEach(() => {
	fakeBrowser.reset()
	vi.mocked(requestPullRequestDiff).mockReset()
})

afterEach(() => {
	view?.remove()
	view = undefined
	vi.unstubAllGlobals()
})

async function mount() {
	view = await startListStats()
	view.mount()
}

describe('list merge conflicts', () => {
	it('marks only open rows GitHub reports as conflicting, and caches only computed states', async () => {
		renderList([
			{ number: 1 },
			{ number: 2 },
			{ number: 3, icon: 'octicon-git-pull-request-draft' },
			{ number: 4, icon: 'octicon-git-pull-request-closed' },
			{ number: 5, icon: 'octicon-git-merge' },
		])
		const fetch = stubMergeBox({ 1: 'DIRTY', 2: 'CLEAN', 3: 'UNKNOWN' })
		await mount()

		await vi.waitFor(async () => expect(Object.keys(await readConflictsCache())).toHaveLength(2))
		await vi.waitFor(() => expect(marked()).toEqual(['https://github.com/o/r/pull/1']))
		expect(mergeBoxCalls(fetch)).toEqual([1, 2, 3])
		await expect(readConflictsCache()).resolves.toMatchObject({
			'o/r/1': { state: 'conflicts' },
			'o/r/2': { state: 'clean' },
		})
	})

	it("marks a rebase GitHub would refuse as Can't rebase, and a real conflict only as Conflicts", async () => {
		renderList([{ number: 1 }, { number: 2 }, { number: 3 }])
		const fetch = stubMergeBox({ 1: 'REBASE_BLOCKED', 2: 'DIRTY', 3: 'CLEAN' })
		await mount()

		await vi.waitFor(() =>
			expect(markers()).toEqual([
				{ number: 1, state: 'rebase-blocked', text: "·Can't rebase" },
				{ number: 2, state: 'conflicts', text: '·Conflicts' },
			]),
		)
		expect(
			document.querySelector(`[${CONFLICTS_ATTRIBUTE}="rebase-blocked"]`)?.getAttribute('title'),
		).toBe(REBASE_BLOCKED_TITLE)
		// Only the row whose default answer offers rebase merging is asked a second time.
		expect(mergeBoxCalls(fetch)).toEqual([1, 1, 2, 3])
		await expect(readConflictsCache()).resolves.toMatchObject({
			'o/r/1': { state: 'rebase-blocked' },
			'o/r/2': { state: 'conflicts' },
			'o/r/3': { state: 'clean' },
		})
	})

	it('swaps the marker when a stale state comes back different', async () => {
		await fakeBrowser.storage.local.set({
			[CONFLICTS_KEY]: {
				'o/r/1': { state: 'rebase-blocked', at: Date.now() - CONFLICTS_TTL_MILLISECONDS - 1 },
			},
		})
		renderList([{ number: 1 }])
		stubMergeBox({ 1: 'DIRTY' })
		await mount()

		await vi.waitFor(() =>
			expect(markers()).toEqual([{ number: 1, state: 'conflicts', text: '·Conflicts' }]),
		)
	})

	it('asks for nothing on a signed-out list', async () => {
		renderList([{ number: 1 }], '')
		const fetch = stubMergeBox({ 1: 'DIRTY' })
		await mount()
		await new Promise((done) => setTimeout(done, 20))

		expect(fetch).not.toHaveBeenCalled()
		expect(marked()).toEqual([])
	})

	it('stops asking once GitHub refuses the merge box', async () => {
		renderList([1, 2, 3, 4, 5, 6, 7, 8].map((number) => ({ number })))
		const fetch = stubMergeBox(Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((n) => [n, 404])))
		await mount()
		await new Promise((done) => setTimeout(done, 50))

		expect(fetch.mock.calls.length).toBeLessThanOrEqual(5)
		expect(marked()).toEqual([])
	})

	it('keeps asking about the other rows after one refusal', async () => {
		renderList([{ number: 1 }, { number: 2 }])
		const fetch = stubMergeBox({ 1: 403, 2: 'DIRTY' })
		await mount()

		await vi.waitFor(() => expect(marked()).toEqual(['https://github.com/o/r/pull/2']))
		expect(mergeBoxCalls(fetch)).toEqual([1, 2])
	})

	it('stops at once on a 401', async () => {
		renderList([1, 2, 3, 4, 5].map((number) => ({ number })))
		const fetch = stubMergeBox(Object.fromEntries([1, 2, 3, 4, 5].map((n) => [n, 401])))
		await mount()
		await new Promise((done) => setTimeout(done, 50))

		expect(fetch.mock.calls.length).toBeLessThanOrEqual(3)
	})

	it('reuses a state for five minutes and asks again after', async () => {
		const now = Date.now()
		await fakeBrowser.storage.local.set({
			[CONFLICTS_KEY]: {
				'o/r/1': { state: 'conflicts', at: now - 1000 },
				'o/r/2': { state: 'conflicts', at: now - CONFLICTS_TTL_MILLISECONDS - 1 },
			},
		})
		renderList([{ number: 1 }, { number: 2 }])
		const fetch = stubMergeBox({ 1: 'CLEAN', 2: 'CLEAN' })
		await mount()

		expect(marked()).toEqual(['https://github.com/o/r/pull/1'])
		await vi.waitFor(async () => expect((await readConflictsCache())['o/r/2']?.state).toBe('clean'))
		expect(marked()).toEqual(['https://github.com/o/r/pull/1'])
		expect(mergeBoxCalls(fetch)).toEqual([2])
	})

	it('drops a stale conflict when GitHub now answers unknown', async () => {
		await fakeBrowser.storage.local.set({
			[CONFLICTS_KEY]: {
				'o/r/1': { state: 'conflicts', at: Date.now() - CONFLICTS_TTL_MILLISECONDS },
			},
		})
		renderList([{ number: 1 }])
		const fetch = stubMergeBox({ 1: 'UNKNOWN' })
		await mount()
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
		await new Promise((done) => setTimeout(done, 20))

		expect(marked()).toEqual([])
	})

	it('keeps the rebase follow-up request inside the same three requests at a time', async () => {
		renderList([1, 2, 3, 4, 5, 6].map((number) => ({ number })))
		let inFlight = 0
		let most = 0
		const fetch = vi.fn(async (_url: string) => {
			inFlight += 1
			most = Math.max(most, inFlight)
			await new Promise((done) => setTimeout(done, 5))
			inFlight -= 1

			return Response.json({
				pullRequest: {
					state: 'OPEN',
					mergeStateStatus: 'CLEAN',
					viewerMergeActions: [
						{
							name: 'DIRECT_MERGE',
							mergeMethods: [{ name: 'REBASE', allowableStatus: 'ALLOWED' }],
						},
					],
				},
				mergeRequirements: { conditions: [] },
			})
		})
		vi.stubGlobal('fetch', fetch)
		await mount()

		await vi.waitFor(async () => expect(Object.keys(await readConflictsCache())).toHaveLength(6))
		expect(fetch).toHaveBeenCalledTimes(12)
		expect(most).toBeLessThanOrEqual(3)
	})

	it('drops waiting requests for rows a new filter removed', async () => {
		renderList([1, 2, 3, 4, 5, 6].map((number) => ({ number })))
		const pending: (() => void)[] = []
		const fetch = vi.fn(
			(_url: string) =>
				new Promise<Response>((resolve) => {
					pending.push(() =>
						resolve(Response.json({ pullRequest: { state: 'OPEN', mergeStateStatus: 'CLEAN' } })),
					)
				}),
		)
		vi.stubGlobal('fetch', fetch)
		await mount()
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))

		const list = document.querySelector('ul') as HTMLElement
		const template = list.querySelector('li')?.cloneNode(true) as HTMLLIElement
		;(template.querySelector('a[href*="/pull/"]') as HTMLAnchorElement).href =
			'https://github.com/o/r/pull/10'
		list.replaceChildren(template)
		await new Promise((done) => setTimeout(done, 50))
		for (const resolve of pending.splice(0)) resolve()
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(4))
		for (const resolve of pending.splice(0)) resolve()
		await new Promise((done) => setTimeout(done, 20))

		expect(mergeBoxCalls(fetch)).toEqual([1, 2, 3, 10])
	})

	it('asks once more about an unknown state, then leaves the row bare', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })
		try {
			renderList([{ number: 1 }])
			const fetch = stubMergeBox({ 1: 'UNKNOWN' })
			await mount()
			await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))

			await vi.advanceTimersByTimeAsync(15_000)
			await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
			await vi.advanceTimersByTimeAsync(60_000)

			expect(fetch).toHaveBeenCalledTimes(2)
			expect(marked()).toEqual([])
			await expect(readConflictsCache()).resolves.toEqual({})
		} finally {
			vi.useRealTimers()
		}
	})
})

const diffCalls = () =>
	vi
		.mocked(requestPullRequestDiff)
		.mock.calls.map(([ref]) => ref.number)
		.sort((a, b) => a - b)

const rateLimit = (retryAfterMilliseconds?: number) =>
	new PullRequestDiffError(
		429,
		retryAfterMilliseconds === undefined ? {} : { retryAfterMilliseconds },
	)

describe('list rate limits', () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })
		vi.spyOn(console, 'info').mockImplementation(() => undefined)
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	// Lets every settled request and storage write run through, without moving the clock.
	async function settle() {
		for (let round = 0; round < 20; round += 1) await vi.advanceTimersByTimeAsync(0)
	}

	it('pauses both pools for Retry-After, caches nothing for the limited row, then asks only for missing data', async () => {
		renderList([1, 2, 3, 4, 5, 6].map((number) => ({ number })))
		let isLimited = true
		vi.mocked(requestPullRequestDiff).mockImplementation(async ({ number }) => {
			if (number === 1 && isLimited) throw rateLimit(120_000)
			return ''
		})
		const fetch = stubMergeBox({}, 1000)
		await mount()
		await settle()
		await vi.advanceTimersByTimeAsync(1000)
		await settle()

		// The three requests of each pool already sent finish; nothing new goes out for the whole Retry-After.
		await vi.advanceTimersByTimeAsync(117_000)
		expect(diffCalls()).toEqual([1, 2, 3])
		expect(mergeBoxCalls(fetch)).toEqual([1, 2, 3])
		const cached = await readStatsCache()
		expect(cached['o/r/1']).toBeUndefined()
		expect(Object.keys(cached).sort()).toEqual(['o/r/2', 'o/r/3'])

		isLimited = false
		await vi.advanceTimersByTimeAsync(2000)
		await settle()
		await vi.advanceTimersByTimeAsync(2000)
		await settle()

		expect(diffCalls()).toEqual([1, 1, 2, 3, 4, 5, 6])
		expect(mergeBoxCalls(fetch)).toEqual([1, 2, 3, 4, 5, 6])
		await expect(readStatsCache()).resolves.toMatchObject({
			'o/r/1': { additions: 0, deletions: 0 },
		})
	})

	it('pauses a minute without Retry-After and doubles the pause when the limit repeats', async () => {
		renderList([1, 2, 3, 4].map((number) => ({ number })))
		const fetch = stubMergeBox({ 1: 429, 2: 429, 3: 429, 4: 429 })
		await mount()
		await settle()
		expect(fetch).toHaveBeenCalledTimes(3)

		await vi.advanceTimersByTimeAsync(59_000)
		expect(fetch).toHaveBeenCalledTimes(3)
		await vi.advanceTimersByTimeAsync(1000)
		await settle()
		expect(fetch).toHaveBeenCalledTimes(6)

		await vi.advanceTimersByTimeAsync(119_000)
		expect(fetch).toHaveBeenCalledTimes(6)
		await vi.advanceTimersByTimeAsync(1000)
		await settle()
		// Nine 429s in all, and the list still asks: a rate limit is not a refusal.
		expect(fetch).toHaveBeenCalledTimes(9)
		await expect(readConflictsCache()).resolves.toEqual({})
	})

	it('counts a network error while throttled as the limit, not a refusal or an unknown state', async () => {
		renderList([{ number: 1 }])
		vi.mocked(requestPullRequestDiff).mockRejectedValueOnce(rateLimit(60_000)).mockResolvedValue('')
		let failures = 2
		const fetch = vi.fn(async (_url: string) => {
			await new Promise((done) => setTimeout(done, 1000))
			if (failures > 0) {
				failures -= 1
				throw new TypeError('Failed to fetch')
			}
			return Response.json({ pullRequest: { state: 'OPEN', mergeStateStatus: 'DIRTY' } })
		})
		vi.stubGlobal('fetch', fetch)
		await mount()
		await settle()
		// Fails during the pause, and again a second after it, which repeats the limit: two minutes more.
		await vi.advanceTimersByTimeAsync(61_000)
		await settle()
		expect(fetch).toHaveBeenCalledTimes(2)
		await vi.advanceTimersByTimeAsync(118_000)
		expect(fetch).toHaveBeenCalledTimes(2)

		await vi.advanceTimersByTimeAsync(2000)
		await settle()
		await vi.advanceTimersByTimeAsync(1000)
		await settle()
		expect(fetch).toHaveBeenCalledTimes(3)
		expect(marked()).toEqual(['https://github.com/o/r/pull/1'])
	})

	it('stops treating network errors as the limit after one inferred pause', async () => {
		renderList([{ number: 1 }])
		vi.mocked(requestPullRequestDiff).mockRejectedValueOnce(rateLimit(60_000)).mockResolvedValue('')
		vi.spyOn(console, 'warn').mockImplementation(() => undefined)
		const fetch = vi.fn(async (_url: string) => {
			await new Promise((done) => setTimeout(done, 1000))
			throw new TypeError('Failed to fetch')
		})
		vi.stubGlobal('fetch', fetch)
		await mount()
		await settle()

		// t=1 s during the pause, t=61 s within its grace (an inferred pause of two minutes), t=182 s a plain
		// error (unknown), t=197 s its single retry; then the row is left alone and the diff pool runs freely.
		await vi.advanceTimersByTimeAsync(400_000)
		await settle()
		expect(fetch).toHaveBeenCalledTimes(4)
		expect(diffCalls()).toEqual([1, 1])
		await expect(readStatsCache()).resolves.toMatchObject({ 'o/r/1': { additions: 0 } })
	})

	it('holds the rebase follow-up request until the pause is over', async () => {
		renderList([{ number: 1 }])
		vi.mocked(requestPullRequestDiff).mockRejectedValueOnce(rateLimit(60_000)).mockResolvedValue('')
		const fetch = stubMergeBox({ 1: 'REBASE_BLOCKED' }, 1000)
		await mount()
		await settle()
		await vi.advanceTimersByTimeAsync(58_000)
		expect(fetch.mock.calls.map(([url]) => url.includes('merge_method=REBASE'))).toEqual([false])

		await vi.advanceTimersByTimeAsync(2000)
		await settle()
		await vi.advanceTimersByTimeAsync(2000)
		await settle()
		expect(fetch.mock.calls.map(([url]) => url.includes('merge_method=REBASE'))).toEqual([
			false,
			false,
			true,
		])
		expect(markers().map(({ state }) => state)).toEqual(['rebase-blocked'])
	})

	it("honours another tab's pause, stored before the list opens or written while it runs", async () => {
		await fakeBrowser.storage.local.set({
			[RATE_LIMIT_KEY]: { until: Date.now() + 90_000, strikes: 1 },
		})
		renderList([1, 2, 3, 4, 5, 6].map((number) => ({ number })))
		const fetch = stubMergeBox({}, 1000)
		await mount()
		await settle()
		await vi.advanceTimersByTimeAsync(89_000)
		expect(diffCalls()).toEqual([])
		expect(fetch).not.toHaveBeenCalled()

		await vi.advanceTimersByTimeAsync(1000)
		await settle()
		expect(fetch).toHaveBeenCalledTimes(3)
		await vi.advanceTimersByTimeAsync(500)
		await fakeBrowser.storage.local.set({
			[RATE_LIMIT_KEY]: { until: Date.now() + 60_000, strikes: 1 },
		})
		await vi.advanceTimersByTimeAsync(59_000)
		await settle()
		expect(fetch).toHaveBeenCalledTimes(3)

		await vi.advanceTimersByTimeAsync(1000)
		await settle()
		expect(mergeBoxCalls(fetch)).toEqual([1, 2, 3, 4, 5, 6])
	})
})

describe('list request cost', () => {
	it('starts cleanly when a stored pause ends while the caches load', async () => {
		await fakeBrowser.storage.local.set({
			[RATE_LIMIT_KEY]: { until: Date.now() + 40, strikes: 1 },
		})
		const get = fakeBrowser.storage.local.get.bind(fakeBrowser.storage.local)
		vi.spyOn(fakeBrowser.storage.local, 'get').mockImplementation((async (keys: string) => {
			if (keys !== RATE_LIMIT_KEY) await new Promise((done) => setTimeout(done, 150))
			return get(keys)
		}) as never)

		renderList([{ number: 1 }])
		const fetch = stubMergeBox({ 1: 'DIRTY' })
		await mount()

		await vi.waitFor(() => expect(marked()).toEqual(['https://github.com/o/r/pull/1']))
		expect(fetch).toHaveBeenCalledOnce()
		vi.restoreAllMocks()
	})

	it('still caches a real failure for its ten minutes, without pausing the list', async () => {
		renderList([1, 2, 3, 4].map((number) => ({ number })))
		vi.mocked(requestPullRequestDiff).mockRejectedValue(new PullRequestDiffError(404))
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
		const fetch = stubMergeBox({})
		await mount()

		await vi.waitFor(async () => expect(Object.keys(await readStatsCache())).toHaveLength(4))
		await expect(readStatsCache()).resolves.toMatchObject({ 'o/r/1': { failed: true } })
		await vi.waitFor(() => expect(mergeBoxCalls(fetch)).toEqual([1, 2, 3, 4]))
		await expect(fakeBrowser.storage.local.get(RATE_LIMIT_KEY)).resolves.toEqual({})
		warn.mockRestore()
	})

	it('sends nothing for cached rows when the list is opened again within the cache times', async () => {
		const rows = [
			{ number: 1 },
			{ number: 2 },
			{ number: 3 },
			{ number: 4, icon: 'octicon-git-merge' },
		]
		renderList(rows)
		vi.mocked(requestPullRequestDiff).mockImplementation(async ({ number }) => {
			if (number === 3) throw new PullRequestDiffError(404)
			return ''
		})
		vi.spyOn(console, 'warn').mockImplementation(() => undefined)
		const fetch = stubMergeBox({ 1: 'DIRTY', 2: 'REBASE_BLOCKED', 3: 'CLEAN' })
		await mount()
		await vi.waitFor(async () => {
			expect(Object.keys(await readStatsCache())).toHaveLength(4)
			expect(Object.keys(await readConflictsCache())).toHaveLength(3)
		})
		const stored = await fakeBrowser.storage.local.get([STATS_KEY, CONFLICTS_KEY])
		view?.remove()
		vi.mocked(requestPullRequestDiff).mockClear()
		fetch.mockClear()

		renderList(rows)
		await mount()
		await new Promise((done) => setTimeout(done, 50))

		expect(diffCalls()).toEqual([])
		expect(fetch).not.toHaveBeenCalled()
		expect(markers().map(({ number, state }) => ({ number, state }))).toEqual([
			{ number: 1, state: 'conflicts' },
			{ number: 2, state: 'rebase-blocked' },
		])
		await expect(fakeBrowser.storage.local.get([STATS_KEY, CONFLICTS_KEY])).resolves.toEqual(stored)
		vi.restoreAllMocks()
	})
})
