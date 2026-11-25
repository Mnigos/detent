import { viewedTarget } from '@/src/lib/double-click/targets'
import { scrollToSection, stickyHeaderHeight } from '@/src/lib/panel/github-dom'

// GitHub collapses a viewed file after its own update, which can wait for a request.
const COLLAPSE_FRAMES = 120

interface Boundary {
	node: Node
	offset: number
}

const snapshot = (): Boundary[] => {
	const selection = document.getSelection()
	if (!selection) return []

	return Array.from({ length: selection.rangeCount }, (_, index) => {
		const range = selection.getRangeAt(index)

		return [
			{ node: range.startContainer, offset: range.startOffset },
			{ node: range.endContainer, offset: range.endOffset },
		]
	}).flat()
}

const isSame = (before: Boundary[], after: Boundary[]) =>
	before.length === after.length &&
	before.every(
		(boundary, index) =>
			boundary.node === after[index]?.node && boundary.offset === after[index]?.offset,
	)

// A file collapsed under a reader deep in its diff leaves them in the files below; the header comes
// back under the sticky bar. A page someone else moved meanwhile (detent, GitHub, the reader) stays.
function holdHeader(section: HTMLElement) {
	const height = section.getBoundingClientRect().height
	const top = window.scrollY
	let frames = 0
	const check = () => {
		if (!section.isConnected || window.scrollY !== top) return

		const box = section.getBoundingClientRect()
		if (box.height < height) {
			if (box.top < stickyHeaderHeight()) scrollToSection(section)

			return
		}
		frames += 1
		if (frames < COLLAPSE_FRAMES) requestAnimationFrame(check)
	}
	requestAnimationFrame(check)
}

/**
 * Double-clicking a file in a pull request flips GitHub's own Viewed control, as the `v` key does.
 * Delegated listeners on the document survive GitHub's soft navigations and files loading in.
 */
export function startDoubleClickViewed(isActive: () => boolean): () => void {
	// The selection as the second press found it; the word a double-click selects comes after.
	let before: Boundary[] | undefined

	function onMouseDown(event: MouseEvent) {
		before = event.detail === 2 && isActive() ? snapshot() : undefined
	}

	function onDoubleClick(event: MouseEvent) {
		const previous = before
		before = undefined
		if (!isActive()) return

		const target = viewedTarget(event)
		if (!target) return

		// A selection made before the double-click is the reader's; only the word it selected goes.
		if (previous && !isSame(previous, snapshot())) document.getSelection()?.removeAllRanges()
		holdHeader(target.section)
		target.control.click()
	}

	document.addEventListener('mousedown', onMouseDown, true)
	document.addEventListener('dblclick', onDoubleClick, true)

	return () => {
		document.removeEventListener('mousedown', onMouseDown, true)
		document.removeEventListener('dblclick', onDoubleClick, true)
	}
}
