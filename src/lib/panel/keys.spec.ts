// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { panelKeyAction } from './keys'

function press(key: string, target: EventTarget = document.body, init: KeyboardEventInit = {}) {
	let action: ReturnType<typeof panelKeyAction>
	const listener = (event: Event) => {
		action = panelKeyAction(event as KeyboardEvent)
	}
	document.addEventListener('keydown', listener, true)
	target.dispatchEvent(
		new KeyboardEvent('keydown', { key, bubbles: true, composed: true, ...init }),
	)
	document.removeEventListener('keydown', listener, true)

	return action
}

const element = (id: string) => document.getElementById(id) as Element

beforeEach(() => {
	document.body.innerHTML = ''
})

describe('panelKeyAction', () => {
	it('maps every panel key', () => {
		expect([press('j'), press('k'), press('n'), press('p')]).toEqual([
			'next-file',
			'previous-file',
			'next-layer',
			'previous-layer',
		])
		expect([press('Enter'), press('v'), press('r'), press('`')]).toEqual([
			'scroll-to-file',
			'toggle-viewed',
			'toggle-raw',
			'toggle-collapsed',
		])
	})

	it('ignores unmapped keys and keys with a modifier', () => {
		expect(press('q')).toBeUndefined()
		expect(press('j', document.body, { metaKey: true })).toBeUndefined()
		expect(press('r', document.body, { ctrlKey: true })).toBeUndefined()
	})

	it('ignores keys typed into a field or a contenteditable', () => {
		document.body.innerHTML =
			'<input id="field"><div id="editor" contenteditable="true"><span id="inner"></span></div>'

		expect(press('j', element('field'))).toBeUndefined()
		expect(press('j', element('inner'))).toBeUndefined()
	})

	it('leaves Enter to the element it would activate', () => {
		document.body.innerHTML = '<button id="expand">Toggle diff</button><a id="link" href="#x">x</a>'

		expect(press('Enter', element('expand'))).toBeUndefined()
		expect(press('Enter', element('link'))).toBeUndefined()
		expect(press('j', element('expand'))).toBe('next-file')
	})

	it('sees through the shadow root the panel lives in', () => {
		const host = document.createElement('div')
		document.body.append(host)
		const button = document.createElement('button')
		host.attachShadow({ mode: 'open' }).append(button)

		expect(press('j', button)).toBe('next-file')
		expect(press('Enter', button)).toBeUndefined()
	})

	it('ignores keys while a GitHub dialog is open', () => {
		document.body.innerHTML = '<dialog open><p>Keyboard shortcuts</p></dialog>'

		expect(press('j')).toBeUndefined()

		document.body.innerHTML = '<details open><details-dialog>Rename</details-dialog></details>'

		expect(press('j')).toBeUndefined()
	})

	it('keeps working while GitHub dialogs sit closed in the page', () => {
		document.body.innerHTML =
			'<dialog><p>x</p></dialog><details><details-dialog>x</details-dialog></details><modal-dialog hidden>x</modal-dialog>'

		expect(press('j')).toBe('next-file')
	})
})
