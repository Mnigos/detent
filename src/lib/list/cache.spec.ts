import { beforeEach, describe, expect, it } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import {
	CONFLICTS_KEY,
	CONFLICTS_TTL_MILLISECONDS,
	evictOldest,
	isFresh,
	LEGACY_STATS_KEYS,
	readConflictsCache,
	readStatsCache,
	removeLegacyStatsCaches,
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

	it('keeps a conflict state for five minutes only', () => {
		const conflict = { hasConflicts: true, at: 0 }

		expect(CONFLICTS_TTL_MILLISECONDS).toBe(5 * 60 * 1000)
		expect(isFresh(conflict, CONFLICTS_TTL_MILLISECONDS - 1, CONFLICTS_TTL_MILLISECONDS)).toBe(true)
		expect(isFresh(conflict, CONFLICTS_TTL_MILLISECONDS, CONFLICTS_TTL_MILLISECONDS)).toBe(false)
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
		await fakeBrowser.storage.local.set({ [STATS_KEY]: { 'o/r/1': entry(1), bad: { at: 'x' } } })
		await writeStatsEntry('o/r/2', { failed: true, at: 2 })

		await expect(readStatsCache()).resolves.toEqual({
			'o/r/1': entry(1),
			'o/r/2': { failed: true, at: 2 },
		})
	})

	it('keeps conflict states apart from the diff stats', async () => {
		await fakeBrowser.storage.local.set({
			[CONFLICTS_KEY]: {
				'o/r/1': { hasConflicts: true, at: 1 },
				bad: { hasConflicts: 'yes', at: 1 },
			},
		})
		await writeConflictsEntry('o/r/2', { hasConflicts: false, at: 2 })

		await expect(readConflictsCache()).resolves.toEqual({
			'o/r/1': { hasConflicts: true, at: 1 },
			'o/r/2': { hasConflicts: false, at: 2 },
		})
		await expect(readStatsCache()).resolves.toEqual({})
	})
})

describe('version', () => {
	it('keeps the counts under a key of their own shape and drops entries without code counts', async () => {
		expect(STATS_KEY).toBe('diffStats:v2')
		expect(LEGACY_STATS_KEYS).toEqual(['diffStats'])

		await fakeBrowser.storage.local.set({
			[STATS_KEY]: { 'o/r/1': entry(1), 'o/r/2': { additions: 1, deletions: 2, files: 3, at: 2 } },
		})

		await expect(readStatsCache()).resolves.toEqual({ 'o/r/1': entry(1) })
	})

	it('removes the caches of older versions', async () => {
		await fakeBrowser.storage.local.set({
			diffStats: { 'o/r/1': { additions: 1, deletions: 2, files: 3, at: 1 } },
			[STATS_KEY]: { 'o/r/1': entry(1) },
		})
		await removeLegacyStatsCaches()

		await expect(fakeBrowser.storage.local.get(null)).resolves.toEqual({
			[STATS_KEY]: { 'o/r/1': entry(1) },
		})
	})
})
