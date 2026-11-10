// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { markOwnHash } from './github-dom'
import {
	anchorFileId,
	anchorPosition,
	heldReviewAnchor,
	holdReviewAnchor,
	isStaleHash,
	onFirstUserInput,
	parseReviewAnchor,
	releaseReviewAnchor,
	revealAnchor,
} from './review-anchor'
import type { PanelLayer, PanelState } from './store'

const FILE = `diff-${'a'.repeat(64)}`
const OTHER = `diff-${'b'.repeat(64)}`

function navigationType(type: NavigationTimingType) {
	vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
		{ type } as PerformanceNavigationTiming,
	])
}

function rectOf(element: Element, top: number, height = 100) {
	vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
		top,
		bottom: top + height,
	} as DOMRect)
}

beforeEach(() => {
	document.body.innerHTML = `
		<div id="${OTHER}"><div id="r1">first comment</div></div>
		<div id="${FILE}"><table><tr><td id="${FILE}R25">line</td></tr></table><div><div id="r2">comment</div></div></div>`
	vi.stubGlobal('innerHeight', 800)
	vi.stubGlobal('scrollY', 1000)
	vi.stubGlobal('scrollTo', vi.fn())
	Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

describe('parseReviewAnchor', () => {
	it.each([
		[`#${FILE}`, { ids: [FILE], fileId: FILE }],
		[`#${FILE}R25`, { ids: [`${FILE}R25`, FILE], fileId: FILE }],
		[`#${FILE}L3-R7`, { ids: [`${FILE}L3-R7`, `${FILE}L3`, FILE], fileId: FILE }],
		['#r4479369071', { ids: ['r4479369071', 'discussion_r4479369071'] }],
		['#discussion_r4479369071', { ids: ['discussion_r4479369071', 'r4479369071'] }],
		['#pullrequestreview-12', { ids: ['pullrequestreview-12'] }],
	])('reads %s', (hash, anchor) => {
		expect(parseReviewAnchor(hash)).toEqual(anchor)
	})

	it.each(['', '#', '#diff-abc', `#${FILE}X1`, '#issuecomment-5', '#r', '#readme'])(
		'ignores %j',
		(hash) => {
			expect(parseReviewAnchor(hash)).toBeUndefined()
		},
	)
})

describe('isStaleHash', () => {
	it('keeps a #diff- link followed into a fresh page', () => {
		navigationType('navigate')
		expect(isStaleHash(`#${FILE}R25`, true)).toBe(false)
	})

	it.each(['reload', 'back_forward'] as const)('drops a #diff- hash a %s brought back', (type) => {
		navigationType(type)
		expect(isStaleHash(`#${FILE}`, true)).toBe(true)
		// After the first pass a hash in the URL came from a click on this page.
		expect(isStaleHash(`#${FILE}`, false)).toBe(false)
	})

	it('keeps a comment hash even after a reload', () => {
		navigationType('reload')
		expect(isStaleHash('#r4479369071', true)).toBe(false)
	})

	it('drops the hash detent set itself to load a file', () => {
		navigationType('navigate')
		markOwnHash(OTHER)
		expect(isStaleHash(`#${OTHER}`, false)).toBe(true)
		// The mark is spent: a link the reviewer follows to the same file later is kept.
		expect(isStaleHash(`#${OTHER}`, false)).toBe(false)
	})

	it('forgets its own hash once the URL moved on', () => {
		navigationType('navigate')
		markOwnHash(OTHER)
		expect(isStaleHash(`#${FILE}`, false)).toBe(false)
		expect(isStaleHash(`#${OTHER}`, false)).toBe(false)
	})
})

describe('anchor targets', () => {
	it('finds the file of a comment from the section around it', () => {
		expect(anchorFileId({ ids: ['r2', 'discussion_r2'] })).toBe(FILE)
		expect(anchorFileId({ ids: ['discussion_r1', 'r1'] })).toBe(OTHER)
		expect(anchorFileId({ ids: ['r9'] })).toBeUndefined()
	})

	it('places the target file in the layers on screen', () => {
		const file = (path: string) => ({ path, role: 'other' as const, additions: 1, deletions: 0 })
		const layers: PanelLayer[] = [
			{ id: 'one', name: 'One', summary: '', isTrailing: false, files: [file('a.ts')] },
			{
				id: 'two',
				name: 'Two',
				summary: '',
				isTrailing: false,
				files: [file('c.ts'), file('b.ts')],
			},
		]
		const anchorIds = new Map([
			['a.ts', OTHER],
			['b.ts', FILE],
		])
		const state = { layers } as PanelState

		expect(anchorPosition({ ids: ['r2'] }, state, anchorIds)).toEqual({
			layerIndex: 1,
			fileIndex: 1,
		})
		expect(anchorPosition({ ids: ['r9'] }, state, anchorIds)).toBeUndefined()
	})

	it('leaves a target in view where it is', () => {
		rectOf(document.getElementById('r2') as HTMLElement, 300)
		revealAnchor({ ids: ['r2'] })
		expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
		expect(window.scrollTo).not.toHaveBeenCalled()
	})

	it('centres a comment or a line a reorder moved off screen', () => {
		const comment = document.getElementById('r2') as HTMLElement
		rectOf(comment, 4000)
		revealAnchor({ ids: ['r2'] })
		expect(comment.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'instant' })

		const line = document.getElementById(`${FILE}R25`) as HTMLElement
		rectOf(line, -900)
		revealAnchor(parseReviewAnchor(`#${FILE}R25`) as never)
		expect(line.scrollIntoView).toHaveBeenCalledTimes(2)
	})

	it('centres the first line of a range link', () => {
		const line = document.getElementById(`${FILE}R25`) as HTMLElement
		rectOf(line, 3000)
		revealAnchor(parseReviewAnchor(`#${FILE}R25-R30`) as never)
		expect(window.scrollTo).not.toHaveBeenCalled()
		expect(line.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'instant' })
	})

	it('puts a file under the sticky header, and falls back to the file for a missing line', () => {
		rectOf(document.getElementById(FILE) as HTMLElement, 2000)
		document.getElementById(`${FILE}R25`)?.remove()
		revealAnchor(parseReviewAnchor(`#${FILE}R25`) as never)
		// 2000 + scrollY 1000 - the 60px header fallback - 8.
		expect(window.scrollTo).toHaveBeenCalledWith({ top: 2932, behavior: 'instant' })
	})
})

describe('holdReviewAnchor', () => {
	afterEach(() => {
		releaseReviewAnchor()
		window.location.hash = ''
	})

	it('holds the link target until the reviewer scrolls, even before a view mounts', () => {
		window.location.hash = '#r2'
		holdReviewAnchor()
		expect(heldReviewAnchor()).toEqual({ ids: ['r2', 'discussion_r2'] })

		window.dispatchEvent(new Event('wheel'))
		expect(heldReviewAnchor()).toBeUndefined()
	})

	it('keeps the target through a press of the large pull request button', () => {
		const button = document.createElement('button')
		button.id = 'detent-group'
		document.body.append(button)
		window.location.hash = '#r2'
		holdReviewAnchor()

		button.dispatchEvent(new Event('pointerdown', { bubbles: true }))
		button.dispatchEvent(new Event('keydown', { bubbles: true }))
		expect(heldReviewAnchor()).toBeDefined()
		document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
		expect(heldReviewAnchor()).toBeUndefined()
	})

	it('holds nothing for a hash that is no review link', () => {
		window.location.hash = '#readme'
		holdReviewAnchor()
		expect(heldReviewAnchor()).toBeUndefined()
	})
})

describe('onFirstUserInput', () => {
	it.each(['wheel', 'touchstart', 'keydown', 'pointerdown'])('ends on the first %s', (type) => {
		const onInput = vi.fn()
		onFirstUserInput(onInput)
		window.dispatchEvent(new Event(type))
		window.dispatchEvent(new Event(type))
		expect(onInput).toHaveBeenCalledTimes(1)
	})

	it('ignores scrolls the page makes on its own', () => {
		const onInput = vi.fn()
		const stop = onFirstUserInput(onInput)
		window.dispatchEvent(new Event('scroll'))
		stop()
		window.dispatchEvent(new Event('wheel'))
		expect(onInput).not.toHaveBeenCalled()
	})
})
