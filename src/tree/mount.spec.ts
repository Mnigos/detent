// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContentScriptContext } from 'wxt/utils/content-script-context'
import { createReviewSession } from '../lib/panel/session'
import { STATUS_LINES } from '../lib/panel/status'
import { createPanelStore, currentFile, type PanelLayer } from '../lib/panel/store'
import { findDiffsList } from '../lib/tree/native'
import {
	ENV,
	ENV_ANCHOR,
	HANDLER_SPEC,
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
	it('defers restored Priority ranking while Files is visible and r returns to Priority', async () => {
		tree.remove()
		const { anchorIds } = await loadChangesPage()
		const priorityLayers: PanelLayer[] = LAYERS.map((layer, index) => ({
			...layer,
			id: `priority:${index}`,
			name: ['Urgent', 'Medium', 'Low'][index] ?? 'Low',
			isTrailing: false,
			isCollapsible: true,
		}))
		store = createPanelStore(LAYERS, {
			status: 'Ready',
			savePosition: vi.fn(),
			priorityLayers,
			position: { isPriority: true, isRaw: true },
		})
		const requestPriorities = vi.fn()
		vi.mocked(createReviewSession).mockResolvedValue({
			store,
			anchorIds,
			stop: vi.fn(),
			requestPriorities,
		})
		tree = await startTree(ctx, { owner: 'owner', repo: 'repo', number: 1, tab: 'changes' })
		tree.mount()
		await vi.advanceTimersByTimeAsync(50)
		expect(requestPriorities).not.toHaveBeenCalled()
		expect(nativeTree().style.display).toBe('')
		const path = currentFile(store.getSnapshot())?.path
		document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }))
		await vi.advanceTimersByTimeAsync(50)
		expect(store.getSnapshot()).toMatchObject({ isRaw: false, isPriority: true })
		expect(currentFile(store.getSnapshot())?.path).toBe(path)
		expect(nativeTree().style.display).toBe('none')
		expect(requestPriorities).toHaveBeenCalled()
		requestPriorities.mockClear()
		document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }))
		await vi.advanceTimersByTimeAsync(50)
		expect(store.getSnapshot()).toMatchObject({ isRaw: true, isPriority: true })
		expect(requestPriorities).not.toHaveBeenCalled()
		expect(currentFile(store.getSnapshot())?.path).toBe(path)
	})

	it('moves the active group with keyboard navigation and restores Files mode', async () => {
		expect(document.getElementById(ENV_ANCHOR)?.parentElement?.style.opacity).toBe('')
		document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }))
		await vi.advanceTimersByTimeAsync(50)
		expect(document.getElementById(ENV_ANCHOR)?.parentElement?.style.opacity).toBe('0.45')
		expect(document.getElementById(HANDLER_SPEC_ANCHOR)?.parentElement?.style.opacity).toBe('')
		document
			.querySelector<HTMLButtonElement>('#detent-tree-toggle button[data-mode="files"]')
			?.click()
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
		// Mounting never moves the viewport, even though the current file is further down the page.
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
			return { bottom: bottoms.get(this.id) ?? 1000 } as DOMRect
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

	it('keeps the viewport after regrouping and selects the file under the sticky header', async () => {
		expect(currentFile(store.getSnapshot())?.path).toBe(ENV)
		const bottoms = new Map([
			[HANDLER_SPEC_ANCHOR, 500],
			[ENV_ANCHOR, 900],
		])
		vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
			this: HTMLElement,
		) {
			return { bottom: bottoms.get(this.id) ?? 1000 } as DOMRect
		})
		vi.stubGlobal('scrollY', 480)
		vi.mocked(window.scrollTo).mockClear()

		store.dispatch({ type: 'labels', layers: [...LAYERS].reverse(), status: 'Regrouped' })
		await vi.advanceTimersByTimeAsync(50)

		expect(window.scrollTo).not.toHaveBeenCalled()
		expect(window.scrollY).toBe(480)
		expect(currentFile(store.getSnapshot())?.path).toBe(HANDLER_SPEC)
		expect(store.getSnapshot()).toMatchObject({ layerIndex: 1, fileIndex: 3 })
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

	it('preserves tree rows through a Viewed click and its pressed state update', async () => {
		document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }))
		await vi.advanceTimersByTimeAsync(50)
		const rows = [...document.querySelectorAll('#detent-tree li[role="treeitem"]')]
		expect(rows.length).toBeGreaterThan(0)
		const button = document.querySelector<HTMLButtonElement>(`#${ENV_ANCHOR} button[aria-pressed]`)
		if (!button) throw new Error('Missing Viewed button fixture')
		expect(button.getAttribute('aria-pressed')).toBe('false')

		button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
		expect(currentFile(store.getSnapshot())?.path).toBe(ENV)
		for (const [index, row] of document
			.querySelectorAll('#detent-tree li[role="treeitem"]')
			.entries())
			expect(row).toBe(rows[index])

		button.setAttribute('aria-pressed', 'true')
		await vi.advanceTimersByTimeAsync(50)

		expect(button.getAttribute('aria-pressed')).toBe('true')
		expect(store.getSnapshot().viewed.has(ENV)).toBe(true)
		expect(store.getSnapshot()).toMatchObject({ layerIndex: 1, fileIndex: 0 })
		const updated = [...document.querySelectorAll('#detent-tree li[role="treeitem"]')]
		expect(updated).toHaveLength(rows.length)
		for (const [index, row] of updated.entries()) expect(row).toBe(rows[index])
		expect(document.querySelector(`#detent-tree li[data-path="${ENV}"] a`)?.className).toContain(
			'fgColor-muted',
		)
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

	it('follows the GitHub filter box when it prunes rows below the top level of the native tree', async () => {
		const input = document.createElement('input')
		input.setAttribute('aria-label', 'Filter files…')
		document.body.prepend(input)
		const paths = () =>
			[...document.querySelectorAll<HTMLLIElement>('#detent-tree li[data-path]')].map(
				(row) => row.dataset.path,
			)
		const footer = () => document.querySelector('#detent-tree .fgColor-muted.f6.px-2')?.textContent
		const anchors = () => [...nativeTree().querySelectorAll('a[href^="#diff-"]')]
		const topLevel = nativeTree().childElementCount
		expect(paths()).toHaveLength(5)

		// GitHub prunes in place: the anchors go, the top-level rows stay.
		const pruned = anchors().filter((anchor) => anchor.getAttribute('href') !== `#${ENV_ANCHOR}`)
		const parents = pruned.map((anchor) => [anchor, anchor.parentElement] as const)
		input.value = ' env '
		for (const anchor of pruned) anchor.remove()
		await vi.advanceTimersByTimeAsync(50)
		expect(nativeTree().childElementCount).toBe(topLevel)
		expect(paths()).toEqual([ENV])
		expect(document.querySelectorAll('#detent-tree li[data-layer]')).toHaveLength(1)

		input.value = 'nothing'
		const last = anchors().map((anchor) => [anchor, anchor.parentElement] as const)
		for (const [anchor] of last) anchor.remove()
		await vi.advanceTimersByTimeAsync(50)
		expect(nativeTree().childElementCount).toBe(topLevel)
		expect(paths()).toEqual([])
		expect(footer()).toBe('No files match the filter.')

		input.value = ''
		for (const [anchor, parent] of [...parents, ...last]) parent?.append(anchor)
		await vi.advanceTimersByTimeAsync(50)
		expect(nativeTree().childElementCount).toBe(topLevel)
		expect(paths()).toHaveLength(5)
		expect(footer()).not.toBe('No files match the filter.')
		input.remove()
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

	it('asks for priorities once Priority Review is shown and walks its files in priority order', async () => {
		tree.remove()
		const { anchorIds } = await loadChangesPage()
		const priorityLayers = [
			{ ...LAYERS[1], id: 'priority:urgent', name: 'Urgent', isCollapsible: true },
			{ ...LAYERS[0], id: 'priority:medium', name: 'Medium', isCollapsible: true },
		] as PanelLayer[]
		store = createPanelStore(LAYERS, { status: 'Ready', savePosition: vi.fn(), priorityLayers })
		const requestPriorities = vi.fn()
		vi.mocked(createReviewSession).mockResolvedValue({
			store,
			anchorIds,
			stop: vi.fn(),
			requestPriorities,
		})
		tree = await startTree(ctx, { owner: 'owner', repo: 'repo', number: 1, tab: 'changes' })
		tree.mount()
		await vi.advanceTimersByTimeAsync(50)
		expect(requestPriorities).not.toHaveBeenCalled()

		document
			.querySelector<HTMLButtonElement>('#detent-tree-toggle button[data-mode="priority"]')
			?.click()
		await vi.advanceTimersByTimeAsync(50)
		expect(requestPriorities).toHaveBeenCalled()
		expect(store.getSnapshot().layers).toBe(priorityLayers)
		expect(
			[...document.querySelectorAll('#detent-tree ul[role="tree"] > li')].map(
				(row) =>
					row.getAttribute('aria-label') ??
					row.querySelector('[class*="content-text"]')?.textContent,
			),
		).toEqual(['Urgent', 'Medium'])
		expect(
			Number(document.getElementById(HANDLER_SPEC_ANCHOR)?.parentElement?.style.order),
		).toBeLessThan(Number(document.getElementById(ENV_ANCHOR)?.parentElement?.style.order))

		document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }))
		await vi.advanceTimersByTimeAsync(50)
		expect(currentFile(store.getSnapshot())?.path).toBe(ENV)
	})
})
