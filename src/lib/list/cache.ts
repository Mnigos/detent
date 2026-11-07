import { browser } from 'wxt/browser'
import type { ConflictState } from './conflicts'
import type { DiffStats } from './stats'

// The version moves whenever the counted shape changes, so entries of an older build are not shown.
export const STATS_KEY = 'diffStats:v2'
export const LEGACY_STATS_KEYS = ['diffStats']
/** How long stats are reused when the row's head commit is not known. */
export const STATS_TTL_MILLISECONDS = 10 * 60 * 1000
/** How long stats counted for a head commit are reused while the row still shows that commit. */
export const STATS_HEAD_TTL_MILLISECONDS = 7 * 24 * 60 * 60 * 1000
// The version moves whenever the stored shape changes, so entries of an older build are not read. An optional field
// that older builds ignore and newer ones can do without (headSha) is not such a change.
export const CONFLICTS_KEY = 'mergeConflicts:v3'
// Conflicts appear when the base branch moves, which the row does not show, so they are asked again after a while.
export const CONFLICTS_TTL_MILLISECONDS = 10 * 60 * 1000
export const STATS_CAP = 500

/**
 * A failed fetch is remembered too, so the row stays bare and is not retried until it is stale. `headSha`: the head
 * commit the list showed when the diff was asked for.
 */
export type StatsEntry =
	| (DiffStats & { at: number; headSha?: string })
	| { failed: true; at: number; headSha?: string }

export type StatsCache = Record<string, StatsEntry>

/** Only a state GitHub finished computing is stored; "unknown" is never cached. */
export interface ConflictsEntry {
	state: Exclude<ConflictState, 'unknown'>
	at: number
	headSha?: string
}

const CONFLICT_STATES = new Set<unknown>(['conflicts', 'rebase-blocked', 'clean'])

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

/**
 * Stats counted for the head commit the row shows are reused for a week; without a commit on either side, or after a
 * failure, for ten minutes. A different commit is always stale.
 */
export function isStatsFresh(entry: StatsEntry | undefined, headSha?: string, now = Date.now()) {
	if (!entry) return false
	if ('failed' in entry || !headSha || !entry.headSha) return isFresh(entry, now)

	return entry.headSha === headSha && now - entry.at < STATS_HEAD_TTL_MILLISECONDS
}

/** A conflict state is reused for ten minutes, unless the row now shows a head commit other than the one it was read for. */
export const isConflictFresh = (
	entry: ConflictsEntry | undefined,
	headSha?: string,
	now = Date.now(),
) =>
	isFresh(entry, now, CONFLICTS_TTL_MILLISECONDS) &&
	!(headSha && entry?.headSha && entry.headSha !== headSha)

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null

const hasHead = (value: Record<string, unknown>) =>
	value.headSha === undefined || typeof value.headSha === 'string'

const isStatsEntry = (value: unknown): value is StatsEntry => {
	if (!isRecord(value) || typeof value.at !== 'number' || !hasHead(value)) return false

	return (
		value.failed === true ||
		(typeof value.additions === 'number' &&
			typeof value.deletions === 'number' &&
			typeof value.files === 'number' &&
			typeof value.code === 'object' &&
			typeof value.excluded === 'object')
	)
}

const isConflictsEntry = (value: unknown): value is ConflictsEntry =>
	isRecord(value) &&
	typeof value.at === 'number' &&
	CONFLICT_STATES.has(value.state) &&
	hasHead(value)

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

export const removeLegacyStatsCaches = () => browser.storage.local.remove(LEGACY_STATS_KEYS)
