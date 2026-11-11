import { browser } from 'wxt/browser'
import type { Send } from '../list/request-queue'
import type { PullRequestLocation } from '../pull-request-url'
import { type RateLimit, RequestPausedError, readRateLimit } from '../rate-limit'

export const FETCH_DIFF_MESSAGE = 'detent:fetch-diff'

type PullRequestRef = Pick<PullRequestLocation, 'owner' | 'repo' | 'number'>

/**
 * `isList`: a pull request list asks, so the service worker sends it through the shared list queue, which holds it
 * back while the lists are paused for a rate limit.
 */
export interface FetchDiffRequest extends PullRequestRef {
	type: typeof FETCH_DIFF_MESSAGE
	isList?: boolean
}

export type FetchDiffResponse =
	| { text: string }
	| { status: number; rateLimit?: RateLimit; isPaused?: boolean }

/**
 * `rateLimit` is set when GitHub rate-limited the request rather than refused the pull request; `isPaused` when a
 * list's retry was held back by the rate limit pause.
 */
export class PullRequestDiffError extends Error {
	constructor(
		readonly status: number,
		readonly rateLimit?: RateLimit,
		readonly isPaused = false,
	) {
		super(`GitHub returned ${status} for the pull request diff`)
		this.name = 'PullRequestDiffError'
	}
}

const RETRIES = 6
const RETRY_MILLISECONDS = 1500
const RETRY_CAP_MILLISECONDS = 20_000

// GitHub answers 5xx while it is still generating the diff of a large pull request, which can take
// tens of seconds; the retries back off exponentially to about a minute in total. `send` is fetch, or the list
// queue's, which throws RequestPausedError instead of sending while the lists are paused.
export async function fetchPullRequestDiff(
	{ owner, repo, number }: PullRequestRef,
	send: Send = fetch,
): Promise<string> {
	let status = 0
	for (let attempt = 0; attempt < RETRIES; attempt += 1) {
		if (attempt > 0)
			await new Promise((resolve) =>
				setTimeout(
					resolve,
					Math.min(RETRY_CAP_MILLISECONDS, RETRY_MILLISECONDS * 2 ** (attempt - 1)),
				),
			)
		let response: Response
		try {
			response = await send(`https://github.com/${owner}/${repo}/pull/${number}.diff`, {
				credentials: 'include',
			})
		} catch (error) {
			// While GitHub rate-limits the lists, a list's request would only add to it; the list asks again after the pause.
			if (error instanceof RequestPausedError)
				throw new PullRequestDiffError(status, undefined, true)
			throw error
		}
		if (response.ok) return response.text()

		const rateLimit = await readRateLimit(response)
		if (rateLimit) throw new PullRequestDiffError(response.status, rateLimit)
		status = response.status
		if (status < 500) break
	}

	throw new PullRequestDiffError(status)
}

// The diff endpoint redirects to a host without CORS headers, so the page-origin content script cannot fetch it itself.
export async function requestPullRequestDiff(
	{ owner, repo, number }: PullRequestRef,
	{ isList = false } = {},
): Promise<string> {
	const request: FetchDiffRequest = {
		type: FETCH_DIFF_MESSAGE,
		owner,
		repo,
		number,
		...(isList ? { isList } : {}),
	}
	const response = (await browser.runtime.sendMessage(request)) as FetchDiffResponse | undefined
	if (response && 'text' in response) return response.text

	throw new PullRequestDiffError(
		response?.status ?? 0,
		response?.rateLimit,
		response?.isPaused === true,
	)
}
