import { browser } from 'wxt/browser'
import {
	handleChatGptMessage,
	installCallbackRule,
	isExtensionPage,
} from '@/src/lib/chatgpt/background'
import { createDiffRequests } from '@/src/lib/diff/diff-requests'
import {
	FETCH_DIFF_MESSAGE,
	type FetchDiffRequest,
	type FetchDiffResponse,
	PullRequestDiffError,
} from '@/src/lib/diff/fetch-diff'
import {
	FETCH_DIFF_STATS_MESSAGE,
	type FetchDiffStatsRequest,
	type FetchDiffStatsResponse,
} from '@/src/lib/header/fetch-stats'
import { removeLegacyStatsCaches } from '@/src/lib/list/cache'
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
import { diffStats } from '@/src/lib/list/stats'
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
import {
	RESET_USAGE_MESSAGE,
	type ResetUsageRequest,
	resetChatGptRequests,
	resetUsage,
} from '@/src/lib/model/usage'
import { errorResponse } from '@/src/lib/rate-limit'

const diffError = (error: unknown) =>
	error instanceof PullRequestDiffError
		? { status: error.status, rateLimit: error.rateLimit, isPaused: error.isPaused }
		: { status: 0 }

const isRequest = <T extends { type: string }>(message: unknown, type: T['type']): message is T =>
	typeof message === 'object' && message !== null && 'type' in message && message.type === type

export default defineBackground(() => {
	// Session storage is hidden from content scripts until the extension opts them in.
	browser.storage.session
		.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })
		.catch((error: unknown) => console.warn('[detent]', error))
	// The ChatGPT sign-in callback must never reach 127.0.0.1; the rule is in place before any sign-in.
	installCallbackRule().catch((error: unknown) => console.warn('[detent]', error))

	browser.runtime.onInstalled.addListener(() => {
		removeLegacyStatsCaches().catch((error: unknown) => console.warn('[detent]', error))
	})

	// One queue for the list requests of every tab; the pull request page's own diff does not wait behind them.
	const list = createListRequests()
	// A pull request's diff the page and its header ask for at the same time is downloaded once.
	const diffs = createDiffRequests(list.diff)

	browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
		if (handleChatGptMessage(message, sender, sendResponse)) return true
		if (isRequest<FetchDiffRequest>(message, FETCH_DIFF_MESSAGE)) {
			;(message.isList ? diffs.queued(message) : diffs.page(message))
				.then((text) => sendResponse({ text } satisfies FetchDiffResponse))
				.catch((error: unknown) => sendResponse(diffError(error) satisfies FetchDiffResponse))
			return true
		}
		if (isRequest<FetchDiffStatsRequest>(message, FETCH_DIFF_STATS_MESSAGE)) {
			// Counted here, so the header's page gets the counts and never the diff.
			diffs
				.queued(message)
				.then((text) => sendResponse({ stats: diffStats(text) } satisfies FetchDiffStatsResponse))
				.catch((error: unknown) => sendResponse(diffError(error) satisfies FetchDiffStatsResponse))
			return true
		}
		if (isRequest<FetchConflictsRequest>(message, FETCH_CONFLICTS_MESSAGE)) {
			list
				.conflicts(message)
				.then((result) => sendResponse(result satisfies FetchConflictsResponse))
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
		// Only the popup resets a counter; the worker's queue orders it after any count being written.
		if (isRequest<ResetUsageRequest>(message, RESET_USAGE_MESSAGE) && isExtensionPage(sender)) {
			const reset = message.provider === 'chatgpt' ? resetChatGptRequests : resetUsage
			reset()
				.then(() => sendResponse(true))
				.catch(() => sendResponse(false))
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
