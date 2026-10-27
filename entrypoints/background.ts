import { browser } from 'wxt/browser'
import {
	FETCH_DIFF_MESSAGE,
	type FetchDiffRequest,
	type FetchDiffResponse,
	fetchPullRequestDiff,
	PullRequestDiffError,
} from '@/src/lib/diff/fetch-diff'
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

const isRequest = <T extends { type: string }>(message: unknown, type: T['type']): message is T =>
	typeof message === 'object' && message !== null && 'type' in message && message.type === type

export default defineBackground(() => {
	// Session storage is hidden from content scripts until the extension opts them in.
	browser.storage.session
		.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })
		.catch((error: unknown) => console.warn('[detent]', error))

	browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
		if (isRequest<FetchDiffRequest>(message, FETCH_DIFF_MESSAGE)) {
			fetchPullRequestDiff(message)
				.then((text) => sendResponse({ text } satisfies FetchDiffResponse))
				.catch((error: unknown) =>
					sendResponse({
						status: error instanceof PullRequestDiffError ? error.status : 0,
					} satisfies FetchDiffResponse),
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
