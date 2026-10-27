import { browser } from 'wxt/browser'
import type { PullRequestLocation } from '../pull-request-url'

export const FETCH_DIFF_MESSAGE = 'detent:fetch-diff'

type PullRequestRef = Pick<PullRequestLocation, 'owner' | 'repo' | 'number'>

export interface FetchDiffRequest extends PullRequestRef {
	type: typeof FETCH_DIFF_MESSAGE
}

export type FetchDiffResponse = { text: string } | { status: number }

export class PullRequestDiffError extends Error {
	constructor(readonly status: number) {
		super(`GitHub returned ${status} for the pull request diff`)
		this.name = 'PullRequestDiffError'
	}
}

const RETRIES = 6
const RETRY_MILLISECONDS = 1500
const RETRY_CAP_MILLISECONDS = 20_000

// GitHub answers 5xx while it is still generating the diff of a large pull request, which can take
// tens of seconds; the retries back off exponentially to about a minute in total.
export async function fetchPullRequestDiff({
	owner,
	repo,
	number,
}: PullRequestRef): Promise<string> {
	let status = 0
	for (let attempt = 0; attempt < RETRIES; attempt += 1) {
		if (attempt > 0)
			await new Promise((resolve) =>
				setTimeout(
					resolve,
					Math.min(RETRY_CAP_MILLISECONDS, RETRY_MILLISECONDS * 2 ** (attempt - 1)),
				),
			)
		const response = await fetch(`https://github.com/${owner}/${repo}/pull/${number}.diff`, {
			credentials: 'include',
		})
		if (response.ok) return response.text()

		status = response.status
		if (status < 500) break
	}

	throw new PullRequestDiffError(status)
}

// The diff endpoint redirects to a host without CORS headers, so the page-origin content script cannot fetch it itself.
export async function requestPullRequestDiff({
	owner,
	repo,
	number,
}: PullRequestRef): Promise<string> {
	const request: FetchDiffRequest = { type: FETCH_DIFF_MESSAGE, owner, repo, number }
	const response = (await browser.runtime.sendMessage(request)) as FetchDiffResponse | undefined
	if (response && 'text' in response) return response.text

	throw new PullRequestDiffError(response?.status ?? 0)
}
