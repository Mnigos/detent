export type ConflictState = 'conflicts' | 'clean' | 'unknown'

type PullRequestRef = { owner: string; repo: string; number: number }

const CONFLICT_CONDITION = 'PULL_REQUEST_MERGE_CONFLICT_STATE'

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null

/**
 * Reads the JSON behind GitHub's merge box (`/pull/<n>/page_data/merge_box`). `pullRequest.mergeStateStatus`
 * is GraphQL's MergeStateStatus: DIRTY means the merge commit cannot be created cleanly, UNKNOWN that
 * GitHub is still computing it. A closed or merged pull request counts as clean: it shows no marker.
 */
export function parseMergeBox(body: unknown): ConflictState {
	const pullRequest = isRecord(body) && isRecord(body.pullRequest) ? body.pullRequest : undefined
	if (!pullRequest) return 'unknown'
	if (typeof pullRequest.state === 'string' && pullRequest.state !== 'OPEN') return 'clean'

	const status = pullRequest.mergeStateStatus
	const requirements =
		isRecord(body) && isRecord(body.mergeRequirements) ? body.mergeRequirements : {}
	const conditions = Array.isArray(requirements.conditions) ? requirements.conditions : []
	const hasFailedCondition = conditions.some(
		(condition) =>
			isRecord(condition) && condition.type === CONFLICT_CONDITION && condition.result === 'FAILED',
	)
	if (status === 'DIRTY' || hasFailedCondition) return 'conflicts'
	if (typeof status !== 'string' || status === 'UNKNOWN') return 'unknown'

	return 'clean'
}

/** GitHub answered that the merge box is not there for this visitor (signed out, no access). */
export class MergeBoxUnavailableError extends Error {
	constructor(readonly status: number) {
		super(`GitHub returned ${status} for the merge box`)
		this.name = 'MergeBoxUnavailableError'
	}
}

/** Only a signed-in visitor gets the merge box; GitHub leaves this meta tag empty otherwise. */
export const isSignedIn = (root: ParentNode = document) =>
	Boolean(root.querySelector<HTMLMetaElement>('meta[name="user-login"]')?.content)

// Same origin as the list, so the content script sends the session cookie without the service worker.
export async function fetchConflictState({
	owner,
	repo,
	number,
}: PullRequestRef): Promise<ConflictState> {
	const response = await fetch(
		`https://github.com/${owner}/${repo}/pull/${number}/page_data/merge_box`,
		{
			credentials: 'same-origin',
			headers: {
				Accept: 'application/json',
				'X-Requested-With': 'XMLHttpRequest',
				'GitHub-Verified-Fetch': 'true',
			},
		},
	)
	if (response.status === 401 || response.status === 403 || response.status === 404)
		throw new MergeBoxUnavailableError(response.status)
	if (!response.ok) return 'unknown'

	return parseMergeBox(await response.json().catch(() => undefined))
}
