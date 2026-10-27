import { digestText } from '../diff/digest'

export const DIMMED_CLASS = 'detent-dimmed'
const DIMMING_STYLE_ID = 'detent-dimming'
const FILE_SECTION =
	'.js-file, copilot-diff-entry, [data-details-container-group="file"], [data-tagsearch-path], [data-file-path]'
const PATH_ATTRIBUTES = ['data-tagsearch-path', 'data-file-path', 'data-path']
const VIEWED_CHECKBOX = '.js-reviewed-checkbox, input[type="checkbox"][name="viewed"]'
const ISSUE_TITLE = 'h1 .js-issue-title, bdi.js-issue-title, [data-testid="issue-title"]'
const PULL_REQUEST_BODY = '[data-testid="pr-body"], .js-discussion .timeline-comment .comment-body'
// Review threads on the files page carry the same class as the description; they are not the body.
const REVIEW_THREAD = '.js-inline-comments-container, .review-comment, .js-comment-review'
const DOCUMENT_TITLE_SUFFIX = /(?: by \S+)? · Pull Request #\d+(?: · [^·]+)?(?: · GitHub)?\s*$/
const anchorIds = new Map<string, string>()

const bodyIn = (root: ParentNode) =>
	[...root.querySelectorAll(PULL_REQUEST_BODY)]
		.find((element) => !element.closest(REVIEW_THREAD))
		?.textContent?.trim() ?? ''

export function readPullRequestSummary(): { title: string; body: string } {
	const heading = document.querySelector(ISSUE_TITLE)?.textContent?.trim()

	return {
		title: heading || document.title.replace(DOCUMENT_TITLE_SUFFIX, '').trim(),
		body: bodyIn(document),
	}
}

// The new Changes page does not render the description; the conversation page still does.
export async function fetchPullRequestBody(conversationUrl: string): Promise<string> {
	try {
		const response = await fetch(conversationUrl, { credentials: 'same-origin' })
		if (!response.ok) return ''

		return bodyIn(new DOMParser().parseFromString(await response.text(), 'text/html'))
	} catch {
		return ''
	}
}

export async function anchorIdForPath(path: string): Promise<string> {
	const cached = anchorIds.get(path)
	if (cached) return cached

	const anchorId = `diff-${await digestText(path)}`
	anchorIds.set(path, anchorId)

	return anchorId
}

const filesContainer = (): HTMLElement =>
	document.querySelector<HTMLElement>('#files') ??
	document.querySelector<HTMLElement>('#diff-layout-component') ??
	document.body

const quote = (value: string) => value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')

const pathOf = (element: Element) => {
	for (const attribute of PATH_ATTRIBUTES) {
		const value = element.getAttribute(attribute)
		if (value) return value
	}

	return undefined
}

export function fileSections(): { path: string; section: HTMLElement }[] {
	const sections = new Map<string, HTMLElement>()
	for (const element of filesContainer().querySelectorAll<HTMLElement>(FILE_SECTION)) {
		const path = pathOf(element)
		if (!path) continue

		// The wrapper and the section both carry the path; GitHub marks viewed state on the inner one.
		const known = sections.get(path)
		if (!known || known.contains(element)) sections.set(path, element)
	}

	return [...sections].map(([path, section]) => ({ path, section }))
}

export function findFileSection(path: string, anchorId: string): HTMLElement | undefined {
	const byAnchor = document.getElementById(anchorId)
	if (byAnchor) return byAnchor

	const attributes = PATH_ATTRIBUTES.map((attribute) => `[${attribute}="${quote(path)}"]`).join(',')
	const match = filesContainer().querySelector<HTMLElement>(attributes)

	return match?.closest<HTMLElement>(FILE_SECTION) ?? match ?? undefined
}

const isViewed = (section: Element) =>
	section.hasAttribute('data-file-user-viewed') ||
	(section.querySelector<HTMLInputElement>(VIEWED_CHECKBOX)?.checked ?? false)

export const readViewedPaths = (): ReadonlySet<string> =>
	new Set(
		fileSections()
			.filter(({ section }) => isViewed(section))
			.map(({ path }) => path),
	)

export function toggleViewed(path: string, anchorId: string): boolean {
	const checkbox = findFileSection(path, anchorId)?.querySelector<HTMLInputElement>(VIEWED_CHECKBOX)
	if (!checkbox) return false

	checkbox.click()

	return true
}

export function observeMutations(
	target: Node,
	attributeFilter: string[],
	onChange: () => void,
): () => void {
	let scheduled: number | undefined
	// The progressive loader appends files node by node; one pass per frame is enough.
	const observer = new MutationObserver(() => {
		scheduled ??= requestAnimationFrame(() => {
			scheduled = undefined
			onChange()
		})
	})
	observer.observe(target, {
		attributes: attributeFilter.length > 0,
		attributeFilter: attributeFilter.length > 0 ? attributeFilter : undefined,
		childList: true,
		subtree: true,
	})

	return () => {
		if (scheduled !== undefined) cancelAnimationFrame(scheduled)
		observer.disconnect()
	}
}

export function setDimmedPaths(
	dimmed: ReadonlySet<string>,
	sections: { path: string; section: HTMLElement }[] = fileSections(),
): void {
	if (!document.getElementById(DIMMING_STYLE_ID)) {
		const style = document.createElement('style')
		style.id = DIMMING_STYLE_ID
		style.textContent = `${FILE_SECTION}{transition:opacity 150ms}.${DIMMED_CLASS}{opacity:.45}`
		document.head.append(style)
	}
	for (const { path, section } of sections) section.classList.toggle(DIMMED_CLASS, dimmed.has(path))
}

export function clearDimming(sections: { section: HTMLElement }[] = fileSections()): void {
	for (const { section } of sections) section.classList.remove(DIMMED_CLASS)
	document.getElementById(DIMMING_STYLE_ID)?.remove()
}

// GitHub composes its own sticky offset from these two variables; 60px is its own fallback.
export function stickyHeaderHeight(): number {
	const styles = getComputedStyle(document.documentElement)
	const read = (name: string) => Number.parseFloat(styles.getPropertyValue(name)) || 0

	return read('--base-sticky-header-height') + (read('--observed-header-height') || 60)
}

export const resolveColorMode = (): 'dark' | 'light' => {
	const mode = document.documentElement.dataset.colorMode
	if (mode === 'dark' || mode === 'light') return mode

	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function observeColorMode(onChange: (mode: 'dark' | 'light') => void): () => void {
	const observer = new MutationObserver(() => onChange(resolveColorMode()))
	observer.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ['data-color-mode'],
	})

	return () => {
		observer.disconnect()
	}
}

export const scrollToSection = (section: HTMLElement) =>
	window.scrollTo({
		top: section.getBoundingClientRect().top + window.scrollY - stickyHeaderHeight() - 8,
	})

export async function scrollToFile(path: string): Promise<void> {
	const anchorId = await anchorIdForPath(path)
	const section = findFileSection(path, anchorId)
	if (section) return scrollToSection(section)

	document.getElementById(`file-tree-item-${anchorId}`)?.querySelector('a')?.click()
	await new Promise((resolve) => setTimeout(resolve, 300))
	const loaded = findFileSection(path, anchorId)
	if (loaded) scrollToSection(loaded)
}
