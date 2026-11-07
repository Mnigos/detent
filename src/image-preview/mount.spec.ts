// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://github.com/example/shop/pull/1"}
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startImagePreview } from './mount'
import { isImagePreviewOpen, PREVIEW_HOST } from './overlay'

const shot = (name: string) => `https://private-user-images.githubusercontent.com/1/${name}.png`
const COMMENT = `<div class="markdown-body">
	<p><a id="link-a" href="${shot('a')}"><img id="a" alt="Before" src="${shot('a')}"></a></p>
	<p><a href="${shot('b')}"><img id="b" alt="After" src="${shot('b')}"></a></p>
	<p><img id="c" src="${shot('c')}"></p>
</div>`

let isActive = true
let stop: () => void

const root = () => document.querySelector(PREVIEW_HOST)?.shadowRoot as ShadowRoot
const part = <T extends Element = HTMLElement>(selector: string) =>
	root().querySelector(selector) as T
const shown = () => part<HTMLImageElement>('.zoom img').getAttribute('src')
const counter = () => part('.counter').textContent

function click(element: Element) {
	const event = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true })
	element.dispatchEvent(event)

	return event
}

function press(key: string, init: KeyboardEventInit = {}) {
	const target = root()?.activeElement ?? document.body
	const event = new KeyboardEvent('keydown', {
		key,
		bubbles: true,
		cancelable: true,
		composed: true,
		...init,
	})
	target.dispatchEvent(event)

	return event
}

beforeEach(() => {
	document.body.innerHTML = COMMENT
	document.documentElement.style.overflow = 'scroll'
	isActive = true
	stop = startImagePreview(() => isActive)
})

afterEach(() => stop())

describe('opening', () => {
	it('opens a modal dialog over the page instead of following the link', () => {
		const event = click(document.querySelector('#b') as Element)

		expect(event.defaultPrevented).toBe(true)
		expect(isImagePreviewOpen()).toBe(true)
		expect(part('[role="dialog"]').getAttribute('aria-modal')).toBe('true')
		expect(part('[role="dialog"]').getAttribute('aria-label')).toBe('Image preview: After')
		expect(shown()).toBe(shot('b'))
		expect(part<HTMLAnchorElement>('.original').href).toBe(shot('b'))
		expect(part<HTMLAnchorElement>('.original').target).toBe('_blank')
		expect(counter()).toBe('2 / 3')
		expect(document.documentElement.style.overflow).toBe('hidden')
		expect(root().activeElement).toBe(part('.close'))
	})

	it('leaves the click alone while the setting is off', () => {
		isActive = false
		const event = click(document.querySelector('#a') as Element)

		expect(event.defaultPrevented).toBe(false)
		expect(isImagePreviewOpen()).toBe(false)
	})

	it('picks up comments added after it started', () => {
		document.body.insertAdjacentHTML(
			'beforeend',
			`<div class="markdown-body"><img id="late" src="${shot('late')}"></div>`,
		)
		click(document.querySelector('#late') as Element)

		expect(shown()).toBe(shot('late'))
		expect(counter()).toBe('')
		for (const step of root().querySelectorAll<HTMLElement>('.step')) expect(step.hidden).toBe(true)
	})
})

describe('navigation', () => {
	beforeEach(() => {
		click(document.querySelector('#a') as Element)
	})

	it('steps with the arrow keys and wraps at both ends', () => {
		press('ArrowRight')
		expect([shown(), counter()]).toEqual([shot('b'), '2 / 3'])
		press('ArrowRight')
		press('ArrowRight')
		expect([shown(), counter()]).toEqual([shot('a'), '1 / 3'])
		press('ArrowLeft')
		expect([shown(), counter()]).toEqual([shot('c'), '3 / 3'])
	})

	it('steps with the on-screen buttons', () => {
		part<HTMLButtonElement>('.next').click()
		expect(shown()).toBe(shot('b'))
		part<HTMLButtonElement>('.previous').click()
		expect(shown()).toBe(shot('a'))
		expect(part('.previous').getAttribute('aria-label')).toBe('Previous image')
		expect(part('.next').getAttribute('aria-label')).toBe('Next image')
	})

	it('toggles natural size on an image click and fits the next image again', () => {
		const zoom = part<HTMLButtonElement>('.zoom')
		expect(zoom.getAttribute('aria-pressed')).toBe('false')
		click(part('.zoom img'))
		expect(zoom.getAttribute('aria-pressed')).toBe('true')
		expect(isImagePreviewOpen()).toBe(true)
		press('ArrowRight')
		expect(zoom.getAttribute('aria-pressed')).toBe('false')
	})

	it('keeps keys away from the page and detent panel while open', () => {
		const seen: string[] = []
		const listen = (event: KeyboardEvent) => seen.push(event.key)
		document.addEventListener('keydown', listen, true)
		press('j')
		press('ArrowRight')
		document.removeEventListener('keydown', listen, true)

		expect(seen).toEqual([])
	})

	it('keeps Tab and Shift+Tab inside the preview', () => {
		const order = [...root().querySelectorAll('button:not([hidden]), a[href]')]
		expect(root().activeElement).toBe(part('.close'))
		const forward = []
		for (const _ of order) {
			expect(press('Tab').defaultPrevented).toBe(true)
			forward.push(root().activeElement)
		}
		expect(forward.at(-1)).toBe(part('.close'))
		expect(new Set(forward).size).toBe(order.length)
		press('Tab', { shiftKey: true })
		expect(root().activeElement).toBe(order[order.indexOf(part('.close')) - 1])
	})
})

describe('closing', () => {
	it('closes on Escape, unlocks scrolling and gives focus back to the clicked image link', () => {
		click(document.querySelector('#a') as Element)
		press('ArrowRight')
		press('Escape')

		expect(isImagePreviewOpen()).toBe(false)
		expect(document.querySelector(PREVIEW_HOST)).toBeNull()
		expect(document.documentElement.style.overflow).toBe('scroll')
		expect(document.activeElement).toBe(document.querySelector('#link-a'))
	})

	it('closes on a backdrop click but not on the toolbar controls', () => {
		click(document.querySelector('#a') as Element)
		click(part('.counter'))
		expect(isImagePreviewOpen()).toBe(true)
		click(part('.stage'))
		expect(isImagePreviewOpen()).toBe(false)
	})

	it('closes with the close button and focuses an unlinked image only until it blurs', () => {
		const image = document.querySelector('#c') as HTMLImageElement
		click(image)
		expect(part('.close').getAttribute('aria-label')).toBe('Close image preview')
		part<HTMLButtonElement>('.close').click()

		expect(isImagePreviewOpen()).toBe(false)
		expect(document.activeElement).toBe(image)
		image.blur()
		expect(image.hasAttribute('tabindex')).toBe(false)
	})

	it('closes when the browser goes back', () => {
		click(document.querySelector('#a') as Element)
		window.dispatchEvent(new PopStateEvent('popstate'))

		expect(isImagePreviewOpen()).toBe(false)
	})

	it('stops listening for clicks once stopped', () => {
		stop()
		const event = click(document.querySelector('#a') as Element)

		expect(event.defaultPrevented).toBe(false)
		expect(isImagePreviewOpen()).toBe(false)
	})
})
