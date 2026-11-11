// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RateLimitError, RequestPausedError } from '../rate-limit'
import {
	allowsRebase,
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

const methodFailed = { type: 'PULL_REQUEST_MERGE_METHOD', result: 'FAILED' }

describe('parseMergeBox', () => {
	it('reads DIRTY as conflicts in either mode', () => {
		for (const mode of ['default', 'rebase'] as const) {
			expect(parseMergeBox(mergeBox({ state: 'OPEN', mergeStateStatus: 'DIRTY' }), mode)).toBe(
				'conflicts',
			)
			const failed = mergeBox({ state: 'OPEN', mergeStateStatus: 'DIRTY' }, [
				conflictCondition('FAILED'),
				methodFailed,
			])
			expect(parseMergeBox(failed, mode)).toBe('conflicts')
		}
	})

	it('reads a failed conflict condition with conflicting files as conflicts whatever the status says', () => {
		for (const mode of ['default', 'rebase'] as const) {
			const body = mergeBox({ state: 'OPEN', mergeStateStatus: 'BLOCKED' }, [
				conflictCondition('FAILED', ['src/index.ts']),
			])
			expect(parseMergeBox(body, mode)).toBe('conflicts')
		}
	})

	it('reads a failed conflict condition without files as conflicts by default and a blocked rebase when asked for rebase', () => {
		for (const status of ['CLEAN', 'BLOCKED', 'UNSTABLE', 'HAS_HOOKS']) {
			const body = mergeBox({ state: 'OPEN', mergeStateStatus: status }, [
				conflictCondition('FAILED'),
			])
			expect(parseMergeBox(body)).toBe('conflicts')
			expect(parseMergeBox(body, 'rebase')).toBe('rebase-blocked')
		}
		const withoutList = mergeBox({ state: 'OPEN', mergeStateStatus: 'CLEAN' }, [
			{ type: 'PULL_REQUEST_MERGE_CONFLICT_STATE', result: 'FAILED' },
		])
		expect(parseMergeBox(withoutList, 'rebase')).toBe('rebase-blocked')
	})

	it('never reads an answer whose merge method condition failed as clean', () => {
		for (const mode of ['default', 'rebase'] as const)
			for (const status of ['CLEAN', 'BLOCKED', 'BEHIND', 'UNSTABLE', 'HAS_HOOKS']) {
				const body = mergeBox({ state: 'OPEN', mergeStateStatus: status }, [
					conflictCondition('PASSED'),
					methodFailed,
				])
				expect(parseMergeBox(body, mode)).toBe('unknown')
				expect(
					parseMergeBox(
						mergeBox({ state: 'OPEN', mergeStateStatus: status }, [methodFailed]),
						mode,
					),
				).toBe('unknown')
			}
	})

	it('leaves a branch that must be updated first unmarked, as GitHub only says it is out of date', () => {
		for (const mode of ['default', 'rebase'] as const)
			for (const conflicts of [[], ['src/index.ts']]) {
				const body = mergeBox({ state: 'OPEN', mergeStateStatus: 'BEHIND' }, [
					conflictCondition('FAILED', conflicts),
				])
				expect(parseMergeBox(body, mode)).toBe('clean')
			}
	})

	it('reads every other computed status as clean', () => {
		for (const mode of ['default', 'rebase'] as const) {
			for (const status of ['CLEAN', 'BLOCKED', 'BEHIND', 'UNSTABLE', 'HAS_HOOKS', 'DRAFT'])
				expect(parseMergeBox(mergeBox({ state: 'OPEN', mergeStateStatus: status }), mode)).toBe(
					'clean',
				)
			const passed = mergeBox({ state: 'OPEN', mergeStateStatus: 'CLEAN' }, [
				conflictCondition('PASSED'),
				{ type: 'PULL_REQUEST_MERGE_METHOD', result: 'PASSED' },
			])
			expect(parseMergeBox(passed, mode)).toBe('clean')
		}
	})

	it('answers unknown while GitHub computes the state or the shape is not the merge box', () => {
		expect(parseMergeBox(mergeBox({ state: 'OPEN', mergeStateStatus: 'UNKNOWN' }))).toBe('unknown')
		for (const conflicts of [[], ['src/index.ts']]) {
			const pending = mergeBox({ state: 'OPEN', mergeStateStatus: 'UNKNOWN' }, [
				conflictCondition('FAILED', conflicts),
			])
			expect(parseMergeBox(pending)).toBe('unknown')
			expect(parseMergeBox(pending, 'rebase')).toBe('unknown')
		}
		expect(parseMergeBox(mergeBox({ state: 'OPEN' }))).toBe('unknown')
		expect(parseMergeBox({ error: 'Not Found' })).toBe('unknown')
		expect(parseMergeBox(null)).toBe('unknown')
		expect(parseMergeBox(undefined, 'rebase')).toBe('unknown')
		expect(parseMergeBox('DIRTY')).toBe('unknown')
	})

	it('answers clean for a closed or merged pull request', () => {
		expect(parseMergeBox(mergeBox({ state: 'CLOSED', mergeStateStatus: 'DIRTY' }))).toBe('clean')
		expect(parseMergeBox(mergeBox({ state: 'MERGED', mergeStateStatus: 'UNKNOWN' }))).toBe('clean')
		const merged = mergeBox({ state: 'MERGED', mergeStateStatus: 'CLEAN' }, [
			conflictCondition('FAILED'),
		])
		expect(parseMergeBox(merged, 'rebase')).toBe('clean')
	})
})

describe('allowsRebase', () => {
	const offered = (methods: Record<string, string>, state = 'OPEN') =>
		allowsRebase(
			mergeBox({ state, mergeStateStatus: 'CLEAN', viewerMergeActions: mergeActions(methods) }),
		)

	it('says yes only when the viewer is offered rebase merging', () => {
		expect(offered({ MERGE: 'ALLOWED', REBASE: 'ALLOWED' })).toBe(true)
		expect(offered({ REBASE: 'ALLOWED_WITH_BYPASS' })).toBe(true)
		expect(offered({ MERGE: 'ALLOWED', SQUASH: 'ALLOWED' })).toBe(false)
		for (const allowableStatus of ['UNAVAILABLE', 'DISABLED'])
			expect(offered({ SQUASH: 'ALLOWED', REBASE: allowableStatus })).toBe(false)
		expect(offered({ REBASE: 'ALLOWED' }, 'MERGED')).toBe(false)
	})

	it('says no when the answer lists no merge methods', () => {
		expect(allowsRebase(mergeBox({ state: 'OPEN', mergeStateStatus: 'CLEAN' }))).toBe(false)
		expect(
			allowsRebase(mergeBox({ state: 'OPEN', mergeStateStatus: 'CLEAN', viewerMergeActions: [] })),
		).toBe(false)
		expect(allowsRebase(undefined)).toBe(false)
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
	const DEFAULT_URL = 'https://github.com/o/r/pull/7/page_data/merge_box'
	const REBASE_URL = `${DEFAULT_URL}?merge_method=REBASE&bypass_requirements=false`

	// Answers the default request and the rebase request with their own bodies, and records the asked URLs.
	function stubMergeBox(answers: { default: unknown; rebase?: unknown }) {
		const fetch = vi.fn(async (url: string) =>
			Response.json(url === REBASE_URL ? answers.rebase : answers.default),
		)
		vi.stubGlobal('fetch', fetch)

		return fetch
	}
	const askedUrls = (fetch: { mock: { calls: [string, ...unknown[]][] } }) =>
		fetch.mock.calls.map(([url]) => url)

	const rebaseAllowed = mergeActions({ MERGE: 'ALLOWED', SQUASH: 'ALLOWED', REBASE: 'ALLOWED' })
	const squashOnly = mergeActions({ MERGE: 'DISABLED', SQUASH: 'ALLOWED', REBASE: 'DISABLED' })

	it('asks the merge box with GitHub default method and the session, and parses it', async () => {
		const fetch = stubMergeBox({ default: mergeBox({ state: 'OPEN', mergeStateStatus: 'DIRTY' }) })

		await expect(fetchConflictState(ref)).resolves.toBe('conflicts')
		expect(fetch).toHaveBeenCalledWith(
			DEFAULT_URL,
			expect.objectContaining({ credentials: 'include' }),
		)
	})

	it('reports a conflict on a squash-only repository with one request', async () => {
		const fetch = stubMergeBox({
			default: mergeBox(
				{ state: 'OPEN', mergeStateStatus: 'DIRTY', viewerMergeActions: squashOnly },
				[conflictCondition('FAILED', ['src/index.ts'])],
			),
			// What the rebase request answers there: the method is refused and the conflict is not mentioned.
			rebase: mergeBox(
				{ state: 'OPEN', mergeStateStatus: 'BLOCKED', viewerMergeActions: squashOnly },
				[methodFailed],
			),
		})

		await expect(fetchConflictState(ref)).resolves.toBe('conflicts')
		expect(askedUrls(fetch)).toEqual([DEFAULT_URL])
	})

	it('reports a conflict with one request even where rebase merging is allowed', async () => {
		const fetch = stubMergeBox({
			default: mergeBox({
				state: 'OPEN',
				mergeStateStatus: 'DIRTY',
				viewerMergeActions: rebaseAllowed,
			}),
		})

		await expect(fetchConflictState(ref)).resolves.toBe('conflicts')
		expect(askedUrls(fetch)).toEqual([DEFAULT_URL])
	})

	it("asks for rebase merging after a clean answer that allows it, and reports Can't rebase", async () => {
		const fetch = stubMergeBox({
			default: mergeBox(
				{ state: 'OPEN', mergeStateStatus: 'BLOCKED', viewerMergeActions: rebaseAllowed },
				[conflictCondition('PASSED')],
			),
			rebase: mergeBox(
				{ state: 'OPEN', mergeStateStatus: 'BLOCKED', viewerMergeActions: rebaseAllowed },
				[conflictCondition('FAILED')],
			),
		})

		await expect(fetchConflictState(ref)).resolves.toBe('rebase-blocked')
		expect(askedUrls(fetch)).toEqual([DEFAULT_URL, REBASE_URL])
		expect(fetch).toHaveBeenLastCalledWith(
			REBASE_URL,
			expect.objectContaining({ credentials: 'include' }),
		)
	})

	it('answers clean when both the default and the rebase answer are clean', async () => {
		const clean = mergeBox(
			{ state: 'OPEN', mergeStateStatus: 'CLEAN', viewerMergeActions: rebaseAllowed },
			[conflictCondition('PASSED')],
		)
		const fetch = stubMergeBox({ default: clean, rebase: clean })

		await expect(fetchConflictState(ref)).resolves.toBe('clean')
		expect(askedUrls(fetch)).toEqual([DEFAULT_URL, REBASE_URL])
	})

	it('does not ask for rebase merging when the viewer is not offered it', async () => {
		for (const viewerMergeActions of [squashOnly, mergeActions({ REBASE: 'UNAVAILABLE' }), []]) {
			const fetch = stubMergeBox({
				default: mergeBox({ state: 'OPEN', mergeStateStatus: 'CLEAN', viewerMergeActions }),
				rebase: mergeBox({ state: 'OPEN', mergeStateStatus: 'CLEAN' }, [
					conflictCondition('FAILED'),
				]),
			})

			await expect(fetchConflictState(ref)).resolves.toBe('clean')
			expect(askedUrls(fetch)).toEqual([DEFAULT_URL])
		}
	})

	it('answers unknown, not clean, when the rebase answer refuses the merge method or is unusable', async () => {
		const clean = mergeBox({
			state: 'OPEN',
			mergeStateStatus: 'CLEAN',
			viewerMergeActions: rebaseAllowed,
		})
		stubMergeBox({
			default: clean,
			rebase: mergeBox({ state: 'OPEN', mergeStateStatus: 'CLEAN' }, [methodFailed]),
		})
		await expect(fetchConflictState(ref)).resolves.toBe('unknown')

		stubMergeBox({ default: clean, rebase: { error: 'Server Error' } })
		await expect(fetchConflictState(ref)).resolves.toBe('unknown')

		vi.stubGlobal('fetch', async (url: string) =>
			url === REBASE_URL ? new Response('', { status: 502 }) : Response.json(clean),
		)
		await expect(fetchConflictState(ref)).resolves.toBe('unknown')
	})

	it('throws for a refused merge box, so the list stops asking', async () => {
		vi.stubGlobal('fetch', async () => Response.json({ error: 'Not Found' }, { status: 404 }))
		await expect(fetchConflictState(ref)).rejects.toBeInstanceOf(MergeBoxUnavailableError)

		const clean = mergeBox({
			state: 'OPEN',
			mergeStateStatus: 'CLEAN',
			viewerMergeActions: rebaseAllowed,
		})
		vi.stubGlobal('fetch', async (url: string) =>
			url === REBASE_URL ? new Response('', { status: 403 }) : Response.json(clean),
		)
		await expect(fetchConflictState(ref)).rejects.toBeInstanceOf(MergeBoxUnavailableError)
	})

	it('throws a rate limit, not a refusal, for a 429 or a rate-limited 403', async () => {
		vi.stubGlobal(
			'fetch',
			async () => new Response('', { status: 429, headers: { 'Retry-After': '90' } }),
		)
		await expect(fetchConflictState(ref)).rejects.toEqual(new RateLimitError(90_000))

		vi.stubGlobal(
			'fetch',
			async () => new Response('You have exceeded a secondary rate limit.', { status: 403 }),
		)
		const error = await fetchConflictState(ref).catch((error: unknown) => error)
		expect(error).toBeInstanceOf(RateLimitError)
		expect(error).not.toBeInstanceOf(MergeBoxUnavailableError)
		expect((error as RateLimitError).retryAfterMilliseconds).toBeUndefined()
	})

	it('sends both requests through the given send and passes on a pause it reports for the rebase one', async () => {
		const send = vi
			.fn<(url: string, init?: RequestInit) => Promise<Response>>()
			.mockResolvedValueOnce(
				Response.json(
					mergeBox({ state: 'OPEN', mergeStateStatus: 'CLEAN', viewerMergeActions: rebaseAllowed }),
				),
			)
			.mockRejectedValueOnce(new RequestPausedError())
		const fetch = vi.fn()
		vi.stubGlobal('fetch', fetch)
		await expect(fetchConflictState(ref, send)).rejects.toBeInstanceOf(RequestPausedError)
		expect(send).toHaveBeenCalledTimes(2)
		expect(send.mock.calls[1]?.[0]).toContain('merge_method=REBASE')
		expect(fetch).not.toHaveBeenCalled()
	})

	it('answers unknown for a server error or a body that is not JSON', async () => {
		vi.stubGlobal('fetch', async () => new Response('', { status: 502 }))
		await expect(fetchConflictState(ref)).resolves.toBe('unknown')

		vi.stubGlobal('fetch', async () => new Response('<html>', { status: 200 }))
		await expect(fetchConflictState(ref)).resolves.toBe('unknown')
	})
})
