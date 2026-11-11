import { PullRequestDiffError } from '@/src/lib/diff/fetch-diff'
import { recentPageDiff } from '@/src/lib/diff/page-diff'
import { requestDiffStats } from '@/src/lib/header/fetch-stats'
import { clearHeaderCode, readHeadSha, renderHeaderCode } from '@/src/lib/header/header-dom'
import {
	isStatsFresh,
	readStatsCache,
	type StatsEntry,
	statsKey,
	writeStatsEntry,
} from '@/src/lib/list/cache'
import { createRateLimitPause } from '@/src/lib/list/rate-limit'
import { type DiffStats, diffStats } from '@/src/lib/list/stats'
import { observeMutations } from '@/src/lib/panel/github-dom'
import type { PullRequestLocation } from '@/src/lib/pull-request-url'

const IDLE_TIMEOUT_MILLISECONDS = 2000

// Counting waits until the page has settled, so the header never competes with GitHub's own rendering.
function whenIdle(): { promise: Promise<void>; cancel: () => void } {
	let cancel = () => {}
	const promise = new Promise<void>((resolve) => {
		if (typeof requestIdleCallback === 'function') {
			const handle = requestIdleCallback(() => resolve(), { timeout: IDLE_TIMEOUT_MILLISECONDS })
			cancel = () => cancelIdleCallback(handle)
		} else {
			const handle = setTimeout(resolve, 0)
			cancel = () => clearTimeout(handle)
		}
	})

	return { promise, cancel }
}

/**
 * Shows the pull request's lines of code next to GitHub's diffstat in the header, on every tab of the pull request.
 * The counts come, in this order, from the list's stats cache when they were counted for the head commit the page
 * shows; from the diff the layers already downloaded; or from the service worker, which downloads the diff through
 * the list queue and returns only the counts. They are stored in the same cache, so the list reuses them too.
 */
export async function startHeaderStats(location: PullRequestLocation) {
	const key = statsKey(location)
	let resume = () => {}
	const [cache, pause] = await Promise.all([readStatsCache(), createRateLimitPause(() => resume())])
	const headSha = readHeadSha(location)
	const cached = cache[key]
	const isCached = isStatsFresh(cached, headSha)
	let stats: DiffStats | undefined =
		isCached && cached && !('failed' in cached) ? cached : undefined
	let isDone = isCached
	let isLoading = false
	let isStopped = false
	let stop: (() => void) | undefined
	const idle = new Set<() => void>()

	const apply = () => {
		if (!isStopped) renderHeaderCode(location, key, stats)
	}

	async function afterIdle() {
		const { promise, cancel } = whenIdle()
		idle.add(cancel)
		await promise
		idle.delete(cancel)
	}

	async function count(): Promise<DiffStats> {
		const page = recentPageDiff(location)
		if (page) {
			const text = await page.catch(() => undefined)
			if (text !== undefined) {
				await afterIdle()
				return diffStats(text)
			}
		}

		return requestDiffStats(location)
	}

	async function load() {
		if (isDone || isLoading || isStopped || pause.isPaused()) return

		isLoading = true
		const head = headSha ? { headSha } : {}
		let entry: StatsEntry
		try {
			await afterIdle()
			if (isStopped) return
			entry = { ...(await count()), at: Date.now(), ...head }
		} catch (error) {
			// Held back by the pause, or rate-limited: nothing is cached and the pause's end loads again.
			if (error instanceof PullRequestDiffError && error.isPaused) return
			if (
				error instanceof PullRequestDiffError &&
				(error.rateLimit || (error.status === 0 && pause.isThrottled()))
			) {
				pause.signal(error.rateLimit?.retryAfterMilliseconds, !error.rateLimit)
				return
			}

			console.warn('[detent] header diff stats', key, error)
			entry = { failed: true, at: Date.now(), ...head }
		} finally {
			isLoading = false
		}
		if (isStopped) return

		isDone = true
		if (!('failed' in entry)) stats = entry
		apply()
		await writeStatsEntry(key, entry).catch((error: unknown) => console.warn('[detent]', error))
	}

	resume = () => void load()

	return {
		mount() {
			apply()
			// React re-renders and GitHub's tab switches replace the header; the next frame puts the numbers back.
			stop = observeMutations(document.body, [], apply)
			void load()
		},
		remove() {
			isStopped = true
			pause.stop()
			for (const cancel of idle) cancel()
			idle.clear()
			stop?.()
			stop = undefined
			clearHeaderCode()
		},
	}
}
