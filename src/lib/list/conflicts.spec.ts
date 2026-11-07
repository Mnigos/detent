// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	fetchConflictState,
	isSignedIn,
	MergeBoxUnavailableError,
	parseMergeBox,
} from './conflicts'

// Hand-written: the fields GitHub's merge box reads from /pull/<n>/page_data/merge_box.
const mergeBox = (pullRequest: Record<string, unknown>, conditions: unknown[] = []) => ({
	pullRequest: { id: 'PR_1', headRefOid: 'abc', baseRefName: 'main', ...pullRequest },
	mergeRequirements: { state: 'UNKNOWN', conditions },
})

afterEach(() => {
	vi.unstubAllGlobals()
	document.head.innerHTML = ''
})

describe('parseMergeBox', () => {
	it('reads DIRTY as conflicts', () => {
		expect(parseMergeBox(mergeBox({ state: 'OPEN', mergeStateStatus: 'DIRTY' }))).toBe('conflicts')
	})

	it('reads a failed conflict condition as conflicts whatever the status says', () => {
		const body = mergeBox({ state: 'OPEN', mergeStateStatus: 'BLOCKED' }, [
			{ type: 'PULL_REQUEST_MERGE_CONFLICT_STATE', result: 'FAILED' },
		])

		expect(parseMergeBox(body)).toBe('conflicts')
	})

	it('reads every other computed status as clean', () => {
		for (const status of ['CLEAN', 'BLOCKED', 'BEHIND', 'UNSTABLE', 'HAS_HOOKS', 'DRAFT'])
			expect(parseMergeBox(mergeBox({ state: 'OPEN', mergeStateStatus: status }))).toBe('clean')
		const passed = mergeBox({ state: 'OPEN', mergeStateStatus: 'CLEAN' }, [
			{ type: 'PULL_REQUEST_MERGE_CONFLICT_STATE', result: 'PASSED' },
		])
		expect(parseMergeBox(passed)).toBe('clean')
	})

	it('answers unknown while GitHub computes the state or the shape is not the merge box', () => {
		expect(parseMergeBox(mergeBox({ state: 'OPEN', mergeStateStatus: 'UNKNOWN' }))).toBe('unknown')
		expect(parseMergeBox(mergeBox({ state: 'OPEN' }))).toBe('unknown')
		expect(parseMergeBox({ error: 'Not Found' })).toBe('unknown')
		expect(parseMergeBox(null)).toBe('unknown')
		expect(parseMergeBox('DIRTY')).toBe('unknown')
	})

	it('answers clean for a closed or merged pull request', () => {
		expect(parseMergeBox(mergeBox({ state: 'CLOSED', mergeStateStatus: 'DIRTY' }))).toBe('clean')
		expect(parseMergeBox(mergeBox({ state: 'MERGED', mergeStateStatus: 'UNKNOWN' }))).toBe('clean')
	})
})

describe('isSignedIn', () => {
	it('reads the user-login meta tag GitHub leaves empty for a signed-out visitor', () => {
		document.head.innerHTML = '<meta name="user-login" content="">'
		expect(isSignedIn()).toBe(false)

		document.head.innerHTML = '<meta name="user-login" content="octocat">'
		expect(isSignedIn()).toBe(true)

		document.head.innerHTML = ''
		expect(isSignedIn()).toBe(false)
	})
})

describe('fetchConflictState', () => {
	const ref = { owner: 'o', repo: 'r', number: 7 }

	it('asks the merge box of the pull request with the session and parses it', async () => {
		const fetch = vi.fn(async () =>
			Response.json(mergeBox({ state: 'OPEN', mergeStateStatus: 'DIRTY' })),
		)
		vi.stubGlobal('fetch', fetch)

		await expect(fetchConflictState(ref)).resolves.toBe('conflicts')
		expect(fetch).toHaveBeenCalledWith(
			'https://github.com/o/r/pull/7/page_data/merge_box',
			expect.objectContaining({ credentials: 'same-origin' }),
		)
	})

	it('throws for a refused merge box, so the list stops asking', async () => {
		vi.stubGlobal('fetch', async () => Response.json({ error: 'Not Found' }, { status: 404 }))

		await expect(fetchConflictState(ref)).rejects.toBeInstanceOf(MergeBoxUnavailableError)
	})

	it('answers unknown for a server error or a body that is not JSON', async () => {
		vi.stubGlobal('fetch', async () => new Response('', { status: 502 }))
		await expect(fetchConflictState(ref)).resolves.toBe('unknown')

		vi.stubGlobal('fetch', async () => new Response('<html>', { status: 200 }))
		await expect(fetchConflictState(ref)).resolves.toBe('unknown')
	})
})
