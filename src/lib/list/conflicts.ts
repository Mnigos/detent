/** `rebase-blocked`: a merge commit or squash would go through, "Rebase and merge" would not. */
export type ConflictState = 'conflicts' | 'rebase-blocked' | 'clean' | 'unknown'

type PullRequestRef = { owner: string; repo: string; number: number }

const CONFLICT_CONDITION = 'PULL_REQUEST_MERGE_CONFLICT_STATE'
const MERGE_METHOD_CONDITION = 'PULL_REQUEST_MERGE_METHOD'
// GitHub's merge box lists the methods it offers with these; a method missing or in another state is off.
const OFFERED = new Set(['ALLOWED', 'ALLOWED_WITH_BYPASS', 'UNAVAILABLE'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null

const records = (value: unknown) => (Array.isArray(value) ? value.filter(isRecord) : [])

/**
 * Whether the repository offers "Rebase and merge" to the viewer, read from `viewerMergeActions[].mergeMethods[]`.
 * A failed merge method condition (the asked method is off) says no; a response without the methods says nothing,
 * so it counts as yes.
 */
function offersRebase(pullRequest: Record<string, unknown>, conditions: Record<string, unknown>[]) {
	if (
		conditions.some(
			(condition) => condition.type === MERGE_METHOD_CONDITION && condition.result === 'FAILED',
		)
	)
		return false
	const methods = records(pullRequest.viewerMergeActions).flatMap((action) =>
		records(action.mergeMethods),
	)
	if (methods.length === 0) return true

	return methods.some(
		(method) => method.name === 'REBASE' && OFFERED.has(String(method.allowableStatus)),
	)
}

/**
 * Reads the JSON behind GitHub's merge box (`/pull/<n>/page_data/merge_box?merge_method=REBASE`).
 * `pullRequest.mergeStateStatus` is GraphQL's MergeStateStatus: DIRTY means the merge commit cannot be created
 * cleanly, UNKNOWN that GitHub is still computing it. The conflict condition is checked for the asked merge
 * method: failed with conflicting files it is a merge conflict, failed without any it is GitHub's
 * "This branch cannot be rebased due to conflicts". Like GitHub's merge box, BEHIND (the branch must be updated
 * before it merges at all) wins over the condition. A closed or merged pull request counts as clean.
 */
export function parseMergeBox(body: unknown): ConflictState {
	const pullRequest = isRecord(body) && isRecord(body.pullRequest) ? body.pullRequest : undefined
	if (!pullRequest) return 'unknown'
	if (typeof pullRequest.state === 'string' && pullRequest.state !== 'OPEN') return 'clean'

	const status = pullRequest.mergeStateStatus
	const requirements =
		isRecord(body) && isRecord(body.mergeRequirements) ? body.mergeRequirements : {}
	const conditions = records(requirements.conditions)
	const failed = conditions.find(
		(condition) => condition.type === CONFLICT_CONDITION && condition.result === 'FAILED',
	)
	if (status === 'DIRTY') return 'conflicts'
	if (typeof status !== 'string' || status === 'UNKNOWN') return 'unknown'
	if (status === 'BEHIND' || !failed) return 'clean'
	if (Array.isArray(failed.conflicts) && failed.conflicts.length > 0) return 'conflicts'
	if (offersRebase(pullRequest, conditions)) return 'rebase-blocked'

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

// GitHub's merge box asks with the method picked in it, and the conflict condition is checked for that method.
// Asking for rebase finds a blocked rebase; a merge conflict still shows as DIRTY, which is the same for every method.
const MERGE_BOX_QUERY = 'merge_method=REBASE&bypass_requirements=false'

// Same origin as the list, so the content script sends the session cookie without the service worker.
export async function fetchConflictState({
	owner,
	repo,
	number,
}: PullRequestRef): Promise<ConflictState> {
	const response = await fetch(
		`https://github.com/${owner}/${repo}/pull/${number}/page_data/merge_box?${MERGE_BOX_QUERY}`,
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
