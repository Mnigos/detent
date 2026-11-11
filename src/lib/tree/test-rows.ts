const TREE_ITEM = 'li[role="treeitem"]'
const HINT_STYLE = 'padding:4px 8px 0;font-size:12px'
const SHOW_STYLE =
	'margin-left:4px;padding:0;border:0;background:none;font:inherit;color:var(--fgColor-accent);cursor:pointer'

/**
 * Hides GitHub's own tree rows for hidden test files (Files mode shows that tree), and every
 * directory row with nothing left to show. Row ids are paths, directories included.
 */
export function createNativeRowFilter(paths: Iterable<string>) {
	const all = [...paths]
	let hiddenRows = new Set<HTMLElement>()

	function apply(native: HTMLUListElement, hidden: ReadonlySet<string>) {
		const next = new Set<HTMLElement>()
		if (hidden.size > 0) {
			const shown = all.filter((path) => !hidden.has(path))
			for (const item of native.querySelectorAll<HTMLElement>(TREE_ITEM)) {
				if (!item.id) continue
				const isHidden = item.hasAttribute('aria-expanded')
					? !shown.some((path) => path.startsWith(`${item.id}/`))
					: hidden.has(item.id)
				if (isHidden) next.add(item)
			}
		}
		for (const item of hiddenRows) if (!next.has(item)) item.style.removeProperty('display')
		for (const item of next) if (item.style.display !== 'none') item.style.display = 'none'
		hiddenRows = next
	}

	return {
		apply,
		clear() {
			for (const item of hiddenRows) item.style.removeProperty('display')
			hiddenRows = new Set()
		},
	}
}

/** "12 test files hidden · Show", shown only while the filter hides something. */
export function createHiddenTestsHint(onShow: () => void) {
	const element = document.createElement('div')
	element.className = 'fgColor-muted'
	element.style.cssText = HINT_STYLE
	element.dataset.detentHint = ''
	const text = document.createElement('span')
	const show = document.createElement('button')
	show.type = 'button'
	show.textContent = 'Show'
	show.style.cssText = SHOW_STYLE
	show.addEventListener('click', onShow)
	element.append(text, show)
	element.hidden = true

	return {
		element,
		update(hint: string | undefined) {
			element.hidden = hint === undefined
			if (hint !== undefined && text.textContent !== hint) text.textContent = hint
		},
	}
}
