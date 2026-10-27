import { requestPullRequestDiff } from '@/src/lib/diff/fetch-diff'
import {
	isFresh,
	readStatsCache,
	type StatsCache,
	type StatsEntry,
	statsKey,
	writeStatsEntry,
} from '@/src/lib/list/cache'
import { clearAllStats, clearStats, findPullRows, renderStats } from '@/src/lib/list/rows'
import { diffStats } from '@/src/lib/list/stats'
import { observeMutations } from '@/src/lib/panel/github-dom'

const CONCURRENCY = 3

type Ref = { owner: string; repo: string; number: number }

export async function startListStats() {
	const cache: StatsCache = await readStatsCache()
	const queue: Ref[] = []
	const queued = new Set<string>()
	let active = 0
	let isStopped = false

	// Every pass walks the rows on the page: rows React re-rendered get their stats back, new rows
	// (pagination, a changed filter) get theirs, and stale or missing ones are queued once.
	function apply() {
		for (const row of findPullRows()) {
			const key = statsKey(row)
			const entry = cache[key]
			if (entry && !('failed' in entry)) renderStats(row.meta, key, entry)
			else clearStats(row.meta)
			if (isFresh(entry) || queued.has(key)) continue

			queued.add(key)
			queue.push({ owner: row.owner, repo: row.repo, number: row.number })
		}
		drain()
	}

	function drain() {
		while (!isStopped && active < CONCURRENCY && queue.length > 0) {
			const ref = queue.shift() as Ref
			active += 1
			void load(ref).finally(() => {
				active -= 1
				drain()
			})
		}
	}

	async function load(ref: Ref) {
		const key = statsKey(ref)
		let entry: StatsEntry
		try {
			entry = { ...diffStats(await requestPullRequestDiff(ref)), at: Date.now() }
		} catch (error) {
			console.warn('[detent] diff stats', key, error)
			entry = { failed: true, at: Date.now() }
		}
		queued.delete(key)
		cache[key] = entry
		await writeStatsEntry(key, entry).catch((error: unknown) => console.warn('[detent]', error))
		if (!isStopped) apply()
	}

	let stop: (() => void) | undefined

	return {
		mount() {
			apply()
			stop = observeMutations(document.body, [], apply)
		},
		remove() {
			isStopped = true
			queue.length = 0
			stop?.()
			stop = undefined
			clearAllStats()
		},
	}
}
