// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { CONFLICTS_KEY, CONFLICTS_TTL_MILLISECONDS, readConflictsCache } from '@/src/lib/list/cache'
import { CONFLICTS_ATTRIBUTE, REBASE_BLOCKED_TITLE } from '@/src/lib/list/rows'
import { startListStats } from './mount'

vi.mock('@/src/lib/diff/fetch-diff', () => ({
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
// offered, but the conflict condition fails when asked for rebase), or a status code.
function stubMergeBox(states: Record<number, string | number>) {
	const fetch = vi.fn(async (url: string) => {
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
