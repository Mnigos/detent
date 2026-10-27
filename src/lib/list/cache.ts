import { browser } from 'wxt/browser'
import type { DiffStats } from './stats'

export const STATS_KEY = 'diffStats'
export const STATS_TTL_MILLISECONDS = 10 * 60 * 1000
export const STATS_CAP = 500

/** A failed fetch is remembered too, so the row stays bare and is not retried until it is stale. */
export type StatsEntry = (DiffStats & { at: number }) | { failed: true; at: number }

export type StatsCache = Record<string, StatsEntry>

export const statsKey = ({
	owner,
	repo,
	number,
}: {
	owner: string
	repo: string
	number: number
}) => `${owner}/${repo}/${number}`

export const isFresh = (entry: StatsEntry | undefined, now = Date.now()) =>
	Boolean(entry && now - entry.at < STATS_TTL_MILLISECONDS)

const isEntry = (value: unknown): value is StatsEntry => {
	if (typeof value !== 'object' || value === null) return false
	const entry = value as Record<string, unknown>
	if (typeof entry.at !== 'number') return false

	return (
		entry.failed === true ||
		(typeof entry.additions === 'number' &&
			typeof entry.deletions === 'number' &&
			typeof entry.files === 'number')
	)
}

/** Keeps the newest `cap` entries. */
export function evictOldest(cache: StatsCache, cap = STATS_CAP): StatsCache {
	const entries = Object.entries(cache)
	if (entries.length <= cap) return cache

	return Object.fromEntries(entries.sort(([, a], [, b]) => b.at - a.at).slice(0, cap))
}

export async function readStatsCache(): Promise<StatsCache> {
	const stored = (await browser.storage.local.get(STATS_KEY))[STATS_KEY]
	if (typeof stored !== 'object' || stored === null) return {}

	return Object.fromEntries(Object.entries(stored).filter(([, entry]) => isEntry(entry)))
}

let pending: Promise<unknown> = Promise.resolve()

// Writes merge into what is stored (another tab may have added entries) and run one at a time.
export function writeStatsEntry(key: string, entry: StatsEntry): Promise<void> {
	const write = pending.then(async () => {
		const cache = await readStatsCache()
		cache[key] = entry
		await browser.storage.local.set({ [STATS_KEY]: evictOldest(cache) })
	})
	pending = write.catch(() => undefined)

	return write
}
