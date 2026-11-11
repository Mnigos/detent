import { PullRequestDiffError, requestPullRequestDiff } from '@/src/lib/diff/fetch-diff'
import {
	type ConflictsCache,
	type ConflictsEntry,
	isConflictFresh,
	isStatsFresh,
	readConflictsCache,
	readStatsCache,
	type StatsCache,
	type StatsEntry,
	statsKey,
	writeConflictsEntry,
	writeStatsEntry,
} from '@/src/lib/list/cache'
import {
	isSignedIn,
	type MergeBoxState,
	MergeBoxUnavailableError,
	requestConflictState,
} from '@/src/lib/list/conflicts'
import {
	HEADS_TTL_MILLISECONDS,
	headKey,
	readEmbeddedHeads,
	requestListHeads,
} from '@/src/lib/list/heads'
import { createRateLimitPause } from '@/src/lib/list/rate-limit'
import {
	clearAllStats,
	clearConflicts,
	clearStats,
	clearUnresolved,
	findPullRows,
	type PullRow,
	renderConflicts,
	renderStats,
	renderUnresolved,
} from '@/src/lib/list/rows'
import { diffStats } from '@/src/lib/list/stats'
import { watchViewport } from '@/src/lib/list/viewport'
import { observeMutations } from '@/src/lib/panel/github-dom'
import { RateLimitError, RequestPausedError } from '@/src/lib/rate-limit'

const CONCURRENCY = 3
// GitHub starts computing an unknown merge state on the first request; one later ask usually gets it.
const UNKNOWN_RETRY_MILLISECONDS = 15_000
const MAX_REFUSALS = 3
const HELD_RETRY_MILLISECONDS = 1000

/** A row to load; `headSha` is the head commit the list showed when it was queued, if known. */
type Ref = { owner: string; repo: string; number: number; headSha?: string }

/**
 * Runs at most `CONCURRENCY` loads at once and queues each key once until its load settles. While `isPaused`, queued
 * loads wait and nothing new starts.
 */
function createPool(load: (ref: Ref) => Promise<void>, isPaused: () => boolean) {
	const queue: Ref[] = []
	const queued = new Set<string>()
	let active = 0
	let isStopped = false

	function drain() {
		while (!isStopped && !isPaused() && active < CONCURRENCY && queue.length > 0) {
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
	// A pause that ends while the caches load resumes nothing: mount() applies with the pause already over.
	let resume = () => {}
	const [stats, conflicts, pause]: [
		StatsCache,
		ConflictsCache,
		Awaited<ReturnType<typeof createRateLimitPause>>,
	] = await Promise.all([
		readStatsCache(),
		readConflictsCache(),
		// After a rate limit, in this tab or another, the rows still missing data are asked again.
		createRateLimitPause(() => resume()),
	])
	// Signed out GitHub serves no merge box, so a signed-out list asks for nothing.
	let canAskConflicts = isSignedIn()
	// Pull requests GitHub answered "unknown" for: when to ask again, forever once asked twice.
	// Retry deadlines use the timer's monotonic clock, so a wall clock change cannot strand a row.
	const unknownUntil = new Map<string, number>()
	let refusals = 0
	const statsPool = createPool(loadStats, () => pause.isPaused())
	const conflictsPool = createPool(loadConflicts, () => pause.isPaused())
	let isStopped = false
	const timers = new Set<ReturnType<typeof setTimeout>>()
	resume = () => {
		if (!isStopped) apply()
	}

	// Head commits from the list data GitHub embedded in the page, joined by the data asked for after navigations.
	const heads = readEmbeddedHeads()
	// List URL → when its data was last asked for, so a page whose data does not help is asked at most every 10 min.
	const headsAskedAt = new Map<string, number>()
	let isAskingHeads = false
	const viewport = watchViewport(() => {
		if (!isStopped) apply()
	})

	const headOf = (row: PullRow, now: number) => {
		const head = heads.get(headKey(row))

		return head && now - head.at < HEADS_TTL_MILLISECONDS ? head.headSha : undefined
	}

	// Every pass walks the rows on the page: rows React re-rendered get their stats back, new rows
	// (pagination, a changed filter) get theirs, and stale or missing ones near the viewport are queued once, in the
	// order they appear. Cached data shows on every row, wherever it is.
	function apply() {
		const now = Date.now()
		const rows = findPullRows()
		viewport.watch(rows.map((row) => row.item))
		const near = rows.filter((row) => viewport.isNear(row.item))
		const nearKeys = new Set(near.map(statsKey))
		statsPool.retain(nearKeys)
		conflictsPool.retain(nearKeys)
		// Rows without a known head commit wait while the list data is asked for, so they need not fall back on
		// the short cache time.
		const isWaitingForHeads = askHeads(near, now)
		for (const row of rows) {
			const key = statsKey(row)
			const headSha = headOf(row, now)
			const ref: Ref = { owner: row.owner, repo: row.repo, number: row.number, headSha }
			const canAsk = nearKeys.has(key) && (headSha !== undefined || !isWaitingForHeads)
			const entry = stats[key]
			if (entry && !('failed' in entry)) renderStats(row.meta, key, entry)
			else clearStats(row.meta)
			if (canAsk && !isStatsFresh(entry, headSha, now) && !statsPool.has(key)) statsPool.push(ref)

			// A stale state is as good as unknown: the base may have moved since. Drafts are not ready to merge.
			const conflict = conflicts[key]
			const isOpen = row.isOpen && !row.isDraft
			const isFresh = isConflictFresh(conflict, headSha, now)
			if (isOpen && isFresh && conflict && conflict.state !== 'clean')
				renderConflicts(row.meta, conflict.state)
			else clearConflicts(row.meta)
			if (isOpen && isFresh && conflict?.unresolved) renderUnresolved(row.meta)
			else clearUnresolved(row.meta)
			if (
				canAskConflicts &&
				canAsk &&
				isOpen &&
				!isFresh &&
				performance.now() >= (unknownUntil.get(key) ?? 0) &&
				!conflictsPool.has(key)
			)
				conflictsPool.push(ref)
		}
		statsPool.drain()
		conflictsPool.drain()
	}

	// Asks once for the list data of the page when rows near the viewport have no known head commit, as after
	// GitHub's own navigation to another filter or page. Returns whether such a request is running.
	function askHeads(near: PullRow[], now: number) {
		if (isAskingHeads) return true
		if (near.every((row) => headOf(row, now) !== undefined)) return false
		// Nothing goes out during a pause; the rows wait for its end, which applies again.
		if (pause.isPaused()) return true
		const url = window.location.href.split('#')[0] as string
		if (now - (headsAskedAt.get(url) ?? Number.NEGATIVE_INFINITY) < HEADS_TTL_MILLISECONDS)
			return false

		headsAskedAt.set(url, now)
		isAskingHeads = true
		let isHeld = false
		requestListHeads(url)
			.then((fetched) => {
				for (const [key, head] of fetched) heads.set(key, head)
			})
			.catch((error: unknown) => {
				// Neither held back nor rate-limited data says anything: the resume asks again. A request held back
				// for another tab's pause does not apply at once, which would only ask again before this tab adopts it.
				if (error instanceof RequestPausedError) {
					headsAskedAt.delete(url)
					isHeld = true
				} else if (error instanceof RateLimitError) {
					headsAskedAt.delete(url)
					rateLimited(error.retryAfterMilliseconds)
				} else if (error instanceof TypeError && pause.isThrottled()) {
					headsAskedAt.delete(url)
					rateLimited(undefined, true)
				} else console.warn('[detent] list data', error)
			})
			.finally(() => {
				isAskingHeads = false
				if (isStopped) return
				if (!isHeld) return apply()
				// Held for another tab's pause this tab may not have adopted yet, or for one that ended after the worker
				// checked it: a paused tab applies again on resume, any other one tries again in a second.
				if (pause.isPaused()) return
				const timer = setTimeout(() => {
					timers.delete(timer)
					if (!isStopped) apply()
				}, HELD_RETRY_MILLISECONDS)
				timers.add(timer)
			})

		return true
	}

	async function loadStats(ref: Ref) {
		const key = statsKey(ref)
		const head = ref.headSha ? { headSha: ref.headSha } : {}
		let entry: StatsEntry
		try {
			entry = {
				...diffStats(await requestPullRequestDiff(ref, { isList: true })),
				at: Date.now(),
				...head,
			}
		} catch (error) {
			// Held back by the pause: the resume asks again.
			if (error instanceof PullRequestDiffError && error.isPaused) return
			// A rate limit says nothing about the pull request: nothing is cached and the row waits for the resume.
			// The service worker reports a network error as status 0, which during a limit is the limit.
			if (
				error instanceof PullRequestDiffError &&
				(error.rateLimit || (error.status === 0 && pause.isThrottled()))
			)
				return rateLimited(error.rateLimit?.retryAfterMilliseconds, !error.rateLimit)

			console.warn('[detent] diff stats', key, error)
			entry = { failed: true, at: Date.now(), ...head }
		}
		stats[key] = entry
		await writeStatsEntry(key, entry).catch((error: unknown) => console.warn('[detent]', error))
		if (!isStopped) apply()
	}

	async function loadConflicts(ref: Ref) {
		const key = statsKey(ref)
		let result: MergeBoxState
		try {
			result = await requestConflictState(ref)
			refusals = 0
		} catch (error) {
			if (error instanceof RequestPausedError) return
			// GitHub's 429 may come without CORS headers, so the service worker sees only a network error.
			if (error instanceof RateLimitError) return rateLimited(error.retryAfterMilliseconds)
			if (error instanceof TypeError && pause.isThrottled()) return rateLimited(undefined, true)
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
			result = { state: 'unknown', unresolved: false }
		}
		const { state, unresolved } = result
		if (state === 'unknown') {
			rememberUnknown(key)
			return
		}

		unknownUntil.delete(key)
		const entry: ConflictsEntry = {
			state,
			...(unresolved ? { unresolved } : {}),
			at: Date.now(),
			...(ref.headSha ? { headSha: ref.headSha } : {}),
		}
		conflicts[key] = entry
		await writeConflictsEntry(key, entry).catch((error: unknown) => console.warn('[detent]', error))
		if (!isStopped) apply()
	}

	// Neither pool sends anything until the pause is over; the pause then applies again, which queues only the rows
	// still without fresh data.
	function rateLimited(retryAfterMilliseconds?: number, isInferred = false) {
		const length = pause.signal(retryAfterMilliseconds, isInferred)
		if (length !== undefined)
			console.info(
				`[detent] GitHub rate limit, list requests pause for ${Math.ceil(length / 1000)} s`,
			)
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
			pause.stop()
			viewport.stop()
			for (const timer of timers) clearTimeout(timer)
			stop?.()
			stop = undefined
			clearAllStats()
		},
	}
}
