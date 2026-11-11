import { browser } from 'wxt/browser'
import { type FetchDiffResponse, PullRequestDiffError } from '../diff/fetch-diff'
import type { DiffStats } from '../list/stats'
import type { PullRequestLocation } from '../pull-request-url'

export const FETCH_DIFF_STATS_MESSAGE = 'detent:fetch-diff-stats'

export interface FetchDiffStatsRequest
	extends Pick<PullRequestLocation, 'owner' | 'repo' | 'number'> {
	type: typeof FETCH_DIFF_STATS_MESSAGE
}

export type FetchDiffStatsResponse =
	| { stats: DiffStats }
	| Exclude<FetchDiffResponse, { text: string }>

/**
 * The pull request's line counts, counted in the service worker: the diff goes through the list queue there and only
 * the counts come back, so a large diff never crosses into the page or holds up its thread. Throws PullRequestDiffError
 * like requestPullRequestDiff.
 */
export async function requestDiffStats({
	owner,
	repo,
	number,
}: Pick<PullRequestLocation, 'owner' | 'repo' | 'number'>): Promise<DiffStats> {
	const request: FetchDiffStatsRequest = { type: FETCH_DIFF_STATS_MESSAGE, owner, repo, number }
	const response = (await browser.runtime.sendMessage(request)) as
		| FetchDiffStatsResponse
		| undefined
	if (response && 'stats' in response) return response.stats

	throw new PullRequestDiffError(
		response?.status ?? 0,
		response?.rateLimit,
		response?.isPaused === true,
	)
}
