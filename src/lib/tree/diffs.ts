import { observeMutations } from '../panel/github-dom'
import { isLayerComplete, type PanelState, viewedCount } from '../panel/store'

const LAYER_ORDER_STEP = 1000
// Prefix of the sticky badge on a file the model marked as worth a careful read.
const FOCUS_MARK = '● '
const UNKNOWN_ORDER = 999000
// GitHub's end-of-list marker is neither a file nor a header; it keeps closing the list.
const TRAILING_ORDER = String(UNKNOWN_ORDER * 2)
// GitHub's own file header is the only sticky bar; the layer divider stays in the flow and the
// layer badge rides inside each file header so the section and its count are always on screen.
const HEADER_STYLE = 'padding:4px 0;border-bottom:1px solid var(--borderColor-default)'
const TITLE_STYLE = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
const BADGE_STYLE =
	'flex-shrink:0;max-width:16rem;margin-right:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
const FILE_PATH_SECTION = '[data-diff-header-wrapper] [class*="file-path-section"]'

// New orders move the file the browser anchored the scroll to; scroll anchoring would follow it
// far down the page. The pass runs with anchoring off and puts the old offset back.
function holdViewport(list: HTMLElement, pass: () => void) {
	const top = window.scrollY
	list.style.overflowAnchor = 'none'
	try {
		pass()
	} finally {
		void list.offsetHeight
		if (window.scrollY !== top) window.scrollTo({ top })
		list.style.overflowAnchor = ''
	}
}

export function createDiffView(anchorIds: ReadonlyMap<string, string>) {
	const headers = new Map<string, HTMLElement>()
	const badges = new Set<HTMLElement>()
	// Per-entry lookups are cached: React rewrites entry styles while scrolling, and each rewrite
	// used to cost three DOM queries per file on the whole list.
	const regionIds = new WeakMap<HTMLElement, string | null>()
	const badgeOf = new WeakMap<HTMLElement, HTMLElement>()
	const entries = new Set<HTMLElement>()
	let attached: HTMLElement | undefined
	let current: PanelState | undefined
	let focused: number | undefined
	let stopObserving: (() => void) | undefined

	function detach() {
		stopObserving?.()
		stopObserving = undefined
		for (const entry of entries) {
			entry.style.order = ''
			entry.style.opacity = ''
		}
		entries.clear()
		for (const header of headers.values()) header.remove()
		for (const badge of badges) badge.remove()
		badges.clear()
		attached = undefined
	}

	function placeBadge(entry: HTMLElement, text: string, hidden: boolean) {
		let badge = badgeOf.get(entry)
		if (badge && !entry.contains(badge)) badge = undefined
		const section = badge ? undefined : entry.querySelector<HTMLElement>(FILE_PATH_SECTION)
		if (!badge && !section) return

		badge ??= section?.querySelector<HTMLElement>('[data-detent-layer]') ?? undefined
		if (!badge && section) {
			badge = document.createElement('span')
			badge.dataset.detentLayer = ''
			badge.className = 'fgColor-muted f6'
			badge.style.cssText = BADGE_STYLE
			section.prepend(badge)
		}
		if (!badge) return

		badgeOf.set(entry, badge)
		badges.add(badge)
		if (badge.textContent !== text) badge.textContent = text
		const title = text.startsWith(FOCUS_MARK)
			? `${text.slice(FOCUS_MARK.length)} · Worth a careful read`
			: text
		if (badge.title !== title) badge.title = title
		if (badge.hidden !== hidden) badge.hidden = hidden
	}

	// `focusedLayer` is the layer of the file under the sticky header; it stays bright while read.
	function apply(list: HTMLElement, state: PanelState, focusedLayer?: number) {
		const previous = current
		current = state
		focused = focusedLayer
		if (attached !== list) {
			detach()
			attached = list
			stopObserving = observeMutations(list, ['style'], () => {
				if (current) apply(list, current, focused)
			})
		}
		// The first pass and a regroup reorder the page; re-applies keep the same layers.
		if (previous?.layers !== state.layers)
			holdViewport(list, () => write(list, state, focusedLayer))
		else write(list, state, focusedLayer)
	}

	function write(list: HTMLElement, state: PanelState, focusedLayer?: number) {
		const positions = new Map<string, { order: number; layerIndex: number; badge: string }>()
		// A finished layer dims like any other inactive one, even while it is still the current one.
		const active = (layerIndex: number) =>
			layerIndex === focusedLayer ||
			(layerIndex === state.layerIndex && !isLayerComplete(state.layers[layerIndex], state.viewed))
		for (const [layerIndex, layer] of state.layers.entries()) {
			const badge = `${layerIndex + 1}. ${layer.name} · ${viewedCount(layer, state.viewed)}/${layer.files.length}`
			for (const [fileIndex, file] of layer.files.entries()) {
				const anchorId = anchorIds.get(file.path)
				if (anchorId)
					positions.set(anchorId, {
						order: layerIndex * LAYER_ORDER_STEP + fileIndex + 1,
						layerIndex,
						badge: file.isFocus ? `${FOCUS_MARK}${badge}` : badge,
					})
			}
			let header = headers.get(layer.id)
			if (!header) {
				header = document.createElement('div')
				header.dataset.detentSection = layer.id
				header.style.cssText = HEADER_STYLE
				const title = document.createElement('div')
				title.className = 'd-flex flex-items-center gap-2'
				const name = document.createElement('span')
				name.className = 'text-bold'
				name.style.cssText = TITLE_STYLE
				const count = document.createElement('span')
				count.className = 'fgColor-muted'
				count.style.cssText = 'margin-left:auto;flex-shrink:0'
				title.append(name, count)
				const summary = document.createElement('div')
				summary.className = 'fgColor-muted'
				summary.style.overflowWrap = 'anywhere'
				header.append(title, summary)
				headers.set(layer.id, header)
			}
			const title = header.firstElementChild as HTMLElement
			const values = [
				`${layerIndex + 1}. ${layer.name}`,
				`${viewedCount(layer, state.viewed)}/${layer.files.length}`,
				layer.summary,
			]
			const fields = [...title.children, header.lastElementChild]
			for (const [index, field] of fields.entries())
				if (field && field.textContent !== values[index]) field.textContent = values[index] ?? ''
			const order = String(layerIndex * LAYER_ORDER_STEP)
			const opacity = state.isRaw || active(layerIndex) ? '' : '0.45'
			if (header.style.order !== order) header.style.order = order
			if (header.style.opacity !== opacity) header.style.opacity = opacity
			if (header.hidden !== state.isRaw) header.hidden = state.isRaw
			if (header.parentElement !== list) list.append(header)
		}
		for (const [id, header] of headers)
			if (!state.layers.some((layer) => layer.id === id)) {
				header.remove()
				headers.delete(id)
			}
		for (const [index, entry] of list
			.querySelectorAll<HTMLElement>(':scope > :not([data-detent-section])')
			.entries()) {
			const isEntry = /diffEntry/.test(entry.className)
			let regionId = regionIds.get(entry)
			if (regionId === undefined || regionId === null) {
				regionId = isEntry
					? (entry.querySelector('[role="region"][id^="diff-"]')?.id ?? null)
					: null
				regionIds.set(entry, regionId)
			}
			const position = regionId ? positions.get(regionId) : undefined
			const order = state.isRaw
				? ''
				: isEntry
					? String(position?.order ?? UNKNOWN_ORDER + index)
					: TRAILING_ORDER
			const opacity =
				state.isRaw || !isEntry || (position && active(position.layerIndex)) ? '' : '0.45'
			if (entry.style.order !== order) entry.style.order = order
			if (entry.style.opacity !== opacity) entry.style.opacity = opacity
			entries.add(entry)
			if (position) placeBadge(entry, position.badge, state.isRaw)
		}
	}

	return { apply, detach }
}
