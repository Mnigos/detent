import { createRoot } from 'react-dom/client'
import type { ContentScriptContext } from 'wxt/utils/content-script-context'
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root'
import { showAnalysisBadge, showKeyBadge } from '@/src/lib/panel/analysis-badge'
import {
	clearDimming,
	observeColorMode,
	observeMutations,
	readViewedPaths,
	resolveColorMode,
	scrollToFile,
	setDimmedPaths,
	toggleViewed,
} from '@/src/lib/panel/github-dom'
import { panelKeyAction } from '@/src/lib/panel/keys'
import { createReviewSession } from '@/src/lib/panel/session'
import { STATUS_LINES } from '@/src/lib/panel/status'
import { currentFile, isLayerComplete } from '@/src/lib/panel/store'
import type { PullRequestLocation } from '@/src/lib/pull-request-url'
import { Panel } from './Panel'
import './style.css'

export async function startPanel(ctx: ContentScriptContext, location: PullRequestLocation) {
	const { store, anchorIds, stop } = await createReviewSession(ctx, location, readViewedPaths)

	function applyDimming() {
		const state = store.getSnapshot()
		const layer = state.layers[state.layerIndex]
		// A finished layer dims like any other inactive one, even while it is still the current one.
		const current = new Set(
			isLayerComplete(layer, state.viewed) ? [] : layer?.files.map((file) => file.path),
		)
		const dimmed = new Set<string>()
		if (!state.isRaw) for (const path of anchorIds.keys()) if (!current.has(path)) dimmed.add(path)
		setDimmedPaths(dimmed)
	}

	let position = currentFile(store.getSnapshot())?.path

	function followPosition() {
		const state = store.getSnapshot()
		const file = currentFile(state)
		if (file?.path === position) return

		position = file?.path
		if (file) void scrollToFile(file.path)
	}

	// A change event is the reviewer's own toggle; anything else is the page loading in.
	function syncFromPage(event?: Event) {
		store.dispatch({ type: 'viewed', paths: readViewedPaths(), silent: !event })
		applyDimming()
	}

	async function run(action: ReturnType<typeof panelKeyAction>) {
		if (action === 'scroll-to-file' || action === 'toggle-viewed') {
			const file = currentFile(store.getSnapshot())
			if (!file) return
			if (action === 'scroll-to-file') return scrollToFile(file.path)

			toggleViewed(file.path, anchorIds.get(file.path) ?? '')

			return
		}
		if (action) store.dispatch({ type: action })
	}

	return createShadowRootUi(ctx, {
		name: 'detent-panel',
		position: 'inline',
		anchor: 'body',
		append: 'last',
		onMount(container) {
			container.classList.toggle('dark', resolveColorMode() === 'dark')
			const root = createRoot(container)
			root.render(
				<Panel
					store={store}
					onScrollToFile={() => void run('scroll-to-file')}
					onToggleViewed={() => void run('toggle-viewed')}
				/>,
			)

			const onKeyDown = (event: KeyboardEvent) => {
				const action = panelKeyAction(event)
				if (!action) return

				event.preventDefault()
				event.stopPropagation()
				void run(action)
			}
			document.addEventListener('keydown', onKeyDown, true)
			document.addEventListener('change', syncFromPage, true)
			const stopViewed = observeMutations(document.body, ['data-file-user-viewed'], () =>
				syncFromPage(),
			)
			const stopColorMode = observeColorMode((mode) =>
				container.classList.toggle('dark', mode === 'dark'),
			)
			const unsubscribe = store.subscribe(() => {
				applyDimming()
				followPosition()
				showAnalysisBadge(store.getSnapshot().isAnalyzing)
				showKeyBadge(store.getSnapshot().status === STATUS_LINES.missingKey)
			})
			syncFromPage()
			showAnalysisBadge(store.getSnapshot().isAnalyzing)
			showKeyBadge(store.getSnapshot().status === STATUS_LINES.missingKey)

			return () => {
				unsubscribe()
				stopViewed()
				stopColorMode()
				showAnalysisBadge(false)
				showKeyBadge(false)
				document.removeEventListener('change', syncFromPage, true)
				document.removeEventListener('keydown', onKeyDown, true)
				clearDimming()
				root.unmount()
			}
		},
		onRemove(teardown) {
			stop()
			teardown?.()
		},
	})
}
