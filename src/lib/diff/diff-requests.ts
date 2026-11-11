import { statsKey } from '../list/cache'
import { fetchPullRequestDiff } from './fetch-diff'

type PullRequestRef = { owner: string; repo: string; number: number }

/**
 * The service worker's diff downloads, one per pull request at a time. `page` is the open pull request's own diff for
 * the layers, sent at once; `queued` goes through the list queue and honours its rate limit pause (the list rows and
 * the pull request header). Either joins a download of the other already running for the same pull request; a page
 * request whose queued download was held back or failed sends its own.
 */
export function createDiffRequests(queued: (ref: PullRequestRef) => Promise<string>) {
	const pages = new Map<string, Promise<string>>()
	const lists = new Map<string, Promise<string>>()

	function track(map: Map<string, Promise<string>>, key: string, promise: Promise<string>) {
		map.set(key, promise)
		promise
			.finally(() => {
				if (map.get(key) === promise) map.delete(key)
			})
			.catch(() => undefined)

		return promise
	}

	return {
		page(ref: PullRequestRef) {
			const key = statsKey(ref)
			const running = pages.get(key)
			if (running) return running
			const listed = lists.get(key)

			return track(
				pages,
				key,
				listed ? listed.catch(() => fetchPullRequestDiff(ref)) : fetchPullRequestDiff(ref),
			)
		},
		queued(ref: PullRequestRef) {
			const key = statsKey(ref)

			return pages.get(key) ?? lists.get(key) ?? track(lists, key, queued(ref))
		},
	}
}
