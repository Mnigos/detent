import { requestPullRequestDiff } from '@/src/lib/diff/fetch-diff'
import {
	CONFLICTS_TTL_MILLISECONDS,
	type ConflictsCache,
	type ConflictsEntry,
	isFresh,
	readConflictsCache,
	readStatsCache,
	type StatsCache,
	type StatsEntry,
	statsKey,
	writeConflictsEntry,
	writeStatsEntry,
} from '@/src/lib/list/cache'
import {
	type ConflictState,
	fetchConflictState,
	isSignedIn,
	MergeBoxUnavailableError,
} from '@/src/lib/list/conflicts'
import {
	clearAllStats,
	clearConflicts,
	clearStats,
	findPullRows,
	renderConflicts,
	renderStats,
} from '@/src/lib/list/rows'
import { diffStats } from '@/src/lib/list/stats'
import { observeMutations } from '@/src/lib/panel/github-dom'

const CONCURRENCY = 3
// GitHub starts computing an unknown merge state on the first request; one later ask usually gets it.
const UNKNOWN_RETRY_MILLISECONDS = 15_000
const MAX_REFUSALS = 3

type Ref = { owner: string; repo: string; number: number }

/** Runs at most `CONCURRENCY` loads at once and queues each key once until its load settles. */
function createPool(load: (ref: Ref) => Promise<void>) {
	const queue: Ref[] = []
	const queued = new Set<string>()
	let active = 0
	let isStopped = false

	function drain() {
		while (!isStopped && active < CONCURRENCY && queue.length > 0) {
			const ref = queue.shift() as Ref
			active += 1
			void load(ref).finally(() => {
				queued.delete(statsKey(ref))
				active -= 1
				drain()
			})
		}
	}

	return {
		has: (key: string) => queued.has(key),
		/** Drops waiting loads for rows no longer on the page (a changed filter or page). */
		retain(keys: Set<string>) {
			for (let index = queue.length - 1; index >= 0; index -= 1) {
				const key = statsKey(queue[index] as Ref)
				if (keys.has(key)) continue

				queue.splice(index, 1)
				queued.delete(key)
			}
		},
		push(ref: Ref) {
			queued.add(statsKey(ref))
			queue.push(ref)
		},
		drain,
		stop() {
			isStopped = true
			queue.length = 0
		},
	}
}

export async function startListStats() {
	const [stats, conflicts]: [StatsCache, ConflictsCache] = await Promise.all([
		readStatsCache(),
		readConflictsCache(),
	])
	// Signed out GitHub serves no merge box, so a signed-out list asks for nothing.
	let canAskConflicts = isSignedIn()
	// Pull requests GitHub answered "unknown" for: when to ask again, forever once asked twice.
	// Retry deadlines use the timer's monotonic clock, so a wall clock change cannot strand a row.
	const unknownUntil = new Map<string, number>()
	let refusals = 0
	const statsPool = createPool(loadStats)
	const conflictsPool = createPool(loadConflicts)
	let isStopped = false
	const timers = new Set<ReturnType<typeof setTimeout>>()

	// Every pass walks the rows on the page: rows React re-rendered get their stats back, new rows
	// (pagination, a changed filter) get theirs, and stale or missing ones are queued once.
	function apply() {
		const now = Date.now()
		const rows = findPullRows()
		const keys = new Set(rows.map(statsKey))
		statsPool.retain(keys)
		conflictsPool.retain(keys)
		for (const row of rows) {
			const key = statsKey(row)
			const ref = { owner: row.owner, repo: row.repo, number: row.number }
			const entry = stats[key]
			if (entry && !('failed' in entry)) renderStats(row.meta, key, entry)
			else clearStats(row.meta)
			if (!isFresh(entry) && !statsPool.has(key)) statsPool.push(ref)

			// A stale state is as good as unknown: the base may have moved since.
			const conflict = conflicts[key]
			const isConflictFresh = isFresh(conflict, now, CONFLICTS_TTL_MILLISECONDS)
			if (row.isOpen && isConflictFresh && conflict && conflict.state !== 'clean')
				renderConflicts(row.meta, conflict.state)
			else clearConflicts(row.meta)
			if (
				canAskConflicts &&
				row.isOpen &&
				!isConflictFresh &&
				performance.now() >= (unknownUntil.get(key) ?? 0) &&
				!conflictsPool.has(key)
			)
				conflictsPool.push(ref)
		}
		statsPool.drain()
		conflictsPool.drain()
	}

	async function loadStats(ref: Ref) {
		const key = statsKey(ref)
		let entry: StatsEntry
		try {
			entry = { ...diffStats(await requestPullRequestDiff(ref)), at: Date.now() }
		} catch (error) {
			console.warn('[detent] diff stats', key, error)
			entry = { failed: true, at: Date.now() }
		}
		stats[key] = entry
		await writeStatsEntry(key, entry).catch((error: unknown) => console.warn('[detent]', error))
		if (!isStopped) apply()
	}

	async function loadConflicts(ref: Ref) {
		const key = statsKey(ref)
		let state: ConflictState
		try {
			state = await fetchConflictState(ref)
			refusals = 0
		} catch (error) {
			// A 401, or refusals in a row, means signed out in another tab; one 403 or 404 may be a rate
			// limit or a single pull request, so that row only waits for its retry.
			if (error instanceof MergeBoxUnavailableError) {
				refusals += 1
				if (error.status === 401 || refusals >= MAX_REFUSALS) {
					canAskConflicts = false
					conflictsPool.stop()
					return
				}
			} else console.warn('[detent] merge conflicts', key, error)
			state = 'unknown'
		}
		if (state === 'unknown') {
			rememberUnknown(key)
			return
		}

		unknownUntil.delete(key)
		const entry: ConflictsEntry = { state, at: Date.now() }
		conflicts[key] = entry
		await writeConflictsEntry(key, entry).catch((error: unknown) => console.warn('[detent]', error))
		if (!isStopped) apply()
	}

	// Never cached: the row stays bare, asked once more after a while, then left alone on this page.
	function rememberUnknown(key: string) {
		if (unknownUntil.has(key)) {
			unknownUntil.set(key, Number.POSITIVE_INFINITY)
			return
		}

		unknownUntil.set(key, performance.now() + UNKNOWN_RETRY_MILLISECONDS)
		const timer = setTimeout(() => {
			timers.delete(timer)
			if (!isStopped) apply()
		}, UNKNOWN_RETRY_MILLISECONDS)
		timers.add(timer)
	}

	let stop: (() => void) | undefined

	return {
		mount() {
			apply()
			stop = observeMutations(document.body, [], apply)
		},
		remove() {
			isStopped = true
			statsPool.stop()
			conflictsPool.stop()
			for (const timer of timers) clearTimeout(timer)
			stop?.()
			stop = undefined
			clearAllStats()
		},
	}
}
