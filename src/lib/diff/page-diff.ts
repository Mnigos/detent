import { type PullRequestLocation, pullRequestScope } from '../pull-request-url'
import { requestPullRequestDiff } from './fetch-diff'

/** How long the open pull request's diff stays available to the header after it arrived. */
export const PAGE_DIFF_REUSE_MILLISECONDS = 60_000

let recent: { scope: string; promise: Promise<string>; settledAt?: number } | undefined

/** The open pull request's diff for the layers, kept so the header can count it instead of downloading it again. */
export function requestPageDiff(location: PullRequestLocation): Promise<string> {
	const promise = requestPullRequestDiff(location)
	const entry: NonNullable<typeof recent> = { scope: pullRequestScope(location), promise }
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

/** The diff the layers asked for this pull request: still loading, or arrived within the last minute. */
export function recentPageDiff(
	location: Pick<PullRequestLocation, 'owner' | 'repo' | 'number'>,
	now = Date.now(),
): Promise<string> | undefined {
	if (!recent || recent.scope !== pullRequestScope(location)) return undefined
	if (recent.settledAt !== undefined && now - recent.settledAt >= PAGE_DIFF_REUSE_MILLISECONDS)
		return undefined

	return recent.promise
}

export function forgetPageDiff(): void {
	recent = undefined
}
