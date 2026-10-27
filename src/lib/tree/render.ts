import { isLayerComplete, type PanelLayer, type PanelState, viewedCount } from '../panel/store'
import { checkIcon, type TreeTemplates } from './native'

export const TREE_ID = 'detent-tree'
const SUMMARY_STYLE =
	'white-space:normal;font-size:11px;line-height:1.3;padding:0 0 2px;overflow-wrap:anywhere'
// The cloned row keeps GitHub's row height and spacing; the summary needs neither.
const SUMMARY_ROW_STYLE = 'height:auto;min-height:0;padding-top:0;padding-bottom:0;margin-top:-4px'
const GROUP_STYLE = 'list-style:none;padding:0;margin:0'
const ROW_TEXT_STYLE = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
export const FOCUS_TITLE = 'Worth a careful read'
const FOCUS_MARK_STYLE = 'margin-right:6px;font-size:9px;vertical-align:1px'
// GitHub's filter box prunes its own tree; the anchors left in it are the files that match.
const FILTER_INPUT = 'input[aria-label^="Filter files"]'
const NO_MATCH = 'No files match the filter.'

export interface TreeHandlers {
	onSelect: (layerIndex: number, fileIndex: number) => void
	onToggleTrailing: () => void
	onSetRaw: (isRaw: boolean) => void
}

export interface TreeView {
	root: HTMLElement
	apply: (native: HTMLUListElement, state: PanelState) => void
	detach: () => void
}

const container = (row: HTMLLIElement) =>
	row.querySelector<HTMLElement>('[style*="--level"]') ?? (row.firstElementChild as HTMLElement)

function setLevel(row: HTMLLIElement, level: number, levelLine: HTMLElement | undefined) {
	row.setAttribute('aria-level', String(level))
	const box = container(row)
	box.style.setProperty('--level', String(level))
	const lines = [...box.querySelectorAll('[class*="level-line"]')]
	const spacer = lines[0]?.parentElement ?? box.querySelector('[style*="spacer"] > div')
	for (const line of lines) line.remove()
	if (levelLine && spacer)
		for (let count = 1; count < level; count += 1) spacer.append(levelLine.cloneNode(true))
}

function textButton(label: string, onClick: () => void): HTMLButtonElement {
	const button = document.createElement('button')
	button.type = 'button'
	const native = document.querySelector<HTMLButtonElement>(
		'button[data-size="small"][data-component="Button"]',
	)
	button.className =
		native?.className
			.split(' ')
			.filter((name) => name.startsWith('prc-Button-'))
			.join(' ') || 'prc-Button-ButtonBase-9n-Xk'
	button.dataset.component = 'Button'
	button.dataset.size = 'small'
	button.textContent = label
	button.addEventListener('click', onClick)

	return button
}

export function createTreeView(
	templates: TreeTemplates,
	anchorIds: ReadonlyMap<string, string>,
	handlers: TreeHandlers,
): TreeView {
	const root = document.createElement('div')
	root.id = TREE_ID
	const toggle = document.createElement('div')
	toggle.className = 'd-flex gap-1 px-2 py-1'
	const layersButton = textButton('Layers', () => handlers.onSetRaw(false))
	const filesButton = textButton('Files', () => handlers.onSetRaw(true))
	toggle.append(layersButton, filesButton)
	const list = document.createElement('ul')
	list.setAttribute('role', 'tree')
	list.setAttribute('aria-label', 'Layers')
	const footer = document.createElement('div')
	footer.className = 'fgColor-muted f6 px-2 py-1'
	root.append(toggle, list, footer)
	let attached: HTMLUListElement | undefined
	let rendered: PanelState | undefined
	let renderedFilter = ''
	let visible: ReadonlySet<string> | undefined

	function fileRow(layerIndex: number, layer: PanelLayer, fileIndex: number, state: PanelState) {
		const file = layer.files[fileIndex]
		if (!file) return undefined

		const row = templates.file.cloneNode(true) as HTMLLIElement
		const isCurrent =
			!state.isRaw && layerIndex === state.layerIndex && fileIndex === state.fileIndex
		const basename = file.path.slice(file.path.lastIndexOf('/') + 1)
		setLevel(row, 2, templates.levelLine)
		row.setAttribute('aria-label', basename)
		row.setAttribute('aria-selected', String(isCurrent))
		row.dataset.path = file.path
		container(row).classList.toggle('bg-neutral-muted', isCurrent)
		const text = row.querySelector<HTMLElement>('[class*="content-text"]')
		if (text) text.style.cssText = ROW_TEXT_STYLE
		const anchor = row.querySelector('a')
		if (anchor) {
			anchor.href = `#${anchorIds.get(file.path) ?? ''}`
			anchor.textContent = basename
			anchor.title = file.isFocus ? `${file.path}\n${FOCUS_TITLE}` : file.path
			anchor.style.cssText = `display:block;${ROW_TEXT_STYLE}`
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

	function sectionRow(layerIndex: number, layer: PanelLayer, state: PanelState) {
		const row = templates.section.cloneNode(true) as HTMLLIElement
		const expanded =
			!layer.isTrailing ||
			state.isTrailingExpanded ||
			layerIndex === state.layerIndex ||
			visible !== undefined
		setLevel(row, 1, templates.levelLine)
		row.setAttribute('aria-expanded', String(expanded))
		row.setAttribute('aria-selected', 'false')
		row.toggleAttribute('aria-current', !state.isRaw && layerIndex === state.layerIndex)
		row.dataset.layer = layer.id
		const box = container(row)
		const chevron = row.querySelector<HTMLElement>('[class*="item-toggle"]')
		if (chevron && layer.isTrailing) {
			chevron.style.transform = expanded ? '' : 'rotate(-90deg)'
			chevron.addEventListener('click', (event) => {
				event.stopPropagation()
				handlers.onToggleTrailing()
			})
		} else chevron?.replaceChildren()
		if (isLayerComplete(layer, state.viewed))
			row
				.querySelector('[class*="item-visual"]')
				?.replaceChildren(checkIcon()?.cloneNode(true) ?? '✓')
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
		count.style.cssText = 'margin-left:auto;padding-right:8px;flex-shrink:0'
		count.textContent = `${viewedCount(layer, state.viewed)}/${layer.files.length}`
		text?.parentElement?.append(count)
		row.addEventListener('click', (event) => {
			if ((event.target as Element).closest('li[role="treeitem"]') === row)
				handlers.onSelect(layerIndex, 0)
		})
		if (expanded) {
			const group = document.createElement('ul')
			group.setAttribute('role', 'group')
			group.setAttribute('aria-label', layer.name)
			group.style.cssText = GROUP_STYLE
			group.append(
				...layer.files.flatMap((file, fileIndex) =>
					visible && !visible.has(anchorIds.get(file.path) ?? '')
						? []
						: (fileRow(layerIndex, layer, fileIndex, state) ?? []),
				),
			)
			row.append(group)
		}

		return row
	}

	return {
		root,
		apply(native, state) {
			if (attached !== native) {
				attached?.style.removeProperty('display')
				list.className = native.className
				native.after(root)
				attached = native
			} else if (root.previousElementSibling !== native) native.after(root)
			native.style.display = state.isRaw ? '' : 'none'
			list.hidden = state.isRaw
			const query = document.querySelector<HTMLInputElement>(FILTER_INPUT)?.value.trim() ?? ''
			const matches = query
				? [...native.querySelectorAll('a[href^="#diff-"]')].map((anchor) =>
						(anchor.getAttribute('href') ?? '').slice(1),
					)
				: []
			const filter = query ? matches.sort().join(' ') : ''
			if (rendered === state && renderedFilter === filter) return

			rendered = state
			renderedFilter = filter
			visible = query ? new Set(matches) : undefined
			layersButton.dataset.variant = state.isRaw ? 'invisible' : 'default'
			layersButton.setAttribute('aria-pressed', String(!state.isRaw))
			filesButton.dataset.variant = state.isRaw ? 'default' : 'invisible'
			filesButton.setAttribute('aria-pressed', String(state.isRaw))
			const sections = state.layers.flatMap((layer, index) =>
				visible && !layer.files.some((file) => visible?.has(anchorIds.get(file.path) ?? ''))
					? []
					: sectionRow(index, layer, state),
			)
			list.replaceChildren(...sections)
			footer.textContent =
				visible && sections.length === 0 ? NO_MATCH : (state.toast ?? state.status)
		},
		detach() {
			attached?.style.removeProperty('display')
			attached = undefined
			root.remove()
		},
	}
}
