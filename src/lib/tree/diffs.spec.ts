// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	ENV,
	ENV_ANCHOR,
	HANDLER_SPEC_ANCHOR,
	loadChangesPage,
	pageState,
} from '../../test/changes-page'
import { createDiffView } from './diffs'
import { findDiffsList } from './native'

let view: ReturnType<typeof createDiffView>
let list: HTMLElement

const entryOf = (anchor: string) => document.getElementById(anchor)?.parentElement
const headers = () => [...list.querySelectorAll<HTMLElement>('[data-detent-section]')]
const dimming = (header: HTMLElement) => header.style.opacity

beforeEach(async () => {
	const { anchorIds } = await loadChangesPage()
	view = createDiffView(anchorIds)
	const native = findDiffsList()
	if (!native) throw new Error('Missing diff list fixture')
	list = native
	vi.useFakeTimers()
})

afterEach(() => {
	view.detach()
	vi.useRealTimers()
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe('layer diffs', () => {
	it('holds the original viewport while regrouping moves the diff entries', () => {
		const state = pageState()
		view.apply(list, state)
		vi.stubGlobal('scrollY', 480)
		vi.stubGlobal('scrollTo', vi.fn())
		const layout = vi.spyOn(list, 'offsetHeight', 'get').mockImplementation(() => {
			expect(list.style.overflowAnchor).toBe('none')
			vi.stubGlobal('scrollY', 960)

			return 1200
		})

		view.apply(list, { ...state, layers: [...state.layers].reverse() })

		expect(layout).toHaveBeenCalled()
		expect(window.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 480 })
		expect(list.style.overflowAnchor).toBe('')
	})

	it('does not correct the viewport when reapplying the same layers', async () => {
		const state = pageState()
		view.apply(list, state)
		vi.stubGlobal('scrollY', 480)
		vi.stubGlobal('scrollTo', vi.fn())
		vi.spyOn(list, 'offsetHeight', 'get').mockImplementation(() => {
			vi.stubGlobal('scrollY', 960)

			return 1200
		})

		view.apply(list, { ...state, layerIndex: 0, fileIndex: 0 })
		await vi.advanceTimersByTimeAsync(50)

		expect(entryOf(ENV_ANCHOR)?.style.opacity).toBe('')
		expect(window.scrollTo).not.toHaveBeenCalled()
		expect(list.style.overflowAnchor).toBe('')
	})

	it('orders wrappers and headers by layer without moving GitHub nodes', () => {
		const original = [...list.children]
		const state = pageState()
		view.apply(list, { ...state, layers: [...state.layers].reverse(), layerIndex: 1 })

		expect(
			[...list.children].filter((entry) => !entry.hasAttribute('data-detent-section')),
		).toEqual(original)
		expect(entryOf(ENV_ANCHOR)?.style.order).toBe('2001')
		expect(entryOf(HANDLER_SPEC_ANCHOR)?.style.order).toBe('1004')
		expect(headers().map((header) => header.style.order)).toEqual(['0', '1000', '2000'])
		expect(headers()[1]?.textContent).toBe(
			'2. Record lifecycle analytics1/4Follow the command into its handler.',
		)
		expect(headers()[1]?.style.position).toBe('')
		const badge = entryOf(HANDLER_SPEC_ANCHOR)?.querySelector<HTMLElement>(
			'[data-diff-header-wrapper] [data-detent-layer]',
		)
		expect(badge?.textContent).toBe('2. Record lifecycle analytics · 1/4')
		expect(badge?.hidden).toBe(false)
	})

	it('keeps foreign list children such as the end marker after every layer', () => {
		const marker = document.createElement('div')
		marker.textContent = 'You made it to the end!'
		list.append(marker)
		view.apply(list, pageState())
		expect(marker.style.order).toBe('1998000')
		expect(marker.style.opacity).toBe('')
		view.apply(list, pageState({ isRaw: true }))
		expect(marker.style.order).toBe('')
	})

	it('dims only inactive wrappers and headers and follows the current layer', () => {
		view.apply(list, pageState())
		expect(entryOf(ENV_ANCHOR)?.style.opacity).toBe('0.45')
		expect(entryOf(HANDLER_SPEC_ANCHOR)?.style.opacity).toBe('')
		expect(headers().map(dimming)).toEqual(['0.45', '', '0.45'])

		view.apply(list, pageState({ layerIndex: 0 }))
		expect(entryOf(ENV_ANCHOR)?.style.opacity).toBe('')
		expect(entryOf(HANDLER_SPEC_ANCHOR)?.style.opacity).toBe('0.45')
	})

	it('dims a finished layer even while it is the current one', () => {
		view.apply(list, pageState({ layerIndex: 0, viewed: new Set([ENV]) }))
		expect(entryOf(ENV_ANCHOR)?.style.opacity).toBe('0.45')
		expect(dimming(headers()[0] as HTMLElement)).toBe('0.45')
	})

	it('restores native order and opacity in Files mode and removes decorations on detach', () => {
		view.apply(list, pageState())
		view.apply(list, pageState({ isRaw: true }))
		for (const anchor of [ENV_ANCHOR, HANDLER_SPEC_ANCHOR]) {
			expect(entryOf(anchor)?.style.order).toBe('')
			expect(entryOf(anchor)?.style.opacity).toBe('')
		}
		expect(headers().every((header) => header.hidden && dimming(header) === '')).toBe(true)
		expect(entryOf(ENV_ANCHOR)?.querySelector<HTMLElement>('[data-detent-layer]')?.hidden).toBe(
			true,
		)
		view.apply(list, pageState())
		view.detach()
		expect(headers()).toHaveLength(0)
		expect(document.querySelectorAll('[data-detent-layer]')).toHaveLength(0)
		expect(entryOf(ENV_ANCHOR)?.style.order).toBe('')
		expect(entryOf(ENV_ANCHOR)?.style.opacity).toBe('')
	})

	it('reapplies React style rewrites and dropped headers, then stops mutating', async () => {
		view.apply(list, pageState())
		await vi.advanceTimersByTimeAsync(50)
		const originalHeader = headers()[0]
		originalHeader?.remove()
		entryOf(ENV_ANCHOR)?.setAttribute(
			'style',
			'content-visibility:auto;contain-intrinsic-size:500px',
		)
		await vi.advanceTimersByTimeAsync(50)

		expect(entryOf(ENV_ANCHOR)?.style.order).toBe('1')
		expect(entryOf(ENV_ANCHOR)?.style.opacity).toBe('0.45')
		expect(entryOf(ENV_ANCHOR)?.style.contentVisibility).toBe('auto')
		expect(originalHeader?.parentElement).toBe(list)
		expect(headers()).toHaveLength(3)
		const mutations = vi.fn()
		const observer = new MutationObserver(mutations)
		observer.observe(list, { childList: true, attributes: true, subtree: true })
		await vi.advanceTimersByTimeAsync(100)
		expect(mutations).not.toHaveBeenCalled()
		observer.disconnect()
	})

	it('handles loaded placeholders, unknown files, and replacement lists', async () => {
		view.apply(list, pageState())
		const unknown = document.createElement('div')
		unknown.className = 'diffEntry'
		unknown.innerHTML = '<div role="region" id="diff-unknown"></div>'
		list.append(unknown)
		await vi.advanceTimersByTimeAsync(50)
		expect(unknown.style.order).toBe('999002')
		expect(unknown.style.opacity).toBe('0.45')
		const replacement = list.cloneNode(true) as HTMLElement
		for (const header of replacement.querySelectorAll('[data-detent-section]')) header.remove()
		list.replaceWith(replacement)
		view.apply(replacement, pageState({ layerIndex: 0 }))
		expect(list.querySelectorAll('[data-detent-section]')).toHaveLength(0)
		expect(replacement.querySelectorAll('[data-detent-section]')).toHaveLength(3)
		expect(entryOf(ENV_ANCHOR)?.style.opacity).toBe('')
	})
})
