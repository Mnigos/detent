import { GROUP_BUTTON_ID } from './analysis-badge'
import { stickyHeaderHeight, takeOwnHash } from './github-dom'
import type { PanelState } from './store'

/** A link to a file, a line or a review comment on the Files changed or Changes page. */
export interface ReviewAnchor {
	/** The element ids GitHub may render the target under, most specific first. */
	ids: string[]
	/** The `diff-<sha256>` file section the hash names; a comment hash learns it from the page. */
	fileId?: string
}

// `#diff-<sha>` is a file, `R25`/`L25` a line on one side, `R25-R30` a range of lines.
const FILE_HASH = /^(diff-[0-9a-f]{64})([LR]\d+)?(?:-[LR]\d+)?$/
// Review threads link `#r<id>` on the files page and `#discussion_r<id>` from the conversation.
const COMMENT_HASH = /^(?:discussion_)?r(\d+)$/
const REVIEW_HASH = /^pullrequestreview-\d+$/
const FILE_SECTION_ID = /^diff-[0-9a-f]{64}$/
const USER_INPUT = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const

export function parseReviewAnchor(hash: string): ReviewAnchor | undefined {
	const id = hash.replace(/^#/, '')
	const file = FILE_HASH.exec(id)
	// GitHub renders an id per line, not per range: a range falls back to its first line, then the file.
	if (file?.[1])
		return { ids: [...new Set([id, `${file[1]}${file[2] ?? ''}`, file[1]])], fileId: file[1] }

	const comment = COMMENT_HASH.exec(id)
	if (comment?.[1])
		return { ids: [...new Set([id, `r${comment[1]}`, `discussion_r${comment[1]}`])] }
	if (REVIEW_HASH.test(id)) return { ids: [id] }

	return undefined
}

/**
 * A `#diff-` hash is a link the reviewer just followed, unless detent set it itself or, on the
 * document's first pass, a reload or a history step brought it back from an earlier visit. GitHub's
 * own file tree leaves such hashes behind; a comment hash only ever comes from a link.
 */
export function isStaleHash(hash: string, isFirstPass: boolean): boolean {
	if (!parseReviewAnchor(hash)?.fileId) return false
	if (takeOwnHash(hash)) return true
	if (!isFirstPass) return false

	const [entry] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[]

	return entry?.type === 'reload' || entry?.type === 'back_forward'
}

let held: { anchor: ReviewAnchor; stop: () => void } | undefined

/**
 * Holds the target of the link that opened a view, from the moment detent decides to mount it: the
 * diff fetch and the large pull request button come before the mount, and a reviewer who scrolls
 * meanwhile has left the target. The first scroll, click or key press lets it go.
 */
export function holdReviewAnchor(): void {
	releaseReviewAnchor()
	const anchor = parseReviewAnchor(window.location.hash)
	if (!anchor) return

	const entry = { anchor, stop: onFirstUserInput(() => held === entry && releaseReviewAnchor()) }
	held = entry
}

export const heldReviewAnchor = () => held?.anchor

export function releaseReviewAnchor(): void {
	held?.stop()
	held = undefined
}

export function findAnchorTarget(anchor: ReviewAnchor): HTMLElement | undefined {
	for (const id of anchor.ids) {
		const element = document.getElementById(id)
		if (element) return element
	}

	return undefined
}

/** The file section the target sits in: named by the hash, or the section around the comment. */
export function anchorFileId(anchor: ReviewAnchor): string | undefined {
	if (anchor.fileId) return anchor.fileId

	let element = findAnchorTarget(anchor)?.parentElement
	while (element && !FILE_SECTION_ID.test(element.id)) element = element.parentElement

	return element?.id
}

/** Where the target's file sits in the layers on screen, once the page shows which file it is. */
export function anchorPosition(
	anchor: ReviewAnchor,
	state: PanelState,
	anchorIds: ReadonlyMap<string, string>,
): { layerIndex: number; fileIndex: number } | undefined {
	const id = anchorFileId(anchor)
	if (!id) return undefined

	for (const [layerIndex, layer] of state.layers.entries()) {
		const fileIndex = layer.files.findIndex((file) => anchorIds.get(file.path) === id)
		if (fileIndex >= 0) return { layerIndex, fileIndex }
	}

	return undefined
}

/**
 * Brings the target back on screen after a reorder moved it; a target in view is left alone. The jump
 * is instant, so it also stops a smooth scroll GitHub started toward the target's old offset.
 */
export function revealAnchor(anchor: ReviewAnchor): void {
	const target = findAnchorTarget(anchor)
	if (!target) return

	const { top, bottom } = target.getBoundingClientRect()
	const header = stickyHeaderHeight()
	if (bottom > header && top < window.innerHeight) return
	if (target.id === anchor.fileId)
		window.scrollTo({ top: top + window.scrollY - header - 8, behavior: 'instant' })
	else target.scrollIntoView({ block: 'center', behavior: 'instant' })
}

/**
 * Calls `onInput` once, the first time the reviewer scrolls, taps, clicks or types. The large pull
 * request button asks for grouping; pressing it does not leave the target.
 */
export function onFirstUserInput(onInput: () => void): () => void {
	const stop = () => {
		for (const type of USER_INPUT) window.removeEventListener(type, handle, true)
	}
	function handle(event: Event) {
		if (event.target instanceof Element && event.target.closest(`#${GROUP_BUTTON_ID}`)) return

		stop()
		onInput()
	}
	for (const type of USER_INPUT)
		window.addEventListener(type, handle, { capture: true, passive: true })

	return stop
}
