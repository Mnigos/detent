// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPanelStore } from '../panel/store'
import { createModeToggle, TOGGLE_ID } from './mode-toggle'

const state = () => createPanelStore([], { status: '', savePosition: vi.fn() }).getSnapshot()
afterEach(() => document.body.replaceChildren())

describe('Layers | Priority | Files', () => {
	it('creates three ordered, accessible buttons with the Priority explanation', () => {
		const { element } = createModeToggle(vi.fn())
		expect(element.id).toBe(TOGGLE_ID)
		const buttons = [...element.querySelectorAll('button')]
		expect(buttons.map((button) => [button.textContent, button.dataset.mode, button.type])).toEqual(
			[
				['Layers', 'layers', 'button'],
				['Priority', 'priority', 'button'],
				['Files', 'files', 'button'],
			],
		)
		expect(buttons[1]?.title).toBe('Priority Review: the files to read first')
	})

	it('dispatches exactly the selected mode once per click, including after repeated updates', () => {
		const onSetMode = vi.fn()
		const toggle = createModeToggle(onSetMode)
		toggle.update(state())
		toggle.update(state())
		for (const button of toggle.element.querySelectorAll('button')) button.click()
		expect(onSetMode.mock.calls).toEqual([['layers'], ['priority'], ['files']])
	})

	it.each([
		[false, false, 'layers'],
		[false, true, 'priority'],
		[true, false, 'files'],
		[true, true, 'files'],
	] as const)('selects one button for isRaw=%s, isPriority=%s', (isRaw, isPriority, selected) => {
		const toggle = createModeToggle(vi.fn())
		// Reuse the same DOM through every transition so stale pressed states are detected.
		for (const flags of [
			{ isRaw: !isRaw, isPriority: !isPriority },
			{ isRaw, isPriority },
		])
			toggle.update({ ...state(), ...flags })
		expect(
			[...toggle.element.querySelectorAll('button')].map((button) => [
				button.dataset.mode,
				button.getAttribute('aria-pressed'),
				button.dataset.variant,
			]),
		).toEqual(
			['layers', 'priority', 'files'].map((mode) => [
				mode,
				String(mode === selected),
				mode === selected ? 'default' : 'invisible',
			]),
		)
	})
})
