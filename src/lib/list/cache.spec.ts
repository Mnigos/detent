import { beforeEach, describe, expect, it } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import {
	evictOldest,
	isFresh,
	readStatsCache,
	STATS_KEY,
	STATS_TTL_MILLISECONDS,
	type StatsCache,
	writeStatsEntry,
} from './cache'

beforeEach(() => {
	fakeBrowser.reset()
})

const entry = (at: number) => ({ additions: 1, deletions: 2, files: 3, at })

describe('isFresh', () => {
	it('is fresh for ten minutes and stale after', () => {
		expect(isFresh(entry(0), STATS_TTL_MILLISECONDS - 1)).toBe(true)
		expect(isFresh(entry(0), STATS_TTL_MILLISECONDS)).toBe(false)
		expect(isFresh({ failed: true, at: 0 }, 1)).toBe(true)
		expect(isFresh(undefined, 0)).toBe(false)
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
})
