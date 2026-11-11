import { readHeadSha } from '../header/header-dom'
import { type PullRequestLocation, pullRequestScope } from '../pull-request-url'
import { requestPullRequestDiff } from './fetch-diff'

/** How long the open pull request's diff stays available to the header after it arrived. */
export const PAGE_DIFF_REUSE_MILLISECONDS = 60_000

// `headSha`: the head commit the page showed when the diff was asked for, if it said.
let recent:
	| { scope: string; headSha?: string; promise: Promise<string>; settledAt?: number }
	| undefined

/** The open pull request's diff for the layers, kept so the header can count it instead of downloading it again. */
export function requestPageDiff(location: PullRequestLocation): Promise<string> {
	const promise = requestPullRequestDiff(location)
	const headSha = readHeadSha(location)
	const entry: NonNullable<typeof recent> = {
		scope: pullRequestScope(location),
		...(headSha ? { headSha } : {}),
		promise,
	}
	recent = entry
	promise
		.then(
			() => {
				entry.settledAt = Date.now()
			},
			() => {
				if (recent === entry) recent = undefined
			},
		)
		.catch(() => undefined)

	return promise
}

/**
 * The diff the layers asked for this pull request at this head commit (or neither knowing it): still loading, or
 * arrived within the last minute.
 */
export function recentPageDiff(
	location: Pick<PullRequestLocation, 'owner' | 'repo' | 'number'>,
	headSha: string | undefined,
	now = Date.now(),
): Promise<string> | undefined {
	if (!recent || recent.scope !== pullRequestScope(location) || recent.headSha !== headSha)
		return undefined
	if (recent.settledAt !== undefined && now - recent.settledAt >= PAGE_DIFF_REUSE_MILLISECONDS)
		return undefined

	return recent.promise
}

export function forgetPageDiff(): void {
	recent = undefined
}
