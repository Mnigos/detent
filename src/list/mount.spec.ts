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
import { FETCH_CONFLICTS_MESSAGE } from '@/src/lib/list/conflicts'
import { FETCH_LIST_HEADS_MESSAGE, type PullHead } from '@/src/lib/list/heads'
import { createListRequests } from '@/src/lib/list/list-requests'
import { RATE_LIMIT_KEY } from '@/src/lib/list/rate-limit'
import { createRequestQueue } from '@/src/lib/list/request-queue'
import {
	CONFLICTS_ATTRIBUTE,
	REBASE_BLOCKED_TITLE,
	UNRESOLVED_ATTRIBUTE,
	UNRESOLVED_TITLE,
} from '@/src/lib/list/rows'
import { errorResponse } from '@/src/lib/rate-limit'
import { startListStats } from './mount'

vi.mock('@/src/lib/diff/fetch-diff', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/src/lib/diff/fetch-diff')>()),
	requestPullRequestDiff: vi.fn(async () => ''),
}))

// Stored stats as the current build counts them: every line is code.
const counted = (additions: number, deletions: number, files: number) => ({
	additions,
	deletions,
	files,
	code: { additions, deletions },
	excluded: {},
})

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

const rowNumber = (element: Element) =>
	Number(
		/\/pull\/(\d+)/.exec(
			element.closest('li')?.querySelector('a[href*="/pull/"]')?.getAttribute('href') ?? '',
		)?.[1],
	)

const unresolvedRows = () =>
	[...document.querySelectorAll(`[${UNRESOLVED_ATTRIBUTE}]`)].map(rowNumber)

const rowMeta = (number: number) =>
	document
		.querySelector(`li a[href$="/pull/${number}"]`)
		?.closest('li')
		?.querySelector(`[${CONFLICTS_ATTRIBUTE}]`)?.parentElement as HTMLElement

const marked = () =>
	[...document.querySelectorAll(`[${CONFLICTS_ATTRIBUTE}]`)].map((marker) =>
		marker.closest('li')?.querySelector('a[href*="/pull/"]')?.getAttribute('href'),
	)

// Answers each pull request number with a mergeStateStatus, REBASE_BLOCKED (clean by default and rebase merging
// offered, but the conflict condition fails when asked for rebase), or a status code. A status followed by
// +UNRESOLVED fails the conversation resolution rule too, +THREADS passes it (threads open, resolution not required).
// `delay` holds each answer back.
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

		const [status, rule] = state.split('+')
		if (rule)
			return Response.json({
				pullRequest: { state: 'OPEN', mergeStateStatus: status },
				mergeRequirements: {
					conditions: [
						{
							type: 'PULL_REQUEST_RULES',
							result: rule === 'UNRESOLVED' ? 'FAILED' : 'PASSED',
							ruleRollups: [
								{
									ruleType: 'REQUIRED_REVIEW_THREAD_RESOLUTION',
									result: rule === 'UNRESOLVED' ? 'FAILED' : 'PASSED',
									metadata: null,
								},
							],
						},
					],
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
// What the service worker answers for the list data of a page; empty unless a test gives head commits.
let listHeads: [string, PullHead][] = []
const headsRequests: string[] = []

// The service worker's side of the list messages, run in place: the real list requests over a queue without the gap,
// so merge box requests reach the stubbed fetch and a stored pause holds them as it would in the worker.
function stubServiceWorker() {
	const list = createListRequests(createRequestQueue({ gapMilliseconds: 0 }))
	vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation((async (message: {
		type: string
		url: string
		owner: string
		repo: string
		number: number
	}) => {
		if (message.type === FETCH_LIST_HEADS_MESSAGE) {
			headsRequests.push(message.url)
			return { heads: listHeads }
		}
		if (message.type === FETCH_CONFLICTS_MESSAGE)
			return list.conflicts(message).catch(errorResponse)

		return undefined
	}) as never)
}

beforeEach(() => {
	fakeBrowser.reset()
	vi.mocked(requestPullRequestDiff).mockReset()
	listHeads = []
	headsRequests.length = 0
	stubServiceWorker()
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
	it('marks only open rows GitHub reports as conflicting, skips drafts, and caches only computed states', async () => {
		renderList([
			{ number: 1 },
			{ number: 2 },
			{ number: 3, icon: 'octicon-git-pull-request-draft' },
			{ number: 4, icon: 'octicon-git-pull-request-closed' },
			{ number: 5, icon: 'octicon-git-merge' },
		])
		const fetch = stubMergeBox({ 1: 'DIRTY', 2: 'CLEAN', 3: 'DIRTY' })
		await mount()

		await vi.waitFor(async () => expect(Object.keys(await readConflictsCache())).toHaveLength(2))
		await vi.waitFor(() => expect(marked()).toEqual(['https://github.com/o/r/pull/1']))
		expect(mergeBoxCalls(fetch)).toEqual([1, 2])
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

	it('marks unresolved comments only where they block the merge, after a conflict marker', async () => {
		renderList([
			{ number: 1 },
			{ number: 2 },
			{ number: 3 },
			{ number: 4 },
			{ number: 5, icon: 'octicon-git-pull-request-draft' },
		])
		const fetch = stubMergeBox({
			1: 'BLOCKED+UNRESOLVED',
			2: 'DIRTY+UNRESOLVED',
			3: 'CLEAN+THREADS',
			4: 'DIRTY',
			5: 'BLOCKED+UNRESOLVED',
		})
		await mount()

		await vi.waitFor(() => expect(unresolvedRows()).toEqual([1, 2]))
		expect(markers()).toEqual([
			{ number: 2, state: 'conflicts', text: '·Conflicts' },
			{ number: 4, state: 'conflicts', text: '·Conflicts' },
		])
		const second = document.querySelector(`[${UNRESOLVED_ATTRIBUTE}]`)
		expect(second?.getAttribute('title')).toBe(UNRESOLVED_TITLE)
		expect(second?.textContent).toBe('·Unresolved comments')
		const row2 = rowMeta(2)
		expect([...row2.children].slice(-2).map((child) => child.getAttributeNames()[0])).toEqual([
			CONFLICTS_ATTRIBUTE,
			UNRESOLVED_ATTRIBUTE,
		])
		expect(mergeBoxCalls(fetch)).toEqual([1, 2, 3, 4])
		await expect(readConflictsCache()).resolves.toEqual({
			'o/r/1': { state: 'clean', unresolved: true, at: expect.any(Number) },
			'o/r/2': { state: 'conflicts', unresolved: true, at: expect.any(Number) },
			'o/r/3': { state: 'clean', at: expect.any(Number) },
			'o/r/4': { state: 'conflicts', at: expect.any(Number) },
		})
	})

	it('shows a cached unresolved state while fresh and drops it once stale or the row is a draft', async () => {
		const now = Date.now()
		await fakeBrowser.storage.local.set({
			[CONFLICTS_KEY]: {
				'o/r/1': { state: 'clean', unresolved: true, at: now - 1000 },
				'o/r/2': { state: 'clean', unresolved: true, at: now - CONFLICTS_TTL_MILLISECONDS - 1 },
				'o/r/3': { state: 'clean', unresolved: true, at: now - 1000 },
			},
		})
		renderList([
			{ number: 1 },
			{ number: 2 },
			{ number: 3, icon: 'octicon-git-pull-request-draft' },
		])
		const fetch = stubMergeBox({ 2: 'CLEAN' })
		await mount()

		expect(unresolvedRows()).toEqual([1])
		await vi.waitFor(() => expect(mergeBoxCalls(fetch)).toEqual([2]))
		await vi.waitFor(async () =>
			expect((await readConflictsCache())['o/r/2']).toEqual({
				state: 'clean',
				at: expect.any(Number),
			}),
		)
		expect(unresolvedRows()).toEqual([1])
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

	it('reuses a state for ten minutes and asks again after', async () => {
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

	it('keeps a pause inferred when it only holds back the rebase follow-up request', async () => {
		renderList([{ number: 1 }])
		const fetch = stubMergeBox({ 1: 'REBASE_BLOCKED' }, 1000)
		await mount()
		await settle()
		await vi.advanceTimersByTimeAsync(500)
		const inferred = { until: Date.now() + 60_000, strikes: 1, inferred: true }
		await fakeBrowser.storage.local.set({ [RATE_LIMIT_KEY]: inferred })
		await vi.advanceTimersByTimeAsync(1000)
		await settle()

		expect(fetch).toHaveBeenCalledOnce()
		await expect(fakeBrowser.storage.local.get(RATE_LIMIT_KEY)).resolves.toEqual({
			[RATE_LIMIT_KEY]: inferred,
		})
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

const sha = (character: string) => character.repeat(40)
const MINUTE = 60 * 1000

// The list data GitHub embeds in the page, hand-written in the shape of the list route's payload.
function embedHeads(heads: Record<number, string>) {
	const script = document.createElement('script')
	script.type = 'application/json'
	script.dataset.target = 'react-app.embeddedData'
	script.textContent = JSON.stringify({
		payload: {
			repoPullsDashboardContentRoute: {
				results: Object.entries(heads).map(([number, headSha]) => ({
					number: Number(number),
					headSha,
					repoNameWithOwner: 'o/r',
					updatedAt: '2026-11-10T18:50:00Z',
					displayState: 'REPO_PULL_REQUEST_DISPLAY_STATE_OPEN',
				})),
			},
		},
	})
	document.body.append(script)
}

describe('list stats by head commit', () => {
	it('reuses stats counted for the head commit the list shows, long past ten minutes', async () => {
		const at = Date.now() - 3 * 24 * 60 * MINUTE
		await fakeBrowser.storage.local.set({
			[STATS_KEY]: {
				'o/r/1': { ...counted(5, 1, 2), at, headSha: sha('a') },
				'o/r/2': { ...counted(7, 0, 1), at, headSha: sha('b') },
			},
		})
		renderList([{ number: 1 }, { number: 2 }], '')
		embedHeads({ 1: sha('a'), 2: sha('c') })
		await mount()
		await vi.waitFor(async () => expect((await readStatsCache())['o/r/2']?.headSha).toBe(sha('c')))

		// Row 2 has a new head commit, so only its diff is asked for, and the new count is stored with that commit.
		expect(diffCalls()).toEqual([2])
		expect(headsRequests).toEqual([])
		await expect(readStatsCache()).resolves.toMatchObject({
			'o/r/1': { additions: 5, at, headSha: sha('a') },
			'o/r/2': { additions: 0, headSha: sha('c') },
		})
	})

	it('keeps the ten minutes for a row the list data does not cover', async () => {
		await fakeBrowser.storage.local.set({
			[STATS_KEY]: {
				'o/r/1': { ...counted(5, 1, 2), at: Date.now() - 11 * MINUTE },
				'o/r/2': { ...counted(5, 1, 2), at: Date.now() - MINUTE },
			},
		})
		renderList([{ number: 1 }, { number: 2 }], '')
		await mount()
		await vi.waitFor(() => expect(diffCalls()).toEqual([1]))
		await new Promise((done) => setTimeout(done, 20))

		// Without data in the page, the list asked once for the page's data, which did not know the rows either.
		expect(headsRequests).toEqual([window.location.href])
		expect(diffCalls()).toEqual([1])
	})

	it('asks once for the list data after a navigation, and lets rows wait for it instead of their diffs', async () => {
		const at = Date.now() - 60 * MINUTE
		await fakeBrowser.storage.local.set({
			[STATS_KEY]: {
				'o/r/1': { ...counted(5, 1, 2), at, headSha: sha('a') },
				'o/r/2': { ...counted(5, 1, 2), at, headSha: sha('b') },
			},
		})
		listHeads = [
			['o/r/1', { headSha: sha('a'), at: Date.now() }],
			['o/r/2', { headSha: sha('b'), at: Date.now() }],
		]
		renderList([{ number: 1 }, { number: 2 }], '')
		await mount()
		await vi.waitFor(() => expect(headsRequests).toHaveLength(1))
		await new Promise((done) => setTimeout(done, 20))

		expect(diffCalls()).toEqual([])
		expect(document.querySelectorAll('[data-detent-diff-stats]')).toHaveLength(2)
	})
})

describe('list conflicts by head commit', () => {
	it('asks again at once when the row shows another head commit than the state was read for', async () => {
		const at = Date.now() - MINUTE
		await fakeBrowser.storage.local.set({
			[CONFLICTS_KEY]: {
				'o/r/1': { state: 'conflicts', at, headSha: sha('a') },
				'o/r/2': { state: 'conflicts', at, headSha: sha('b') },
			},
		})
		renderList([{ number: 1 }, { number: 2 }])
		embedHeads({ 1: sha('a'), 2: sha('c') })
		const fetch = stubMergeBox({ 2: 'CLEAN' })
		await mount()

		// The stale marker of row 2 is not shown while it is asked again.
		expect(marked()).toEqual(['https://github.com/o/r/pull/1'])
		await vi.waitFor(async () =>
			expect((await readConflictsCache())['o/r/2']).toMatchObject({
				state: 'clean',
				headSha: sha('c'),
			}),
		)
		expect(mergeBoxCalls(fetch)).toEqual([2])
		expect(marked()).toEqual(['https://github.com/o/r/pull/1'])
	})
})

// A controllable IntersectionObserver: `show` reports elements entering or leaving the observed area.
function stubIntersectionObserver() {
	const observers: {
		callback: IntersectionObserverCallback
		targets: Set<Element>
		options?: IntersectionObserverInit
	}[] = []
	class FakeObserver {
		private readonly record
		constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
			this.record = { callback, targets: new Set<Element>(), options }
			observers.push(this.record)
		}
		observe(target: Element) {
			this.record.targets.add(target)
		}
		unobserve(target: Element) {
			this.record.targets.delete(target)
		}
		disconnect() {
			this.record.targets.clear()
		}
	}
	vi.stubGlobal('IntersectionObserver', FakeObserver)

	return {
		observers,
		show(elements: Element[], isIntersecting = true) {
			for (const record of observers) {
				const entries = elements
					.filter((element) => record.targets.has(element))
					.map((target) => ({ target, isIntersecting }) as IntersectionObserverEntry)
				if (entries.length > 0) record.callback(entries, record as unknown as IntersectionObserver)
			}
		},
	}
}

describe('list rows near the viewport', () => {
	const items = () => [...document.querySelectorAll('li')]

	it('asks only about rows on screen or one screen below, in their order, and the others once scrolled to', async () => {
		const viewport = stubIntersectionObserver()
		renderList([1, 2, 3, 4, 5, 6].map((number) => ({ number })))
		const fetch = stubMergeBox({})
		await mount()
		await new Promise((done) => setTimeout(done, 20))
		expect(diffCalls()).toEqual([])
		expect(fetch).not.toHaveBeenCalled()
		expect(viewport.observers[0]?.options?.rootMargin).toBe('0px 0px 100% 0px')

		viewport.show(items().slice(0, 2))
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
		expect(vi.mocked(requestPullRequestDiff).mock.calls.map(([{ number }]) => number)).toEqual([
			1, 2,
		])

		viewport.show(items().slice(4))
		viewport.show(items().slice(2, 4))
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(6))
		expect(vi.mocked(requestPullRequestDiff).mock.calls.map(([{ number }]) => number)).toEqual([
			1, 2, 5, 6, 3, 4,
		])
	})

	it('shows cached data on every row, near the viewport or not', async () => {
		stubIntersectionObserver()
		const at = Date.now()
		await fakeBrowser.storage.local.set({
			[STATS_KEY]: { 'o/r/3': { ...counted(1, 1, 1), at } },
			[CONFLICTS_KEY]: { 'o/r/3': { state: 'conflicts', at } },
		})
		renderList([1, 2, 3].map((number) => ({ number })))
		const fetch = stubMergeBox({})
		await mount()

		expect(document.querySelectorAll('[data-detent-diff-stats]')).toHaveLength(1)
		expect(marked()).toEqual(['https://github.com/o/r/pull/3'])
		expect(fetch).not.toHaveBeenCalled()
	})

	it('drops a waiting request for a row scrolled away before its turn', async () => {
		const viewport = stubIntersectionObserver()
		renderList([1, 2, 3, 4, 5].map((number) => ({ number })))
		const pending: (() => void)[] = []
		vi.mocked(requestPullRequestDiff).mockImplementation(
			() => new Promise((done) => pending.push(() => done(''))),
		)
		stubMergeBox({})
		await mount()

		viewport.show(items())
		await vi.waitFor(() => expect(diffCalls()).toEqual([1, 2, 3]))
		viewport.show(items().slice(3), false)
		for (const resolve of pending.splice(0)) resolve()
		await new Promise((done) => setTimeout(done, 20))

		expect(diffCalls()).toEqual([1, 2, 3])
	})
})

describe('list data during a rate limit pause', () => {
	it('does not ask for the list data while paused, and asks once the pause is over', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })
		await fakeBrowser.storage.local.set({
			[RATE_LIMIT_KEY]: { until: Date.now() + 60_000, strikes: 1 },
		})
		renderList([{ number: 1 }], '')
		await mount()
		for (let round = 0; round < 20; round += 1) await vi.advanceTimersByTimeAsync(0)
		expect(headsRequests).toEqual([])

		await vi.advanceTimersByTimeAsync(60_000)
		for (let round = 0; round < 20; round += 1) await vi.advanceTimersByTimeAsync(0)
		expect(headsRequests).toHaveLength(1)
		expect(diffCalls()).toEqual([1])
		vi.useRealTimers()
	})

	it('tries again a second later, not at once, when the worker holds the list data back and this tab is not paused', async () => {
		renderList([{ number: 1 }], '')
		const sendMessage = vi.mocked(fakeBrowser.runtime.sendMessage)
		const answer = sendMessage.getMockImplementation()
		sendMessage.mockImplementation((async (message: { type: string }) => {
			if (message.type === FETCH_LIST_HEADS_MESSAGE) {
				headsRequests.push('held')
				return { status: 0, isPaused: true }
			}
			return (answer as ((message: unknown) => unknown) | undefined)?.(message)
		}) as never)
		await mount()
		await new Promise((done) => setTimeout(done, 50))
		expect(headsRequests).toEqual(['held'])
		expect(diffCalls()).toEqual([])

		// The pause ended after the worker checked it (or this tab never heard of it): the rows are not left waiting.
		sendMessage.mockImplementation(answer as never)
		await vi.waitFor(() => expect(diffCalls()).toEqual([1]), { timeout: 2000 })
		expect(headsRequests).toEqual(['held', window.location.href])
	})
})
