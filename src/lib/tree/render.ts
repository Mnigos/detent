import {
	currentFile,
	isLayerComplete,
	type PanelLayer,
	type PanelState,
	statusOf,
	type ViewMode,
	viewedCount,
} from '../panel/store'
import { buildFolderTree, type TreeNode } from './folders'
import { createModeToggle, PRIORITY_REVIEW } from './mode-toggle'
import { checkIcon, type TreeTemplates } from './native'
import { container, folderRow, group, ROW_TEXT_STYLE, setLevel } from './rows'

export const TREE_ID = 'detent-tree'
const SUMMARY_STYLE =
	'white-space:normal;font-size:11px;line-height:1.3;padding:0 0 2px;overflow-wrap:anywhere'
// The cloned row keeps GitHub's row height and spacing; the summary needs neither.
const SUMMARY_ROW_STYLE = 'height:auto;min-height:0;padding-top:0;padding-bottom:0;margin-top:-4px'
export const FOCUS_TITLE = 'Worth a careful read'
const FOCUS_MARK_STYLE = 'margin-right:6px;font-size:9px;vertical-align:1px'
const FOLDER_STYLE = 'margin-left:6px;font-size:11px'
// Priority sections list files in ranked order, the order j/k walks; folders would re-sort them.
const isFlat = (layer: PanelLayer) => layer.isCollapsible === true
// GitHub's filter box prunes its own tree; the anchors left in it are the files that match.
export const FILTER_INPUT = 'input[aria-label^="Filter files"]'
const NO_MATCH = 'No files match the filter.'

export interface TreeHandlers {
	onSelect: (layerIndex: number, fileIndex: number) => void
	onToggleTrailing: () => void
	onToggleSection: (id: string) => void
	onSetMode: (mode: ViewMode) => void
}

export interface TreeView {
	root: HTMLElement
	apply: (native: HTMLUListElement, state: PanelState) => void
	detach: () => void
}

export function createTreeView(
	templates: TreeTemplates,
	anchorIds: ReadonlyMap<string, string>,
	handlers: TreeHandlers,
): TreeView {
	const root = document.createElement('div')
	root.id = TREE_ID
	// The toggle sits above GitHub's own tree so it stays reachable in Files mode, where our list is hidden.
	const modes = createModeToggle(handlers.onSetMode)
	const toggle = modes.element
	const list = document.createElement('ul')
	list.setAttribute('role', 'tree')
	list.setAttribute('aria-label', 'Layers')
	const footer = document.createElement('div')
	footer.className = 'fgColor-muted f6 px-2 py-1'
	root.append(list, footer)
	let attached: HTMLUListElement | undefined
	let rendered: PanelState | undefined
	let renderedFilter = ''
	let visible: ReadonlySet<string> | undefined
	// File path (the native row id) to its status icon, read once per rebuild instead of per row.
	let ownVisuals = new Map<string, Element>()

	function readOwnVisuals(native: HTMLUListElement) {
		ownVisuals = new Map()
		for (const item of native.querySelectorAll('li[role="treeitem"]:not([aria-expanded])')) {
			const visual = item.querySelector('[class*="item-visual"]')
			if (item.id && visual && !ownVisuals.has(item.id)) ownVisuals.set(item.id, visual)
		}
	}

	function fileRow(
		layerIndex: number,
		layer: PanelLayer,
		fileIndex: number,
		state: PanelState,
		level: number,
	) {
		const file = layer.files[fileIndex]
		if (!file) return undefined

		const row = templates.file.cloneNode(true) as HTMLLIElement
		const isCurrent =
			!state.isRaw && layerIndex === state.layerIndex && fileIndex === state.fileIndex
		const basename = file.path.slice(file.path.lastIndexOf('/') + 1)
		setLevel(row, level, templates.levelLine)
		row.setAttribute('aria-label', basename)
		row.setAttribute('aria-selected', String(isCurrent))
		row.dataset.path = file.path
		container(row).classList.toggle('bg-neutral-muted', isCurrent)
		const text = row.querySelector<HTMLElement>('[class*="content-text"]')
		if (text) text.style.cssText = ROW_TEXT_STYLE
		// The template is one file's row; the status icon (added, modified, renamed) is this file's own.
		const ownVisual = ownVisuals.get(file.path)
		const visual = row.querySelector<HTMLElement>('[class*="item-visual"]')
		if (ownVisual && visual)
			visual.replaceChildren(...[...ownVisual.childNodes].map((node) => node.cloneNode(true)))
		const anchor = row.querySelector('a')
		if (anchor) {
			anchor.href = `#${anchorIds.get(file.path) ?? ''}`
			anchor.textContent = basename
			anchor.title = [file.path, file.reason, file.isFocus ? FOCUS_TITLE : undefined]
				.filter(Boolean)
				.join('\n')
			anchor.style.cssText = `display:block;${ROW_TEXT_STYLE}`
			// A flat priority row names its folder after the file, muted, so ranked order stays visible.
			const folder = isFlat(layer) ? file.path.slice(0, file.path.lastIndexOf('/')) : ''
			if (folder) {
				const path = document.createElement('span')
				path.className = 'fgColor-muted'
				path.style.cssText = FOLDER_STYLE
				path.dataset.detentFolder = ''
				path.textContent = folder
				anchor.append(path)
			}
			if (file.isFocus) {
				const mark = document.createElement('span')
				mark.className = 'fgColor-accent'
				mark.style.cssText = FOCUS_MARK_STYLE
				mark.dataset.detentFocus = ''
				mark.textContent = '●'
				anchor.prepend(mark)
			}
			if (state.viewed.has(file.path))
				anchor.className = anchor.className.replace('fgColor-default', 'fgColor-muted')
		}
		row.addEventListener('click', () => handlers.onSelect(layerIndex, fileIndex))

		return row
	}

	function nodeRows(
		nodes: readonly TreeNode[],
		level: number,
		layerIndex: number,
		layer: PanelLayer,
		state: PanelState,
	): HTMLLIElement[] {
		return nodes.flatMap((node) => {
			if (node.kind === 'file') return fileRow(layerIndex, layer, node.index, state, level) ?? []

			const children = nodeRows(node.children, level + 1, layerIndex, layer, state)

			return folderRow(templates.section, templates.levelLine, node, level, children)
		})
	}

	// The template's own visual (a folder icon) comes back when a completed section loses a tick.
	const sectionVisual = templates.section.querySelector('[class*="item-visual"]')
	function markComplete(row: HTMLLIElement, isComplete: boolean) {
		const visual = row.querySelector<HTMLElement>(
			':scope > [style*="--level"] [class*="item-visual"], [class*="item-visual"]',
		)
		if (!visual || (visual.dataset.detentCheck === '') === isComplete) return

		if (isComplete) {
			visual.dataset.detentCheck = ''
			visual.replaceChildren(checkIcon()?.cloneNode(true) ?? '✓')
		} else {
			delete visual.dataset.detentCheck
			visual.replaceChildren(
				...[...(sectionVisual?.childNodes ?? [])].map((node) => node.cloneNode(true)),
			)
		}
	}

	// Ticks arrive file by file while GitHub loads the page; rebuilding hundreds of rows for each
	// tick is what made scrolling stutter, so a viewed-only change patches the rows in place.
	function patchViewed(state: PanelState) {
		for (const row of list.querySelectorAll<HTMLLIElement>('li[data-path]')) {
			const anchor = row.querySelector('a')
			if (!anchor || !row.dataset.path) continue
			const isViewed = state.viewed.has(row.dataset.path)
			anchor.className = isViewed
				? anchor.className.replace('fgColor-default', 'fgColor-muted')
				: anchor.className.replace('fgColor-muted', 'fgColor-default')
		}
		for (const layer of state.layers) {
			const row = list.querySelector<HTMLLIElement>(`:scope > li[data-layer="${layer.id}"]`)
			if (!row) continue
			const count = row.querySelector<HTMLElement>('[data-detent-count]')
			const text = `${viewedCount(layer, state.viewed)}/${layer.files.length}`
			if (count && count.textContent !== text) count.textContent = text
			markComplete(row, isLayerComplete(layer, state.viewed))
		}
	}

	// A selection-only change moves the highlight; rebuilding hundreds of rows per click stalled
	// the Viewed button. Rows are patched in place.
	function patchSelection(state: PanelState) {
		const layerId = state.isRaw ? undefined : state.layers[state.layerIndex]?.id
		const path = layerId === undefined ? undefined : currentFile(state)?.path
		for (const section of list.querySelectorAll<HTMLLIElement>(':scope > li[data-layer]')) {
			const isCurrentLayer = section.dataset.layer === layerId
			section.toggleAttribute('aria-current', isCurrentLayer)
			for (const row of section.querySelectorAll<HTMLLIElement>('li[data-path]')) {
				const isCurrent = isCurrentLayer && row.dataset.path === path
				if (row.getAttribute('aria-selected') !== String(isCurrent))
					row.setAttribute('aria-selected', String(isCurrent))
				container(row).classList.toggle('bg-neutral-muted', isCurrent)
			}
		}
	}

	// A trailing layer opens while it is the current one, so the selection can change the shape.
	// A priority section stays as the reviewer folded it; moving into one unfolds it in the store.
	const isExpanded = (layerIndex: number, layer: PanelLayer, state: PanelState) =>
		visible !== undefined ||
		(layer.isCollapsible
			? !state.collapsedSections.has(layer.id)
			: !layer.isTrailing || state.isTrailingExpanded || layerIndex === state.layerIndex)

	const sameShape = (left: PanelState, right: PanelState) =>
		left.layers === right.layers &&
		left.isRaw === right.isRaw &&
		left.isPriority === right.isPriority &&
		left.isTrailingExpanded === right.isTrailingExpanded &&
		left.layers.every(
			(layer, index) => isExpanded(index, layer, left) === isExpanded(index, layer, right),
		)

	function sectionRow(layerIndex: number, layer: PanelLayer, state: PanelState) {
		const row = templates.section.cloneNode(true) as HTMLLIElement
		const expanded = isExpanded(layerIndex, layer, state)
		setLevel(row, 1, templates.levelLine)
		row.setAttribute('aria-expanded', String(expanded))
		row.setAttribute('aria-selected', 'false')
		row.toggleAttribute('aria-current', !state.isRaw && layerIndex === state.layerIndex)
		row.dataset.layer = layer.id
		const box = container(row)
		const chevron = row.querySelector<HTMLElement>('[class*="item-toggle"]')
		if (chevron && (layer.isTrailing || layer.isCollapsible)) {
			chevron.style.transform = expanded ? '' : 'rotate(-90deg)'
			chevron.addEventListener('click', (event) => {
				event.stopPropagation()
				if (layer.isCollapsible) handlers.onToggleSection(layer.id)
				else handlers.onToggleTrailing()
			})
		} else chevron?.replaceChildren()
		if (isLayerComplete(layer, state.viewed)) markComplete(row, true)
		const text = row.querySelector<HTMLElement>('[class*="content-text"]')
		if (text) {
			text.style.cssText = ROW_TEXT_STYLE
			text.title = layer.name
		}
		const name = document.createElement('span')
		name.textContent = layer.name
		text?.replaceChildren(name)
		if (layer.summary) {
			const summary = box.cloneNode(true) as HTMLElement
			summary.style.cssText += `;${SUMMARY_ROW_STYLE}`
			summary.querySelector('[class*="item-toggle"]')?.replaceChildren()
			summary.querySelector('[class*="item-visual"]')?.replaceChildren()
			const summaryText = summary.querySelector<HTMLElement>('[class*="content-text"]')
			if (summaryText) {
				summaryText.classList.add('fgColor-muted')
				summaryText.style.cssText = SUMMARY_STYLE
				summaryText.textContent = layer.summary
			}
			box.after(summary)
		}
		const count = document.createElement('span')
		count.className = 'fgColor-muted f6'
		count.dataset.detentCount = ''
		count.style.cssText = 'margin-left:auto;padding-right:8px;flex-shrink:0'
		count.textContent = `${viewedCount(layer, state.viewed)}/${layer.files.length}`
		text?.parentElement?.append(count)
		row.addEventListener('click', (event) => {
			if ((event.target as Element).closest('li[role="treeitem"]') === row)
				handlers.onSelect(layerIndex, 0)
		})
		if (expanded) {
			// Filtering before building leaves no folder without a matching file.
			const entries = layer.files.flatMap(({ path }, index) =>
				visible && !visible.has(anchorIds.get(path) ?? '') ? [] : [{ path, index }],
			)
			const rows = isFlat(layer)
				? entries.flatMap(({ index }) => fileRow(layerIndex, layer, index, state, 2) ?? [])
				: nodeRows(buildFolderTree(entries), 2, layerIndex, layer, state)
			row.append(group(layer.name, rows))
		}

		return row
	}

	return {
		root,
		apply(native, state) {
			if (attached !== native) {
				attached?.style.removeProperty('display')
				list.className = native.className
				native.before(toggle)
				native.after(root)
				attached = native
			} else {
				if (toggle.nextElementSibling !== native) native.before(toggle)
				if (root.previousElementSibling !== native) native.after(root)
			}
			native.style.display = state.isRaw ? '' : 'none'
			list.hidden = state.isRaw
			const query = document.querySelector<HTMLInputElement>(FILTER_INPUT)?.value.trim() ?? ''
			const matches = query
				? [...native.querySelectorAll('a[href^="#diff-"]')].map((anchor) =>
						(anchor.getAttribute('href') ?? '').slice(1),
					)
				: []
			// A query with no matches is a filter too, unlike no query at all.
			const filter = query ? `q:${matches.sort().join(' ')}` : ''
			if (rendered === state && renderedFilter === filter) return
			if (rendered && sameShape(rendered, state) && renderedFilter === filter) {
				rendered = state
				patchViewed(state)
				patchSelection(state)
				footer.textContent = visible && list.childElementCount === 0 ? NO_MATCH : statusOf(state)
				return
			}

			rendered = state
			renderedFilter = filter
			visible = query ? new Set(matches) : undefined
			modes.update(state)
			list.setAttribute('aria-label', state.isPriority ? PRIORITY_REVIEW : 'Layers')
			readOwnVisuals(native)
			const sections = state.layers.flatMap((layer, index) =>
				visible && !layer.files.some((file) => visible?.has(anchorIds.get(file.path) ?? ''))
					? []
					: sectionRow(index, layer, state),
			)
			list.replaceChildren(...sections)
			ownVisuals.clear()
			footer.textContent = visible && sections.length === 0 ? NO_MATCH : statusOf(state)
		},
		detach() {
			attached?.style.removeProperty('display')
			attached = undefined
			toggle.remove()
			root.remove()
		},
	}
}
