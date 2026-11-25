// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startDoubleClickViewed } from './mount'

const ANCHOR = `diff-${'a'.repeat(64)}`
const OTHER = `diff-${'b'.repeat(64)}`

// Hand-written after the Changes page's markup: a region per file, its sticky header with the
// Viewed button, the diff table, and an inline review thread with a comment box.
const changesFile = (anchorId: string, path: string) => `
	<div class="PullRequestDiffsList-module__diffEntry__x">
		<div role="region" id="${anchorId}" class="Diff-module__diff__x">
			<div data-diff-header-wrapper="true">
				<div class="DiffFileHeader-module__diff-file-header__x">
					<div class="DiffFileHeader-module__file-path-section__x">
						<h3><a href="#${anchorId}"><code>${path}</code></a></h3>
						<span class="header-gap">+5</span>
					</div>
					<button type="button" aria-pressed="false" aria-label="Not Viewed"><span>Viewed</span></button>
				</div>
			</div>
			<div class="diff-body">
				<table><tbody>
					<tr><td class="diff-line"><span class="word">const</span> value = 1</td></tr>
					<tr><td><div class="ReviewThread-module__thread__x"><p class="thread-text">Looks off</p>
						<div class="MarkdownEditor-module__editor__x"><textarea></textarea></div></div></td></tr>
				</tbody></table>
				<div class="empty-area"></div>
			</div>
		</div>
	</div>`

const CHANGES_PAGE = `<div data-testid="progressive-diffs-list">
	${changesFile(ANCHOR, 'src/a.ts')}${changesFile(OTHER, 'src/b.ts')}
</div>`

// Hand-written after the classic Files changed page: the Viewed checkbox in the header's form, the
// diff table, an inline thread row and its comment form.
const CLASSIC_PAGE = `<div id="files">
	<copilot-diff-entry data-file-path="src/a.ts">
		<div id="${ANCHOR}" data-details-container-group="file" class="file js-file js-details-container Details Details--on" data-tagsearch-path="src/a.ts">
			<div class="file-header js-file-header" data-path="src/a.ts">
				<span class="file-info"><a href="#${ANCHOR}">src/a.ts</a></span>
				<div class="file-actions">
					<form class="js-replace-file-header-review"><label class="js-reviewed-toggle">
						<input class="js-reviewed-checkbox" type="checkbox" name="viewed" value="true"> Viewed
					</label></form>
				</div>
			</div>
			<div class="js-file-content">
				<table><tbody>
					<tr><td class="blob-code diff-line"><span class="word">const</span> value = 1</td></tr>
					<tr class="inline-comments"><td><div class="js-inline-comments-container"><p class="thread-text">Looks off</p>
						<form class="js-inline-comment-form"><textarea></textarea></form></div></td></tr>
				</tbody></table>
				<div class="empty-area"></div>
			</div>
		</div>
	</copilot-diff-entry>
</div>`

let isActive = true
let stop: () => void
let frames: FrameRequestCallback[] = []

const viewedButton = () =>
	document.querySelector<HTMLButtonElement>(`#${ANCHOR} button[aria-pressed]`) as HTMLButtonElement
const checkbox = () => document.querySelector<HTMLInputElement>('.js-reviewed-checkbox')
const isViewed = () =>
	checkbox() ? checkbox()?.checked : viewedButton().getAttribute('aria-pressed') === 'true'

function doubleClick(target: Element | null | undefined, init: MouseEventInit = {}) {
	if (!target) throw new Error('no target')
	const options = { bubbles: true, cancelable: true, composed: true, ...init }
	target.dispatchEvent(new MouseEvent('mousedown', { ...options, detail: 1 }))
	target.dispatchEvent(new MouseEvent('mousedown', { ...options, detail: 2 }))
	target.dispatchEvent(new MouseEvent('dblclick', { ...options, detail: 2 }))
}

// GitHub's React button flips its own state on click.
function wireChangesButtons() {
	for (const button of document.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'))
		button.addEventListener('click', () => {
			const pressed = button.getAttribute('aria-pressed') !== 'true'
			button.setAttribute('aria-pressed', String(pressed))
			button.setAttribute('aria-label', pressed ? 'Viewed' : 'Not Viewed')
		})
}

const runFrames = () => {
	for (let index = 0; index < 200 && frames.length > 0; index += 1) {
		const pending = frames
		frames = []
		for (const frame of pending) frame(0)
	}
}

beforeEach(() => {
	isActive = true
	frames = []
	vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
		frames.push(callback)
		return frames.length
	})
	stop = startDoubleClickViewed(() => isActive)
})

afterEach(() => {
	stop()
	document.getSelection()?.removeAllRanges()
	document.body.innerHTML = ''
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe.each([
	{ kind: 'Changes page', markup: CHANGES_PAGE },
	{ kind: 'classic Files changed page', markup: CLASSIC_PAGE },
])('on the $kind', ({ markup }) => {
	beforeEach(() => {
		document.body.innerHTML = markup
		wireChangesButtons()
	})

	it.each([
		['the header', `#${ANCHOR} .file-header, #${ANCHOR} .header-gap`],
		['a diff line', `#${ANCHOR} .diff-line`],
		['the empty area of the file box', `#${ANCHOR} .empty-area`],
	])('toggles the file viewed from %s, and back', (_name, selector) => {
		doubleClick(document.querySelector(selector))
		expect(isViewed()).toBe(true)

		doubleClick(document.querySelector(selector))
		expect(isViewed()).toBe(false)
	})

	it.each([
		['the file name link', `#${ANCHOR} a[href]`],
		['GitHub’s Viewed control', `#${ANCHOR} button[aria-pressed], #${ANCHOR} .js-reviewed-toggle`],
		['an inline review thread', `#${ANCHOR} .thread-text`],
		['a comment box', `#${ANCHOR} textarea`],
	])('ignores a double-click on %s', (_name, selector) => {
		doubleClick(document.querySelector(selector))

		expect(isViewed()).toBe(false)
	})

	it('does nothing while the switch is off', () => {
		isActive = false
		doubleClick(document.querySelector(`#${ANCHOR} .diff-line`))

		expect(isViewed()).toBe(false)
	})

	it('ignores a double-click with a modifier key held', () => {
		doubleClick(document.querySelector(`#${ANCHOR} .diff-line`), { shiftKey: true })

		expect(isViewed()).toBe(false)
	})
})

describe('interactive elements inside a file', () => {
	beforeEach(() => {
		document.body.innerHTML = CHANGES_PAGE
		wireChangesButtons()
	})

	it.each([
		['input', '<input type="text">'],
		['textarea', '<textarea></textarea>'],
		['select', '<select><option>a</option></select>'],
		['button', '<button type="button"><span class="inner">Expand</span></button>'],
		['link', '<a href="#x"><span class="inner">link</span></a>'],
		['contenteditable', '<div contenteditable="true"><span class="inner">typing</span></div>'],
		['comment form', '<form><div class="inner">reply</div></form>'],
	])('ignores a double-click in a %s', (_name, html) => {
		const holder = document.createElement('div')
		holder.innerHTML = html
		document.querySelector(`#${ANCHOR} .diff-body`)?.append(holder)

		doubleClick(holder.querySelector('.inner') ?? holder.firstElementChild)

		expect(isViewed()).toBe(false)
	})

	it('toggles only the file that was double-clicked', () => {
		doubleClick(document.querySelector(`#${OTHER} .diff-line`))

		expect(isViewed()).toBe(false)
		expect(
			document.querySelector(`#${OTHER} button[aria-pressed]`)?.getAttribute('aria-pressed'),
		).toBe('true')
	})

	it('ignores a double-click outside any file', () => {
		const outside = document.createElement('p')
		document.body.append(outside)
		const click = vi.spyOn(HTMLElement.prototype, 'click')

		doubleClick(outside)

		expect(click).not.toHaveBeenCalled()
	})

	it('survives files that load after it started', () => {
		document.body.innerHTML = '<div data-testid="progressive-diffs-list"></div>'
		document
			.querySelector('[data-testid="progressive-diffs-list"]')
			?.insertAdjacentHTML('beforeend', changesFile(ANCHOR, 'src/a.ts'))
		wireChangesButtons()

		doubleClick(document.querySelector(`#${ANCHOR} .diff-line`))

		expect(isViewed()).toBe(true)
	})
})

describe('selection', () => {
	beforeEach(() => {
		document.body.innerHTML = CLASSIC_PAGE
	})

	const word = () => document.querySelector(`#${ANCHOR} .word`) as Element

	function select(node: Node) {
		const range = document.createRange()
		range.selectNodeContents(node)
		document.getSelection()?.removeAllRanges()
		document.getSelection()?.addRange(range)
	}

	it('clears the word the double-click selected', () => {
		const target = word()
		target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, detail: 2 }))
		// The browser selects the word between the second press and the dblclick event.
		select(target)
		target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }))

		expect(isViewed()).toBe(true)
		expect(document.getSelection()?.rangeCount).toBe(0)
	})

	it('keeps a selection made before the double-click', () => {
		const header = document.querySelector('.file-info') as Element
		select(header)
		const target = document.querySelector(`#${ANCHOR} .empty-area`) as Element
		target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, detail: 2 }))
		target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }))

		expect(isViewed()).toBe(true)
		expect(document.getSelection()?.toString()).toBe('src/a.ts')
	})

	it('leaves the selection alone when the double-click is ignored', () => {
		const thread = document.querySelector('.thread-text') as Element
		thread.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, detail: 2 }))
		select(thread)
		thread.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }))

		expect(isViewed()).toBe(false)
		expect(document.getSelection()?.toString()).toBe('Looks off')
	})
})

describe('viewport', () => {
	beforeEach(() => {
		document.body.innerHTML = CLASSIC_PAGE
		vi.spyOn(window, 'scrollY', 'get').mockReturnValue(3000)
	})

	function sectionBox(box: () => { top: number; height: number }) {
		vi.spyOn(
			document.getElementById(ANCHOR) as HTMLElement,
			'getBoundingClientRect',
		).mockImplementation(() => ({ ...box(), bottom: box().top + box().height }) as DOMRect)
	}

	it('brings the header of a file that collapsed back under the sticky bar', () => {
		const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
		sectionBox(() => (isViewed() ? { top: -1200, height: 50 } : { top: -1200, height: 2400 }))

		doubleClick(document.querySelector(`#${ANCHOR} .diff-line`))
		runFrames()

		// 3000 + (-1200) - 60 (GitHub's sticky fallback) - 8
		expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 1732 })
	})

	it('stays put when the header is still on screen', () => {
		const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
		sectionBox(() => (isViewed() ? { top: 300, height: 50 } : { top: 300, height: 2400 }))

		doubleClick(document.querySelector(`#${ANCHOR} .diff-line`))
		runFrames()

		expect(scrollTo).not.toHaveBeenCalled()
	})

	it('stays put when the file does not collapse', () => {
		const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
		sectionBox(() => ({ top: -1200, height: 2400 }))

		doubleClick(document.querySelector(`#${ANCHOR} .diff-line`))
		runFrames()

		expect(scrollTo).not.toHaveBeenCalled()
		expect(frames).toHaveLength(0)
	})

	it('leaves a page something else scrolled meanwhile where it is', () => {
		const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
		sectionBox(() => (isViewed() ? { top: -1200, height: 50 } : { top: -1200, height: 2400 }))

		doubleClick(document.querySelector(`#${ANCHOR} .diff-line`))
		vi.spyOn(window, 'scrollY', 'get').mockReturnValue(9000)
		runFrames()

		expect(scrollTo).not.toHaveBeenCalled()
	})
})

describe('on the captured GitHub fixtures', () => {
	const load = (name: string) => {
		document.body.innerHTML = readFileSync(resolve(process.cwd(), 'fixtures', name), 'utf8')
	}

	it('clicks the Changes page Viewed button of the file whose header was double-clicked', () => {
		load('github-changes-tree.html')
		const region = document.querySelector<HTMLElement>('[role="region"][id^="diff-"]')
		const button = region?.querySelector<HTMLButtonElement>('button[aria-label="Not Viewed"]')
		const click = vi.fn()
		button?.addEventListener('click', click)

		doubleClick(region?.querySelector('[data-testid="addition diffstat"]'))

		expect(click).toHaveBeenCalledOnce()
	})

	it('checks the classic Viewed checkbox of the file whose header was double-clicked', () => {
		load('github-files-page.html')
		const header = document.querySelector('.file-header')

		doubleClick(header)

		expect(header?.querySelector<HTMLInputElement>('.js-reviewed-checkbox')?.checked).toBe(true)
	})
})
