import { beforeEach, describe, expect, it } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import {
	CONFLICTS_KEY,
	CONFLICTS_TTL_MILLISECONDS,
	evictOldest,
	isConflictFresh,
	isFresh,
	isStatsFresh,
	LEGACY_STATS_KEYS,
	readConflictsCache,
	readStatsCache,
	removeLegacyStatsCaches,
	STATS_HEAD_TTL_MILLISECONDS,
	STATS_KEY,
	STATS_TTL_MILLISECONDS,
	type StatsCache,
	writeConflictsEntry,
	writeStatsEntry,
} from './cache'

beforeEach(() => {
	fakeBrowser.reset()
})

const entry = (at: number) => ({
	additions: 1,
	deletions: 2,
	files: 3,
	code: { additions: 1, deletions: 1 },
	excluded: { blank: { additions: 0, deletions: 1 } },
	at,
})

describe('isFresh', () => {
	it('is fresh for ten minutes and stale after', () => {
		expect(isFresh(entry(0), STATS_TTL_MILLISECONDS - 1)).toBe(true)
		expect(isFresh(entry(0), STATS_TTL_MILLISECONDS)).toBe(false)
		expect(isFresh({ failed: true, at: 0 }, 1)).toBe(true)
		expect(isFresh(undefined, 0)).toBe(false)
	})
})

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)

describe('isStatsFresh', () => {
	it('reuses stats counted for the head commit the row shows for a week, however old', () => {
		const counted = { ...entry(0), headSha: SHA_A }

		expect(STATS_HEAD_TTL_MILLISECONDS).toBe(7 * 24 * 60 * 60 * 1000)
		expect(isStatsFresh(counted, SHA_A, STATS_TTL_MILLISECONDS * 10)).toBe(true)
		expect(isStatsFresh(counted, SHA_A, STATS_HEAD_TTL_MILLISECONDS - 1)).toBe(true)
		expect(isStatsFresh(counted, SHA_A, STATS_HEAD_TTL_MILLISECONDS)).toBe(false)
	})

	it('treats stats of another head commit as stale at once', () => {
		expect(isStatsFresh({ ...entry(0), headSha: SHA_A }, SHA_B, 1)).toBe(false)
	})

	it('falls back on ten minutes when either side has no head commit, and for a failure', () => {
		for (const [stored, headSha] of [
			[entry(0), SHA_A],
			[{ ...entry(0), headSha: SHA_A }, undefined],
			[{ failed: true as const, at: 0, headSha: SHA_A }, SHA_A],
		] as const) {
			expect(isStatsFresh(stored, headSha, STATS_TTL_MILLISECONDS - 1)).toBe(true)
			expect(isStatsFresh(stored, headSha, STATS_TTL_MILLISECONDS)).toBe(false)
		}
		expect(isStatsFresh(undefined, SHA_A, 0)).toBe(false)
	})
})

describe('isConflictFresh', () => {
	it('keeps a conflict state for ten minutes', () => {
		const conflict = { state: 'conflicts' as const, at: 0 }

		expect(CONFLICTS_TTL_MILLISECONDS).toBe(10 * 60 * 1000)
		expect(isConflictFresh(conflict, undefined, CONFLICTS_TTL_MILLISECONDS - 1)).toBe(true)
		expect(isConflictFresh(conflict, SHA_A, CONFLICTS_TTL_MILLISECONDS - 1)).toBe(true)
		expect(isConflictFresh(conflict, undefined, CONFLICTS_TTL_MILLISECONDS)).toBe(false)
	})

	it('drops a state read for another head commit at once', () => {
		const conflict = { state: 'clean' as const, at: 0, headSha: SHA_A }

		expect(isConflictFresh(conflict, SHA_A, 1)).toBe(true)
		expect(isConflictFresh(conflict, SHA_B, 1)).toBe(false)
		expect(isConflictFresh(conflict, undefined, 1)).toBe(true)
	})
})

describe('evictOldest', () => {
	it('keeps the newest entries up to the cap', () => {
		const cache: StatsCache = { a: entry(1), b: entry(3), c: entry(2) }

		expect(Object.keys(evictOldest(cache, 2)).sort()).toEqual(['b', 'c'])
		expect(evictOldest(cache, 3)).toBe(cache)
	})
})

describe('storage', () => {
	it('merges written entries into the stored map and drops malformed ones on read', async () => {
		await fakeBrowser.storage.local.set({
			[STATS_KEY]: {
				'o/r/1': entry(1),
				bad: { at: 'x' },
				badHead: { ...entry(1), headSha: 1 },
			},
		})
		await writeStatsEntry('o/r/2', { failed: true, at: 2 })
		await writeStatsEntry('o/r/3', { ...entry(3), headSha: SHA_A })

		await expect(readStatsCache()).resolves.toEqual({
			'o/r/1': entry(1),
			'o/r/2': { failed: true, at: 2 },
			'o/r/3': { ...entry(3), headSha: SHA_A },
		})
	})

	it('keeps conflict states apart from the diff stats', async () => {
		await fakeBrowser.storage.local.set({
			[CONFLICTS_KEY]: {
				'o/r/1': { state: 'conflicts', at: 1 },
				'o/r/3': { state: 'rebase-blocked', at: 3 },
				'o/r/4': { state: 'conflicts', unresolved: true, at: 4 },
				bad: { state: 'unknown', at: 1 },
				badUnresolved: { state: 'clean', unresolved: 1, at: 1 },
			},
		})
		await writeConflictsEntry('o/r/2', { state: 'clean', unresolved: true, at: 2, headSha: SHA_A })

		await expect(readConflictsCache()).resolves.toEqual({
			'o/r/1': { state: 'conflicts', at: 1 },
			'o/r/2': { state: 'clean', unresolved: true, at: 2, headSha: SHA_A },
			'o/r/3': { state: 'rebase-blocked', at: 3 },
			'o/r/4': { state: 'conflicts', unresolved: true, at: 4 },
		})
		await expect(readStatsCache()).resolves.toEqual({})
	})

	it('keeps conflict states under a key of their own and ignores the entries of older builds', async () => {
		expect(CONFLICTS_KEY).toBe('mergeConflicts:v4')
		await fakeBrowser.storage.local.set({
			mergeConflicts: { 'o/r/1': { hasConflicts: true, at: 1 } },
			// v2 asked only for rebase merging and stored "clean" for conflicts on repositories without it.
			'mergeConflicts:v2': { 'o/r/3': { state: 'clean', at: Date.now() } },
			// v3 did not look at conversation resolution, so its "clean" may hide unresolved comments.
			'mergeConflicts:v3': { 'o/r/4': { state: 'clean', at: Date.now() } },
			[CONFLICTS_KEY]: { 'o/r/2': { hasConflicts: true, at: 2 } },
		})

		await expect(readConflictsCache()).resolves.toEqual({})
	})
})

describe('version', () => {
	it('keeps the counts under a key of their own shape and drops entries without code counts', async () => {
		expect(STATS_KEY).toBe('diffStats:v2')
		expect(LEGACY_STATS_KEYS).toEqual(['diffStats'])

		await fakeBrowser.storage.local.set({
			[STATS_KEY]: {
				'o/r/1': entry(1),
				'o/r/2': { additions: 1, deletions: 2, files: 3, at: 2 },
				'o/r/3': { additions: 1, deletions: 2, files: 3, at: 3, headSha: SHA_A },
			},
		})

		await expect(readStatsCache()).resolves.toEqual({ 'o/r/1': entry(1) })
	})

	it('removes the caches of older versions', async () => {
		await fakeBrowser.storage.local.set({
			diffStats: { 'o/r/1': { additions: 1, deletions: 2, files: 3, at: 1, headSha: SHA_A } },
			[STATS_KEY]: { 'o/r/1': entry(1) },
		})
		await removeLegacyStatsCaches()

		await expect(fakeBrowser.storage.local.get(null)).resolves.toEqual({
			[STATS_KEY]: { 'o/r/1': entry(1) },
		})
	})
})
