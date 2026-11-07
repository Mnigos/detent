import { browser } from 'wxt/browser'
import type { DiffStats } from './stats'

export const STATS_KEY = 'diffStats'
export const STATS_TTL_MILLISECONDS = 10 * 60 * 1000
export const CONFLICTS_KEY = 'mergeConflicts'
// Conflicts appear when the base branch moves, which the row does not show, so they are asked again soon.
export const CONFLICTS_TTL_MILLISECONDS = 5 * 60 * 1000
export const STATS_CAP = 500

/** A failed fetch is remembered too, so the row stays bare and is not retried until it is stale. */
export type StatsEntry = (DiffStats & { at: number }) | { failed: true; at: number }

export type StatsCache = Record<string, StatsEntry>

/** Only a state GitHub finished computing is stored; "unknown" is never cached. */
export interface ConflictsEntry {
	hasConflicts: boolean
	at: number
}

export type ConflictsCache = Record<string, ConflictsEntry>

export const statsKey = ({
	owner,
	repo,
	number,
}: {
	owner: string
	repo: string
	number: number
}) => `${owner}/${repo}/${number}`

export const isFresh = (
	entry: StatsEntry | ConflictsEntry | undefined,
	now = Date.now(),
	ttl = STATS_TTL_MILLISECONDS,
) => Boolean(entry && now - entry.at < ttl)

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null

const isStatsEntry = (value: unknown): value is StatsEntry => {
	if (!isRecord(value) || typeof value.at !== 'number') return false

	return (
		value.failed === true ||
		(typeof value.additions === 'number' &&
			typeof value.deletions === 'number' &&
			typeof value.files === 'number')
	)
}

const isConflictsEntry = (value: unknown): value is ConflictsEntry =>
	isRecord(value) && typeof value.at === 'number' && typeof value.hasConflicts === 'boolean'

/** Keeps the newest `cap` entries. */
export function evictOldest<T extends { at: number }>(
	cache: Record<string, T>,
	cap = STATS_CAP,
): Record<string, T> {
	const entries = Object.entries(cache)
	if (entries.length <= cap) return cache

	return Object.fromEntries(entries.sort(([, a], [, b]) => b.at - a.at).slice(0, cap))
}

function entryStore<T extends { at: number }>(key: string, isEntry: (value: unknown) => boolean) {
	let pending: Promise<unknown> = Promise.resolve()

	async function read(): Promise<Record<string, T>> {
		const stored = (await browser.storage.local.get(key))[key]
		if (!isRecord(stored)) return {}

		return Object.fromEntries(
			Object.entries(stored).filter(([, entry]) => isEntry(entry)),
		) as Record<string, T>
	}

	// Writes merge into what is stored (another tab may have added entries) and run one at a time.
	function write(entryKey: string, entry: T): Promise<void> {
		const next = pending.then(async () => {
			const cache = await read()
			cache[entryKey] = entry
			await browser.storage.local.set({ [key]: evictOldest(cache) })
		})
		pending = next.catch(() => undefined)

		return next
	}

	return { read, write }
}

const stats = entryStore<StatsEntry>(STATS_KEY, isStatsEntry)
const conflicts = entryStore<ConflictsEntry>(CONFLICTS_KEY, isConflictsEntry)

export const readStatsCache = stats.read
export const writeStatsEntry = stats.write
export const readConflictsCache = conflicts.read
export const writeConflictsEntry = conflicts.write
