import { scrollToSection } from '../panel/github-dom'

const NATIVE_TREE = 'ul[role="tree"][aria-label="File Tree"]'
const DIFFS_LIST = '[data-testid="progressive-diffs-list"]'
const VIEWED_BUTTONS = [
	'button[aria-pressed][aria-label="Viewed"]',
	'button[aria-pressed][aria-label="Not Viewed"]',
]
const VIEWED_BUTTON = VIEWED_BUTTONS.join(', ')
// Only a pressed button carries the checked box; an unpressed one would clone an empty square.
const CHECK_ICON = VIEWED_BUTTONS.map(
	(selector) => `${selector.replace('[aria-pressed]', '[aria-pressed="true"]')} svg`,
).join(', ')
const LOAD_ATTEMPTS = 10
const LOAD_INTERVAL_MILLISECONDS = 150

export interface TreeTemplates {
	section: HTMLLIElement
	file: HTMLLIElement
	levelLine: HTMLElement | undefined
}

export const findNativeTree = () =>
	document.querySelector<HTMLUListElement>(NATIVE_TREE) ?? undefined

export const findDiffsList = () => document.querySelector<HTMLElement>(DIFFS_LIST) ?? undefined

// A cloned row keeps GitHub's classes but must not carry its ids, its labels or its nested group.
function template(item: HTMLLIElement): HTMLLIElement {
	const clone = item.cloneNode(true) as HTMLLIElement
	clone.querySelector('ul[role="group"]')?.remove()
	for (const element of [clone, ...clone.querySelectorAll('[id], [aria-labelledby]')]) {
		element.removeAttribute('id')
		element.removeAttribute('aria-labelledby')
		element.removeAttribute('aria-describedby')
	}
	clone.tabIndex = -1

	return clone
}

export function readTemplates(tree: HTMLUListElement): TreeTemplates | undefined {
	const file = tree.querySelector<HTMLLIElement>('li[role="treeitem"]:not([aria-expanded])')
	if (!file) return undefined

	const directory = tree.querySelector<HTMLLIElement>('li[role="treeitem"][aria-expanded]')

	return {
		section: template(directory ?? file),
		file: template(file),
		levelLine: tree.querySelector<HTMLElement>('[class*="level-line"]') ?? undefined,
	}
}

export const isViewedButton = (target: EventTarget | null) =>
	target instanceof Element && target.closest(VIEWED_BUTTON) !== null

export const viewedButton = (anchorId: string) =>
	document.getElementById(anchorId)?.querySelector<HTMLButtonElement>(VIEWED_BUTTON) ?? undefined

export const checkIcon = () => document.querySelector<SVGElement>(CHECK_ICON) ?? undefined

// Headers load on scroll, so a path without a button keeps the state it was last seen in.
export function readViewed(
	previous: ReadonlySet<string>,
	anchorIds: ReadonlyMap<string, string>,
): ReadonlySet<string> {
	const viewed = new Set(previous)
	for (const [path, anchorId] of anchorIds) {
		const button = viewedButton(anchorId)
		if (!button) continue
		if (button.getAttribute('aria-pressed') === 'true') viewed.add(path)
		else viewed.delete(path)
	}

	return viewed
}

export const regionsByPath = (anchorIds: ReadonlyMap<string, string>) =>
	[...anchorIds].flatMap(([path, anchorId]) => {
		const section = document.getElementById(anchorId)

		return section ? [{ path, section }] : []
	})

// The hash makes GitHub load a file it has not rendered yet; once the reorder settles the region
// is corrected under the sticky header. A stale navigation is ignored.
function navigateToAnchor(anchorId: string): void {
	if (window.location.hash === `#${anchorId}`) {
		const region = document.getElementById(anchorId)
		if (region) scrollToSection(region)

		return
	}
	window.location.hash = anchorId
	requestAnimationFrame(() => {
		if (window.location.hash !== `#${anchorId}`) return
		const region = document.getElementById(anchorId)
		if (region) scrollToSection(region)
	})
}

// A rendered region is scrolled to directly: setting the hash would make the browser jump to it
// first and then jump again to the corrected offset.
export function scrollToAnchor(anchorId: string): void {
	const region = document.getElementById(anchorId)
	if (region) scrollToSection(region)
	else navigateToAnchor(anchorId)
}

export async function toggleViewedInHeader(anchorId: string): Promise<boolean> {
	let button = viewedButton(anchorId)
	for (let attempt = 0; !button && attempt < LOAD_ATTEMPTS; attempt += 1) {
		// A placeholder region exists before its header does; the hash is what makes GitHub load it.
		if (attempt === 0) navigateToAnchor(anchorId)
		await new Promise((resolve) => setTimeout(resolve, LOAD_INTERVAL_MILLISECONDS))
		button = viewedButton(anchorId)
	}
	button?.click()

	return button !== undefined
}
