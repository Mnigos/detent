// The rows on screen and one screen below: what the reader sees now or reaches with a single scroll.
export const NEAR_VIEWPORT_MARGIN = '0px 0px 100% 0px'

/**
 * Tracks which of the watched elements are near the viewport and calls `onChange` when that set changes. Without
 * IntersectionObserver every element counts as near.
 */
export function watchViewport(onChange: () => void) {
	if (typeof IntersectionObserver === 'undefined')
		return { isNear: (_element: Element) => true, watch: (_elements: Element[]) => {}, stop() {} }

	const near = new Set<Element>()
	const watched = new Set<Element>()
	const observer = new IntersectionObserver(
		(entries) => {
			let isChanged = false
			for (const { target, isIntersecting } of entries) {
				if (isIntersecting === near.has(target)) continue

				isChanged = true
				if (isIntersecting) near.add(target)
				else near.delete(target)
			}
			if (isChanged) onChange()
		},
		{ rootMargin: NEAR_VIEWPORT_MARGIN },
	)

	return {
		isNear: (element: Element) => near.has(element),
		/** Watches exactly these elements: new ones are observed, ones React dropped are let go. */
		watch(elements: Element[]) {
			const next = new Set(elements)
			for (const element of watched) {
				if (next.has(element)) continue

				observer.unobserve(element)
				watched.delete(element)
				near.delete(element)
			}
			for (const element of next) {
				if (watched.has(element)) continue

				watched.add(element)
				observer.observe(element)
			}
		},
		stop() {
			observer.disconnect()
		},
	}
}
