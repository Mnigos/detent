// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContentScriptContext } from 'wxt/utils/content-script-context'
import { createReviewSession } from '../lib/panel/session'
import { STATUS_LINES } from '../lib/panel/status'
import { createPanelStore } from '../lib/panel/store'
import { findDiffsList } from '../lib/tree/native'
import {
	ENV,
	ENV_ANCHOR,
	HANDLER_SPEC_ANCHOR,
	LAYERS,
	loadChangesPage,
	nativeTree,
} from '../test/changes-page'
import { startTree } from './mount'

vi.mock('../lib/panel/session', () => ({ createReviewSession: vi.fn() }))

let tree: Awaited<ReturnType<typeof startTree>>
let store: ReturnType<typeof createPanelStore>
let ctx: ContentScriptContext

beforeEach(async () => {
	const { anchorIds } = await loadChangesPage()
	vi.useFakeTimers()
	vi.stubGlobal('scrollTo', vi.fn())
	store = createPanelStore(LAYERS, { status: 'Ready', savePosition: vi.fn() })
	vi.mocked(createReviewSession).mockResolvedValue({ store, anchorIds, stop: vi.fn() })
	ctx = new ContentScriptContext('tree-test')
	tree = await startTree(ctx, { owner: 'owner', repo: 'repo', number: 1, tab: 'changes' })
	tree.mount()
	await vi.advanceTimersByTimeAsync(50)
})

afterEach(() => {
	tree.remove()
	ctx.abort()
	vi.clearAllTimers()
	vi.useRealTimers()
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe('tree and diff integration', () => {
	it('moves the active group with keyboard navigation and restores Files mode', async () => {
		expect(document.getElementById(ENV_ANCHOR)?.parentElement?.style.opacity).toBe('')
		document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }))
		await vi.advanceTimersByTimeAsync(50)
		expect(document.getElementById(ENV_ANCHOR)?.parentElement?.style.opacity).toBe('0.45')
		expect(document.getElementById(HANDLER_SPEC_ANCHOR)?.parentElement?.style.opacity).toBe('')
		document.querySelector<HTMLButtonElement>('#detent-tree button[aria-pressed="false"]')?.click()
		await vi.advanceTimersByTimeAsync(50)
		expect(nativeTree().style.display).toBe('')
		expect(document.getElementById(ENV_ANCHOR)?.parentElement?.style.order).toBe('')
		expect(document.getElementById(ENV_ANCHOR)?.parentElement?.style.opacity).toBe('')
		expect(document.querySelector<HTMLElement>('[data-detent-section]')?.hidden).toBe(true)
	})

	it('starts on the first layer with unviewed files regardless of the saved position', async () => {
		tree.remove()
		const { anchorIds } = await loadChangesPage()
		document
			.querySelector(`#${ENV_ANCHOR} button[aria-pressed]`)
			?.setAttribute('aria-pressed', 'true')
		store = createPanelStore(LAYERS, {
			status: 'Ready',
			savePosition: vi.fn(),
			position: { layerIndex: 2, fileIndex: 0, isRaw: false, isCollapsed: false },
		})
		vi.mocked(createReviewSession).mockResolvedValue({ store, anchorIds, stop: vi.fn() })
		tree = await startTree(ctx, { owner: 'owner', repo: 'repo', number: 1, tab: 'changes' })
		tree.mount()
		await vi.advanceTimersByTimeAsync(50)
		expect(store.getSnapshot()).toMatchObject({ layerIndex: 1, fileIndex: 0 })
		expect(document.getElementById(ENV_ANCHOR)?.parentElement?.style.opacity).toBe('0.45')
		expect(document.getElementById(HANDLER_SPEC_ANCHOR)?.parentElement?.style.opacity).toBe('')
		expect(window.scrollTo).not.toHaveBeenCalled()
	})

	it('shows an amber corner notice while there is no OpenRouter key', async () => {
		store.dispatch({ type: 'labels', layers: LAYERS, status: STATUS_LINES.missingKey })
		expect(document.getElementById('detent-no-key')?.textContent).toContain('no OpenRouter key')
		store.dispatch({ type: 'labels', layers: LAYERS, status: 'Layer names from m.' })
		expect(document.getElementById('detent-no-key')).toBeNull()
	})

	it('shows a corner badge while the model request is running', async () => {
		store.dispatch({ type: 'analyzing', status: 'Grouping…' })
		expect(document.getElementById('detent-analyzing')?.textContent).toContain('grouping')
		store.dispatch({ type: 'labels', layers: LAYERS, status: 'Done.' })
		expect(document.getElementById('detent-analyzing')).toBeNull()
	})

	it('keeps the layer under the sticky header bright without moving the active layer', async () => {
		const bottoms = new Map([
			[ENV_ANCHOR, 500],
			[HANDLER_SPEC_ANCHOR, 900],
		])
		vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
			this: HTMLElement,
		) {
			return { bottom: bottoms.get(this.id) ?? 0 } as DOMRect
		})
		document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }))
		await vi.advanceTimersByTimeAsync(50)
		expect(store.getSnapshot().layerIndex).toBe(1)
		expect(document.getElementById(ENV_ANCHOR)?.parentElement?.style.opacity).toBe('')
		expect(document.getElementById(HANDLER_SPEC_ANCHOR)?.parentElement?.style.opacity).toBe('')

		bottoms.set(ENV_ANCHOR, 10)
		window.dispatchEvent(new Event('scroll'))
		await vi.advanceTimersByTimeAsync(50)
		expect(store.getSnapshot().layerIndex).toBe(1)
		expect(document.getElementById(ENV_ANCHOR)?.parentElement?.style.opacity).toBe('0.45')
		expect(document.getElementById(HANDLER_SPEC_ANCHOR)?.parentElement?.style.opacity).toBe('')
	})

	it('moves only after the reviewer clicks Viewed, never when buttons load in', async () => {
		vi.mocked(window.scrollTo).mockClear()
		const button = document.querySelector<HTMLButtonElement>(`#${ENV_ANCHOR} button[aria-pressed]`)
		button?.setAttribute('aria-pressed', 'true')
		await vi.advanceTimersByTimeAsync(50)
		expect(store.getSnapshot().viewed.has(ENV)).toBe(true)
		expect(window.scrollTo).not.toHaveBeenCalled()

		button?.setAttribute('aria-pressed', 'false')
		await vi.advanceTimersByTimeAsync(50)
		store.dispatch({ type: 'select', layerIndex: 0, fileIndex: 0 })
		await vi.advanceTimersByTimeAsync(50)
		vi.mocked(window.scrollTo).mockClear()
		button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
		button?.setAttribute('aria-pressed', 'true')
		await vi.advanceTimersByTimeAsync(50)
		expect(store.getSnapshot().layerIndex).toBe(1)
	})

	it('counts a Viewed click from the clicked file, not from the remembered one', async () => {
		document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }))
		await vi.advanceTimersByTimeAsync(50)
		expect(store.getSnapshot()).toMatchObject({ layerIndex: 1, fileIndex: 0 })
		const button = document.querySelector<HTMLButtonElement>(`#${ENV_ANCHOR} button[aria-pressed]`)
		button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
		expect(store.getSnapshot()).toMatchObject({ layerIndex: 0, fileIndex: 0 })
		button?.setAttribute('aria-pressed', 'true')
		await vi.advanceTimersByTimeAsync(50)
		expect(store.getSnapshot().viewed.has(ENV)).toBe(true)
		expect(store.getSnapshot()).toMatchObject({ layerIndex: 1, fileIndex: 0 })
	})

	it('keeps a layer the reviewer chose until it is finished', async () => {
		document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }))
		await vi.advanceTimersByTimeAsync(50)
		document
			.querySelector(`#${HANDLER_SPEC_ANCHOR} button[aria-pressed]`)
			?.setAttribute('aria-pressed', 'true')
		await vi.advanceTimersByTimeAsync(50)
		expect(document.getElementById(ENV_ANCHOR)?.parentElement?.style.opacity).toBe('0.45')
		expect(document.getElementById(HANDLER_SPEC_ANCHOR)?.parentElement?.style.opacity).toBe('')
	})

	it('reattaches to React replacement lists and syncs Viewed from newly loaded buttons', async () => {
		const list = findDiffsList()
		if (!list) throw new Error('Missing diff list')
		const replacement = list.cloneNode(true) as HTMLElement
		for (const header of replacement.querySelectorAll('[data-detent-section]')) header.remove()
		list.replaceWith(replacement)
		await vi.advanceTimersByTimeAsync(50)
		expect(replacement.querySelectorAll('[data-detent-section]')).toHaveLength(3)
		document
			.querySelector(`#${ENV_ANCHOR} button[aria-pressed]`)
			?.setAttribute('aria-pressed', 'true')
		await vi.advanceTimersByTimeAsync(50)
		expect(document.querySelector('[data-detent-section="env"]')?.textContent).toContain('1/1')
		expect(document.getElementById(ENV_ANCHOR)?.parentElement?.style.opacity).toBe('0.45')
		expect(document.getElementById(HANDLER_SPEC_ANCHOR)?.parentElement?.style.opacity).toBe('')
		tree.remove()
		await vi.advanceTimersByTimeAsync(50)
		expect(document.querySelectorAll('[data-detent-section]')).toHaveLength(0)
		expect(document.getElementById(ENV_ANCHOR)?.parentElement?.style.order).toBe('')
		expect(nativeTree().style.display).toBe('')
	})
})
