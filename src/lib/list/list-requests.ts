import { fetchPullRequestDiff } from '../diff/fetch-diff'
import { RequestPausedError } from '../rate-limit'
import { statsKey } from './cache'
import { fetchConflictState } from './conflicts'
import { fetchListHeads } from './heads'
import { isRateLimitPaused } from './rate-limit'
import { createRequestQueue, type Send } from './request-queue'

type PullRequestRef = { owner: string; repo: string; number: number }

// Statuses whose Response cannot carry a body.
const NULL_BODY = new Set([101, 204, 205, 304])

/**
 * The service worker's list requests: diffs, merge boxes and list data of every tab go through one queue, and a
 * request another tab is already waiting for is not sent twice. A request whose turn comes while any tab has paused
 * the lists for a rate limit is not sent; it rejects with RequestPausedError and the list asks again after the pause.
 */
export function createListRequests(queue = createRequestQueue()) {
	// The body is read inside the slot, so a large diff still downloading counts against the three.
	const send: Send = (url, init) =>
		queue.run(async () => {
			if (await isRateLimitPaused()) throw new RequestPausedError()

			const response = await fetch(url, init)
			const body = NULL_BODY.has(response.status) ? null : await response.arrayBuffer()

			return new Response(body, {
				status: response.status,
				statusText: response.statusText,
				headers: response.headers,
			})
		})

	return {
		diff: (ref: PullRequestRef) =>
			queue.shared(`diff:${statsKey(ref)}`, () => fetchPullRequestDiff(ref, send)),
		conflicts: (ref: PullRequestRef) =>
			queue.shared(`conflicts:${statsKey(ref)}`, () => fetchConflictState(ref, send)),
		heads: (url: string) => queue.shared(`heads:${url}`, () => fetchListHeads(url, send)),
	}
}
