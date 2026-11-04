// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hideGroupButton, LOADING_TEXT, showAnalysisBadge, showGroupButton } from './analysis-badge'

const groupButton = () => document.querySelector<HTMLButtonElement>('#detent-group')

beforeEach(() => {
	document.head.innerHTML = ''
	document.body.innerHTML = ''
})

describe('showGroupButton', () => {
	it('renders a focusable button named by its text in the loading badge corner and style', () => {
		showAnalysisBadge(true, LOADING_TEXT)
		const badge = document.getElementById('detent-analyzing')
		showAnalysisBadge(false)
		showGroupButton('Large pull request (570 files). Group with detent', () => undefined)
		const button = groupButton()

		expect(button?.type).toBe('button')
		expect(button?.textContent).toBe('Large pull request (570 files). Group with detent')
		for (const property of ['position', 'right', 'bottom', 'background', 'border-radius', 'font'])
			expect(button?.style.getPropertyValue(property)).toBe(badge?.style.getPropertyValue(property))
		button?.focus()
		expect(document.activeElement).toBe(button)
	})

	it('runs the handler once and leaves the corner to the loading badge', () => {
		const onClick = vi.fn(() => showAnalysisBadge(true, LOADING_TEXT))
		showGroupButton('Group this pull request with detent', onClick)
		groupButton()?.click()
		groupButton()?.click()

		expect(onClick).toHaveBeenCalledTimes(1)
		expect(groupButton()).toBeNull()
		expect(document.getElementById('detent-analyzing')?.textContent).toBe(LOADING_TEXT)
	})

	it('keeps a single button and removes it on hide', () => {
		showGroupButton('first', () => undefined)
		showGroupButton('second', () => undefined)

		expect(document.querySelectorAll('#detent-group')).toHaveLength(1)
		expect(groupButton()?.textContent).toBe('second')
		hideGroupButton()
		expect(groupButton()).toBeNull()
	})
})
