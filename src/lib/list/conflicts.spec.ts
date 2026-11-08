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

const conflictCondition = (result: string, conflicts: string[] = []) => ({
	type: 'PULL_REQUEST_MERGE_CONFLICT_STATE',
	result,
	conflicts,
	isConflictResolvableInWeb: true,
})

// The viewer's direct merge action with each method in the given allowable status.
const mergeActions = (methods: Record<string, string>) => [
	{
		name: 'DIRECT_MERGE',
		mergeMethods: Object.entries(methods).map(([name, allowableStatus]) => ({
			name,
			allowableStatus,
		})),
	},
]

afterEach(() => {
	vi.unstubAllGlobals()
	document.head.innerHTML = ''
})

describe('parseMergeBox', () => {
	it('reads DIRTY as conflicts', () => {
		expect(parseMergeBox(mergeBox({ state: 'OPEN', mergeStateStatus: 'DIRTY' }))).toBe('conflicts')
		const failed = mergeBox({ state: 'OPEN', mergeStateStatus: 'DIRTY' }, [
			conflictCondition('FAILED'),
		])
		expect(parseMergeBox(failed)).toBe('conflicts')
	})

	it('reads a failed conflict condition with conflicting files as conflicts whatever the status says', () => {
		const body = mergeBox({ state: 'OPEN', mergeStateStatus: 'BLOCKED' }, [
			conflictCondition('FAILED', ['src/index.ts']),
		])

		expect(parseMergeBox(body)).toBe('conflicts')
	})

	it('reads a failed conflict condition without conflicting files as a blocked rebase', () => {
		for (const status of ['CLEAN', 'BLOCKED', 'BEHIND', 'UNSTABLE', 'HAS_HOOKS']) {
			const body = mergeBox({ state: 'OPEN', mergeStateStatus: status }, [
				conflictCondition('FAILED'),
			])
			expect(parseMergeBox(body)).toBe('rebase-blocked')
		}
		const withoutList = mergeBox({ state: 'OPEN', mergeStateStatus: 'CLEAN' }, [
			{ type: 'PULL_REQUEST_MERGE_CONFLICT_STATE', result: 'FAILED' },
		])
		expect(parseMergeBox(withoutList)).toBe('rebase-blocked')
	})

	it('shows a blocked rebase only where the repository offers rebase merging', () => {
		const blocked = (pullRequest: Record<string, unknown>, conditions: unknown[] = []) =>
			parseMergeBox(
				mergeBox({ state: 'OPEN', mergeStateStatus: 'CLEAN', ...pullRequest }, [
					conflictCondition('FAILED'),
					...conditions,
				]),
			)

		for (const allowableStatus of ['ALLOWED', 'ALLOWED_WITH_BYPASS', 'UNAVAILABLE'])
			expect(
				blocked({
					viewerMergeActions: mergeActions({ MERGE: 'ALLOWED', REBASE: allowableStatus }),
				}),
			).toBe('rebase-blocked')
		expect(
			blocked({ viewerMergeActions: mergeActions({ MERGE: 'ALLOWED', SQUASH: 'ALLOWED' }) }),
		).toBe('clean')
		expect(
			blocked({ viewerMergeActions: mergeActions({ MERGE: 'ALLOWED', REBASE: 'DISABLED' }) }),
		).toBe('clean')
		expect(blocked({}, [{ type: 'PULL_REQUEST_MERGE_METHOD', result: 'FAILED' }])).toBe('clean')
		// A viewer who cannot merge gets no methods: the response does not say, so the marker shows.
		expect(blocked({ viewerMergeActions: [] })).toBe('rebase-blocked')
	})

	it('reads every other computed status as clean', () => {
		for (const status of ['CLEAN', 'BLOCKED', 'BEHIND', 'UNSTABLE', 'HAS_HOOKS', 'DRAFT'])
			expect(parseMergeBox(mergeBox({ state: 'OPEN', mergeStateStatus: status }))).toBe('clean')
		const passed = mergeBox({ state: 'OPEN', mergeStateStatus: 'CLEAN' }, [
			conflictCondition('PASSED'),
		])
		expect(parseMergeBox(passed)).toBe('clean')
	})

	it('answers unknown while GitHub computes the state or the shape is not the merge box', () => {
		expect(parseMergeBox(mergeBox({ state: 'OPEN', mergeStateStatus: 'UNKNOWN' }))).toBe('unknown')
		const pending = mergeBox({ state: 'OPEN', mergeStateStatus: 'UNKNOWN' }, [
			conflictCondition('FAILED'),
		])
		expect(parseMergeBox(pending)).toBe('unknown')
		expect(parseMergeBox(mergeBox({ state: 'OPEN' }))).toBe('unknown')
		expect(parseMergeBox({ error: 'Not Found' })).toBe('unknown')
		expect(parseMergeBox(null)).toBe('unknown')
		expect(parseMergeBox('DIRTY')).toBe('unknown')
	})

	it('answers clean for a closed or merged pull request', () => {
		expect(parseMergeBox(mergeBox({ state: 'CLOSED', mergeStateStatus: 'DIRTY' }))).toBe('clean')
		expect(parseMergeBox(mergeBox({ state: 'MERGED', mergeStateStatus: 'UNKNOWN' }))).toBe('clean')
		const merged = mergeBox({ state: 'MERGED', mergeStateStatus: 'CLEAN' }, [
			conflictCondition('FAILED'),
		])
		expect(parseMergeBox(merged)).toBe('clean')
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

	it('asks the merge box of the pull request for rebase merging, with the session, and parses it', async () => {
		const fetch = vi.fn(async () =>
			Response.json(mergeBox({ state: 'OPEN', mergeStateStatus: 'DIRTY' })),
		)
		vi.stubGlobal('fetch', fetch)

		await expect(fetchConflictState(ref)).resolves.toBe('conflicts')
		expect(fetch).toHaveBeenCalledWith(
			'https://github.com/o/r/pull/7/page_data/merge_box?merge_method=REBASE&bypass_requirements=false',
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
