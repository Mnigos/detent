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
import { type PullRequestLocation, parsePullRequestUrl } from '@/src/lib/pull-request-url'

const IDLE_TIMEOUT_MILLISECONDS = 2000
/** How soon a download held back for a pause this tab did not see is asked again. */
const HELD_RETRY_MILLISECONDS = 1000

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
	let headSha = readHeadSha(location)
	// The counts, or a failure, for the head commit the page shows; undefined while they are still to load.
	let entry: StatsEntry | undefined = isStatsFresh(cache[key], headSha) ? cache[key] : undefined
	let isLoading = false
	let isStopped = false
	let stop: (() => void) | undefined
	const idle = new Set<() => void>()
	const timers = new Set<ReturnType<typeof setTimeout>>()

	// What the head commit is read from: the URL (its tab), GitHub's embedded page data and the classic page's partial
	// URLs. Comparing them is cheap; the head is read again only when one of them changed.
	const headSources = () => [
		window.location.href,
		document.querySelector('[data-url*="end_commit_oid="]')?.getAttribute('data-url'),
		...document.querySelectorAll('script[data-target$=".embeddedData"]'),
	]
	let sources: unknown[] = headSources()

	// A tab switch or newly rendered page data may show another head commit, or the page may no longer say which (the
	// ten-minute rule then applies); a remembered failure that ran out is tried again too.
	function revalidate() {
		const next = headSources()
		if (next.length === sources.length && next.every((source, index) => source === sources[index]))
			return

		sources = next
		const current = parsePullRequestUrl(window.location.href)
		const head = readHeadSha(current ? { ...location, tab: current.tab } : location)
		if (head !== headSha) {
			headSha = head
			// Counts of another head commit are not shown.
			if (entry?.headSha && head && entry.headSha !== head) entry = undefined
		}
		if (!isStatsFresh(entry, headSha)) void load()
	}

	const apply = () => {
		if (isStopped) return

		revalidate()
		renderHeaderCode(location, key, entry && !('failed' in entry) ? entry : undefined)
	}

	async function afterIdle() {
		const { promise, cancel } = whenIdle()
		idle.add(cancel)
		await promise
		idle.delete(cancel)
	}

	async function count(head: string | undefined): Promise<DiffStats> {
		const page = recentPageDiff(location, head)
		if (page) {
			const text = await page.catch(() => undefined)
			if (text !== undefined) {
				await afterIdle()
				return diffStats(text)
			}
		}

		return requestDiffStats(location)
	}

	function retryLater() {
		const timer = setTimeout(() => {
			timers.delete(timer)
			void load()
		}, HELD_RETRY_MILLISECONDS)
		timers.add(timer)
	}

	async function load() {
		if (isLoading || isStopped || pause.isPaused() || isStatsFresh(entry, headSha)) return

		isLoading = true
		const requested = headSha
		const head = requested ? { headSha: requested } : {}
		let next: StatsEntry
		try {
			await afterIdle()
			if (isStopped) return
			next = { ...(await count(requested)), at: Date.now(), ...head }
		} catch (error) {
			// Held back by a pause: the pause's end loads again, or, when this tab saw no pause (another tab's, or one
			// that ended meanwhile), a retry in a second. A rate limit pauses the lists; nothing is cached either way.
			if (error instanceof PullRequestDiffError && error.isPaused) {
				if (!pause.isPaused()) retryLater()
				return
			}
			if (
				error instanceof PullRequestDiffError &&
				(error.rateLimit || (error.status === 0 && pause.isThrottled()))
			) {
				pause.signal(error.rateLimit?.retryAfterMilliseconds, !error.rateLimit)
				return
			}

			console.warn('[detent] header diff stats', key, error)
			next = { failed: true, at: Date.now(), ...head }
		} finally {
			isLoading = false
		}
		if (isStopped) return
		// The page moved to a newer head commit while these counts loaded: they are stored, not shown.
		if (requested === headSha) {
			entry = next
			apply()
		}
		await writeStatsEntry(key, next).catch((error: unknown) => console.warn('[detent]', error))
		if (requested !== headSha) void load()
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
			for (const timer of timers) clearTimeout(timer)
			timers.clear()
			stop?.()
			stop = undefined
			clearHeaderCode()
		},
	}
}
