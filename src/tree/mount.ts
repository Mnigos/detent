import type { ContentScriptContext } from 'wxt/utils/content-script-context'
import { LOADING_TEXT, showAnalysisBadge, showKeyBadge } from '@/src/lib/panel/analysis-badge'
import { observeMutations, stickyHeaderHeight } from '@/src/lib/panel/github-dom'
import { panelKeyAction } from '@/src/lib/panel/keys'
import { createReviewSession } from '@/src/lib/panel/session'
import { STATUS_LINES } from '@/src/lib/panel/status'
import { currentFile, isLayerComplete } from '@/src/lib/panel/store'
import type { PullRequestLocation } from '@/src/lib/pull-request-url'
import { createDiffView } from '@/src/lib/tree/diffs'
import {
	findDiffsList,
	findNativeTree,
	isViewedButton,
	readTemplates,
	readViewed,
	scrollToAnchor,
	type TreeTemplates,
	toggleViewedInHeader,
} from '@/src/lib/tree/native'
import { createTreeView, type TreeView } from '@/src/lib/tree/render'

export async function startTree(ctx: ContentScriptContext, location: PullRequestLocation) {
	const { store, anchorIds, stop } = await createReviewSession(ctx, location, (ids) =>
		readViewed(new Set(), ids),
	)
	let templates: TreeTemplates | undefined
	let view: TreeView | undefined
	const diffs = createDiffView(anchorIds)
	const handlers = {
		onSelect: (layerIndex: number, fileIndex: number) =>
			store.dispatch({ type: 'select', layerIndex, fileIndex }),
		onToggleTrailing: () => store.dispatch({ type: 'toggle-trailing' }),
		onSetRaw: (isRaw: boolean) => {
			if (store.getSnapshot().isRaw !== isRaw) store.dispatch({ type: 'toggle-raw' })
		},
	}

	const pathsByAnchor = new Map([...anchorIds].map(([path, anchorId]) => [anchorId, path]))

	const positionOf = (path: string | undefined) => {
		const state = store.getSnapshot()
		for (const [layerIndex, layer] of state.layers.entries()) {
			const fileIndex = layer.files.findIndex((file) => file.path === path)
			if (fileIndex >= 0) return { layerIndex, fileIndex }
		}

		return undefined
	}

	// Actions count from the file the reviewer is looking at, not from a file skipped earlier.
	function selectQuietly(target: { layerIndex: number; fileIndex: number } | undefined) {
		const state = store.getSnapshot()
		if (!target || (target.layerIndex === state.layerIndex && target.fileIndex === state.fileIndex))
			return

		position = state.layers[target.layerIndex]?.files[target.fileIndex]?.path
		store.dispatch({ type: 'select', ...target })
	}

	// The first file still on screen below the sticky header, whatever the review state.
	let focused: number | undefined
	function focusedFile(): { layerIndex: number; fileIndex: number } | undefined {
		const state = store.getSnapshot()
		const threshold = stickyHeaderHeight()
		for (const [layerIndex, layer] of state.layers.entries())
			for (const [fileIndex, file] of layer.files.entries()) {
				const anchorId = anchorIds.get(file.path)
				const region = anchorId ? document.getElementById(anchorId) : null
				if (region && region.getBoundingClientRect().bottom > threshold)
					return { layerIndex, fileIndex }
			}

		return undefined
	}
	const focusedLayer = () => focusedFile()?.layerIndex

	// The badge stays up until the layers are on the page, then only while the model is asked.
	function syncBadge() {
		const state = store.getSnapshot()
		showAnalysisBadge(!view || state.isAnalyzing, view ? undefined : LOADING_TEXT)
		showKeyBadge(Boolean(view) && !state.isAnalyzing && state.status === STATUS_LINES.missingKey)
	}

	function applyTree() {
		const list = findDiffsList()
		focused = focusedLayer()
		if (list) diffs.apply(list, store.getSnapshot(), focused)
		const native = findNativeTree()
		if (native) {
			templates ??= readTemplates(native)
			if (templates) {
				view ??= createTreeView(templates, anchorIds, handlers)
				view.apply(native, store.getSnapshot())
			}
		}
		syncBadge()
	}

	let position = currentFile(store.getSnapshot())?.path

	function followPosition() {
		const state = store.getSnapshot()
		const file = currentFile(state)
		if (file?.path === position) return

		position = file?.path
		const anchorId = file && anchorIds.get(file.path)
		if (anchorId) scrollToAnchor(anchorId)
	}

	// The active layer never follows the scroll: it is the first layer with unviewed files, always at
	// mount and again whenever the current layer is finished.
	function settleOnViewed(force: boolean) {
		const state = store.getSnapshot()
		if (state.isRaw || (!force && !isLayerComplete(state.layers[state.layerIndex], state.viewed)))
			return

		const layerIndex = state.layers.findIndex((layer) => !isLayerComplete(layer, state.viewed))
		const layer = state.layers[layerIndex]
		if (!layer || layerIndex === state.layerIndex) return

		const fileIndex = Math.max(
			layer.files.findIndex((file) => !state.viewed.has(file.path)),
			0,
		)
		position = layer.files[fileIndex]?.path
		store.dispatch({ type: 'select', layerIndex, fileIndex })
	}

	// Only a click on a Viewed button may move the reviewer; buttons loading in never do.
	let userToggled = false
	function syncViewed(force = false) {
		store.dispatch({
			type: 'viewed',
			paths: readViewed(store.getSnapshot().viewed, anchorIds),
			silent: !userToggled,
		})
		userToggled = false
		settleOnViewed(force)
		const list = findDiffsList()
		if (list) diffs.apply(list, store.getSnapshot())
	}

	async function run(action: ReturnType<typeof panelKeyAction>) {
		if (action && action !== 'toggle-raw' && action !== 'toggle-collapsed')
			selectQuietly(focusedFile())
		if (action === 'scroll-to-file' || action === 'toggle-viewed') {
			const file = currentFile(store.getSnapshot())
			const anchorId = file && anchorIds.get(file.path)
			if (!anchorId) return
			if (action === 'scroll-to-file') return scrollToAnchor(anchorId)

			await toggleViewedInHeader(anchorId)

			return
		}
		// There is no panel to collapse on this page; the backtick does nothing here.
		if (action && action !== 'toggle-collapsed') store.dispatch({ type: action })
	}

	let teardown: (() => void) | undefined

	return {
		mount() {
			const onKeyDown = (event: KeyboardEvent) => {
				const action = panelKeyAction(event)
				if (!action) return

				event.preventDefault()
				event.stopPropagation()
				void run(action)
			}
			document.addEventListener('keydown', onKeyDown, true)
			const onClick = (event: MouseEvent) => {
				if (!isViewedButton(event.target)) return

				userToggled = true
				const region = (event.target as Element).closest('[role="region"][id^="diff-"]')
				selectQuietly(positionOf(region ? pathsByAnchor.get(region.id) : undefined))
			}
			document.addEventListener('click', onClick, true)
			let scrollFrame: number | undefined
			const onScroll = () => {
				scrollFrame ??= requestAnimationFrame(() => {
					scrollFrame = undefined
					if (focusedLayer() !== focused) applyTree()
				})
			}
			window.addEventListener('scroll', onScroll, { passive: true })
			const stopDiffs = observeMutations(document.body, ['aria-pressed'], () => syncViewed())
			const stopTree = observeMutations(document.body, [], applyTree)
			const unsubscribe = store.subscribe(() => {
				applyTree()
				followPosition()
			})
			applyTree()
			syncViewed(true)

			teardown = () => {
				unsubscribe()
				stopTree()
				stopDiffs()
				document.removeEventListener('keydown', onKeyDown, true)
				document.removeEventListener('click', onClick, true)
				window.removeEventListener('scroll', onScroll)
				if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame)
				diffs.detach()
				view?.detach()
				showAnalysisBadge(false)
				showKeyBadge(false)
			}
		},
		remove() {
			stop()
			teardown?.()
			teardown = undefined
		},
	}
}
