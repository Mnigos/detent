import { browser } from 'wxt/browser'
import {
	FETCH_DIFF_MESSAGE,
	type FetchDiffRequest,
	type FetchDiffResponse,
	fetchPullRequestDiff,
	PullRequestDiffError,
} from '@/src/lib/diff/fetch-diff'
import {
	FETCH_CONFLICTS_MESSAGE,
	type FetchConflictsRequest,
	type FetchConflictsResponse,
} from '@/src/lib/list/conflicts'
import {
	FETCH_LIST_HEADS_MESSAGE,
	type FetchListHeadsRequest,
	type FetchListHeadsResponse,
} from '@/src/lib/list/heads'
import { createListRequests } from '@/src/lib/list/list-requests'
import { parsePullsListUrl } from '@/src/lib/list/rows'
import {
	LABEL_LAYERS_MESSAGE,
	type LabelLayersRequest,
	resolveLayerLabels,
} from '@/src/lib/model/label-layers'
import {
	PRIORITIZE_MESSAGE,
	type PrioritizeRequest,
	resolvePriorities,
} from '@/src/lib/model/label-priorities'
import { errorResponse } from '@/src/lib/rate-limit'

const isRequest = <T extends { type: string }>(message: unknown, type: T['type']): message is T =>
	typeof message === 'object' && message !== null && 'type' in message && message.type === type

export default defineBackground(() => {
	// Session storage is hidden from content scripts until the extension opts them in.
	browser.storage.session
		.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })
		.catch((error: unknown) => console.warn('[detent]', error))

	// One queue for the list requests of every tab; the pull request page's own diff does not wait behind them.
	const list = createListRequests()

	browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
		if (isRequest<FetchDiffRequest>(message, FETCH_DIFF_MESSAGE)) {
			;(message.isList ? list.diff(message) : fetchPullRequestDiff(message))
				.then((text) => sendResponse({ text } satisfies FetchDiffResponse))
				.catch((error: unknown) =>
					sendResponse(
						(error instanceof PullRequestDiffError
							? { status: error.status, rateLimit: error.rateLimit, isPaused: error.isPaused }
							: { status: 0 }) satisfies FetchDiffResponse,
					),
				)
			return true
		}
		if (isRequest<FetchConflictsRequest>(message, FETCH_CONFLICTS_MESSAGE)) {
			list
				.conflicts(message)
				.then((state) => sendResponse({ state } satisfies FetchConflictsResponse))
				.catch((error: unknown) =>
					sendResponse(errorResponse(error) satisfies FetchConflictsResponse),
				)
			return true
		}
		if (isRequest<FetchListHeadsRequest>(message, FETCH_LIST_HEADS_MESSAGE)) {
			// Only a pull request list's own data, so the worker is no general fetch for content scripts.
			if (!parsePullsListUrl(message.url)) {
				sendResponse({ status: 0 } satisfies FetchListHeadsResponse)
				return false
			}
			list
				.heads(message.url)
				.then((heads) => sendResponse({ heads: [...heads] } satisfies FetchListHeadsResponse))
				.catch((error: unknown) =>
					sendResponse(errorResponse(error) satisfies FetchListHeadsResponse),
				)
			return true
		}
		if (isRequest<LabelLayersRequest>(message, LABEL_LAYERS_MESSAGE)) {
			// An empty reply keeps the panel on its own status line instead of blaming the model.
			resolveLayerLabels(message)
				.then(sendResponse)
				.catch((error: unknown) => {
					console.warn('[detent] analysis failed', error)
					sendResponse(undefined)
				})
			return true
		}
		if (isRequest<PrioritizeRequest>(message, PRIORITIZE_MESSAGE)) {
			resolvePriorities(message)
				.then(sendResponse)
				.catch((error: unknown) => {
					console.warn('[detent] ranking failed', error)
					sendResponse(undefined)
				})
			return true
		}
		return false
	})
})
