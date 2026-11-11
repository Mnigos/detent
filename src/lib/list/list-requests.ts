import { fetchPullRequestDiff } from '../diff/fetch-diff'
import { RequestPausedError } from '../rate-limit'
import { statsKey } from './cache'
import { fetchConflictState } from './conflicts'
import { fetchListHeads } from './heads'
import { isRateLimitPaused } from './rate-limit'
import { createRequestQueue, type Send } from './request-queue'

type PullRequestRef = { owner: string; repo: string; number: number }

/**
 * The service worker's list requests: diffs, merge boxes and list data of every tab go through one queue, and a
 * request another tab is already waiting for is not sent twice. A request whose turn comes while any tab has paused
 * the lists for a rate limit is not sent; it rejects with RequestPausedError and the list asks again after the pause.
 */
export function createListRequests(queue = createRequestQueue()) {
	const send: Send = (url, init) =>
		queue.run(async () => {
			if (await isRateLimitPaused()) throw new RequestPausedError()

			return fetch(url, init)
		})

	return {
		diff: (ref: PullRequestRef) =>
			queue.shared(`diff:${statsKey(ref)}`, () => fetchPullRequestDiff(ref, send)),
		conflicts: (ref: PullRequestRef) =>
			queue.shared(`conflicts:${statsKey(ref)}`, () => fetchConflictState(ref, send)),
		heads: (url: string) => queue.shared(`heads:${url}`, () => fetchListHeads(url, send)),
	}
}
