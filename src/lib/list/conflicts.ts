import { browser } from 'wxt/browser'
import { type ErrorResponse, RateLimitError, readRateLimit, statusOf } from '../rate-limit'
import type { Send } from './request-queue'

export const FETCH_CONFLICTS_MESSAGE = 'detent:fetch-conflicts'

/** `rebase-blocked`: a merge commit or squash would go through, "Rebase and merge" would not. */
export type ConflictState = 'conflicts' | 'rebase-blocked' | 'clean' | 'unknown'

type PullRequestRef = { owner: string; repo: string; number: number }

/** `default`: asked without a merge method, so GitHub picks one. `rebase`: asked for "Rebase and merge". */
export type MergeBoxMode = 'default' | 'rebase'

const CONFLICT_CONDITION = 'PULL_REQUEST_MERGE_CONFLICT_STATE'
const MERGE_METHOD_CONDITION = 'PULL_REQUEST_MERGE_METHOD'
// The statuses with which GitHub's merge button offers a method.
const ALLOWED = new Set(['ALLOWED', 'ALLOWED_WITH_BYPASS'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null

const records = (value: unknown) => (Array.isArray(value) ? value.filter(isRecord) : [])

const openPullRequest = (body: unknown) =>
	isRecord(body) && isRecord(body.pullRequest) && body.pullRequest.state === 'OPEN'
		? body.pullRequest
		: undefined

/**
 * Reads the JSON behind GitHub's merge box (`/pull/<n>/page_data/merge_box`). `pullRequest.mergeStateStatus` is
 * GraphQL's MergeStateStatus: DIRTY means the merge commit cannot be created cleanly, UNKNOWN that GitHub is still
 * computing it. Like GitHub's merge box, BEHIND (the branch must be updated before it merges at all) wins over the
 * conflict condition. A failed conflict condition is a merge conflict, except that in `rebase` mode one without
 * conflicting files is GitHub's "This branch cannot be rebased due to conflicts". A failed merge method condition
 * means the answer is about a method the repository does not allow, which may hide a conflict, so it is unknown,
 * never clean. A closed or merged pull request counts as clean.
 */
export function parseMergeBox(body: unknown, mode: MergeBoxMode = 'default'): ConflictState {
	const pullRequest = isRecord(body) && isRecord(body.pullRequest) ? body.pullRequest : undefined
	if (!pullRequest) return 'unknown'
	if (typeof pullRequest.state === 'string' && pullRequest.state !== 'OPEN') return 'clean'

	const status = pullRequest.mergeStateStatus
	const requirements =
		isRecord(body) && isRecord(body.mergeRequirements) ? body.mergeRequirements : {}
	const conditions = records(requirements.conditions)
	const isFailed = (type: string) =>
		conditions.find((condition) => condition.type === type && condition.result === 'FAILED')
	if (status === 'DIRTY') return 'conflicts'
	if (typeof status !== 'string' || status === 'UNKNOWN') return 'unknown'
	if (isFailed(MERGE_METHOD_CONDITION)) return 'unknown'
	if (status === 'BEHIND') return 'clean'

	const failed = isFailed(CONFLICT_CONDITION)
	if (!failed) return 'clean'
	const hasConflictingFiles = Array.isArray(failed.conflicts) && failed.conflicts.length > 0

	return mode === 'rebase' && !hasConflictingFiles ? 'rebase-blocked' : 'conflicts'
}

/** Whether the merge box offers the viewer "Rebase and merge" (`viewerMergeActions[].mergeMethods[]`). */
export function allowsRebase(body: unknown) {
	const pullRequest = openPullRequest(body)
	if (!pullRequest) return false

	return records(pullRequest.viewerMergeActions)
		.flatMap((action) => records(action.mergeMethods))
		.some((method) => method.name === 'REBASE' && ALLOWED.has(String(method.allowableStatus)))
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

// GitHub's merge box asks with the method picked in it, and the server checks the conflict condition for that
// method. Asked without one, GitHub uses its default and reports a merge conflict on every repository; asked for
// rebase on a repository that does not allow it, the merge method condition fails and the conflict can go unsaid.
const REBASE_QUERY = '?merge_method=REBASE&bypass_requirements=false'

// The service worker asks with the session cookie: the extension's host permission for github.com makes Chrome send
// the same cookies, SameSite=Strict ones included, as the list page's own requests.
// Resolves to undefined for an answer that is not usable JSON. A rate limit throws RateLimitError, so it is never
// taken for a refusal.
async function requestMergeBox({ owner, repo, number }: PullRequestRef, send: Send, query = '') {
	const response = await send(
		`https://github.com/${owner}/${repo}/pull/${number}/page_data/merge_box${query}`,
		{
			credentials: 'include',
			headers: {
				Accept: 'application/json',
				'X-Requested-With': 'XMLHttpRequest',
				'GitHub-Verified-Fetch': 'true',
			},
		},
	)
	const rateLimit = await readRateLimit(response)
	if (rateLimit) throw new RateLimitError(rateLimit.retryAfterMilliseconds)
	if (response.status === 401 || response.status === 403 || response.status === 404)
		throw new MergeBoxUnavailableError(response.status)
	if (!response.ok) return undefined

	return response.json().catch(() => undefined)
}

/**
 * Asks the merge box with GitHub's default method, which decides conflicts. Only when that answer is clean and the
 * viewer may rebase does a second request ask for rebase merging, to tell a clean pull request from one GitHub
 * cannot rebase. `send` is fetch, or the list queue's, which throws RequestPausedError instead of sending while the
 * lists are paused, the second request included.
 */
export async function fetchConflictState(
	ref: PullRequestRef,
	send: Send = fetch,
): Promise<ConflictState> {
	const body = await requestMergeBox(ref, send)
	const state = parseMergeBox(body)
	if (state !== 'clean' || !allowsRebase(body)) return state

	return parseMergeBox(await requestMergeBox(ref, send, REBASE_QUERY), 'rebase')
}

export interface FetchConflictsRequest extends PullRequestRef {
	type: typeof FETCH_CONFLICTS_MESSAGE
}

export type FetchConflictsResponse = { state: ConflictState } | ErrorResponse

/** The content script's side: the service worker sends the merge box requests through the shared list queue. */
export async function requestConflictState({
	owner,
	repo,
	number,
}: PullRequestRef): Promise<ConflictState> {
	const request: FetchConflictsRequest = { type: FETCH_CONFLICTS_MESSAGE, owner, repo, number }
	const response = (await browser.runtime.sendMessage(request)) as
		| FetchConflictsResponse
		| undefined
	if (response && 'state' in response) return response.state
	const status = statusOf(response)
	if (status > 0) throw new MergeBoxUnavailableError(status)

	// The service worker's fetch failed, as the content script's own would on a network error.
	throw new TypeError('The merge box request failed')
}
