import { describe, expect, it, vi } from 'vitest'
import {
	createPanelStore,
	currentFile,
	type PanelLayer,
	type PanelPosition,
	type PanelState,
	reducePanel,
	TOAST_MILLISECONDS,
} from './store'

const layer = (id: string, ...paths: string[]): PanelLayer => ({
	id,
	name: `Layer ${id}`,
	summary: '',
	isTrailing: id === 'g',
	files: paths.map((path) => ({ path, role: 'other', additions: 1, deletions: 0 })),
})

const LAYERS = [layer('a', 'a1', 'a2', 'a3'), layer('b', 'b1'), layer('c', 'c1', 'c2')]

const state = (overrides: Partial<PanelState> = {}): PanelState => ({
	layers: LAYERS,
	layerIndex: 0,
	fileIndex: 0,
	isRaw: false,
	isCollapsed: false,
	viewed: new Set(),
	status: 'Layer names come from the file structure.',
	isAnalyzing: false,
	isTrailingExpanded: false,
	...overrides,
})

const TRAILING = [...LAYERS, layer('g', 'g1', 'g2')]

const at = (next: PanelState) => [next.layerIndex, next.fileIndex]

describe('analysis progress', () => {
	it('flags a running request and clears it when labels arrive', () => {
		const store = createPanelStore(LAYERS, { savePosition: () => undefined, status: '' })
		store.dispatch({ type: 'analyzing', status: 'Grouping…' })
		expect(store.getSnapshot()).toMatchObject({ isAnalyzing: true, status: 'Grouping…' })
		store.dispatch({ type: 'labels', layers: LAYERS, status: 'Done.' })
		expect(store.getSnapshot()).toMatchObject({ isAnalyzing: false, status: 'Done.' })
	})
})

describe('reducePanel', () => {
	it('walks the reading order across layer boundaries', () => {
		expect(at(reducePanel(state({ layerIndex: 0, fileIndex: 2 }), { type: 'next-file' }))).toEqual([
			1, 0,
		])
		expect(
			at(reducePanel(state({ layerIndex: 1, fileIndex: 0 }), { type: 'previous-file' })),
		).toEqual([0, 2])
	})

	it('stops at both ends of the reading order', () => {
		expect(at(reducePanel(state(), { type: 'previous-file' }))).toEqual([0, 0])
		expect(at(reducePanel(state({ layerIndex: 2, fileIndex: 1 }), { type: 'next-file' }))).toEqual([
			2, 1,
		])
	})

	it('follows the current file into the layer the labels moved it to', () => {
		const relabelled = [layer('a', 'a1', 'a2'), layer('b', 'a3', 'b1'), layer('c', 'c1', 'c2')]
		const next = reducePanel(state({ layerIndex: 0, fileIndex: 2 }), {
			type: 'labels',
			layers: relabelled,
			status: 'Layer names from test-model.',
		})

		expect(next.layers).toBe(relabelled)
		expect(next.status).toBe('Layer names from test-model.')
		expect(at(next)).toEqual([1, 0])
	})

	it('clamps the position when the labelled layers no longer hold the current file', () => {
		const next = reducePanel(state({ layerIndex: 2, fileIndex: 1 }), {
			type: 'labels',
			layers: [layer('a', 'a1')],
			status: 'Layer names from test-model.',
		})

		expect(at(next)).toEqual([0, 0])
	})

	it('moves between layers and resets the file index', () => {
		expect(at(reducePanel(state({ fileIndex: 1 }), { type: 'next-layer' }))).toEqual([1, 0])
		expect(
			at(reducePanel(state({ layerIndex: 2, fileIndex: 1 }), { type: 'previous-layer' })),
		).toEqual([1, 0])
		expect(at(reducePanel(state({ layerIndex: 2 }), { type: 'next-layer' }))).toEqual([2, 0])
	})

	it('advances to the next unviewed file when the current one is marked viewed', () => {
		const next = reducePanel(state({ layerIndex: 0, fileIndex: 0 }), {
			type: 'viewed',
			paths: new Set(['a1']),
		})

		expect(at(next)).toEqual([0, 1])
		expect(next.toast).toBeUndefined()
	})

	it('advances to the next layer with a toast when a layer completes', () => {
		const next = reducePanel(
			state({ layerIndex: 0, fileIndex: 2, viewed: new Set(['a1', 'a2']) }),
			{
				type: 'viewed',
				paths: new Set(['a1', 'a2', 'a3']),
			},
		)

		expect(at(next)).toEqual([1, 0])
		expect(next.toast).toBe('Layer 1 done. Next: Layer b')
	})

	it('updates the viewed set without moving on a silent sync', () => {
		const next = reducePanel(
			state({ layerIndex: 0, fileIndex: 2, viewed: new Set(['a1', 'a2']) }),
			{ type: 'viewed', paths: new Set(['a1', 'a2', 'a3']), silent: true },
		)

		expect(at(next)).toEqual([0, 2])
		expect(next.viewed.has('a3')).toBe(true)
		expect(next.toast).toBeUndefined()
	})

	it('skips files already viewed in the next layer when a layer completes', () => {
		const next = reducePanel(
			state({ layerIndex: 0, fileIndex: 2, viewed: new Set(['a1', 'a2', 'b1', 'c1']) }),
			{ type: 'viewed', paths: new Set(['a1', 'a2', 'a3', 'b1', 'c1']) },
		)

		expect(at(next)).toEqual([2, 1])
		expect(next.toast).toBe('Layer 1 done. Next: Layer c')
	})

	it('keeps the position when the last layer completes and nothing is left', () => {
		const rest = ['a1', 'a2', 'a3', 'b1', 'c1']
		const next = reducePanel(state({ layerIndex: 2, fileIndex: 1, viewed: new Set(rest) }), {
			type: 'viewed',
			paths: new Set([...rest, 'c2']),
		})

		expect(at(next)).toEqual([2, 1])
		expect(next.toast).toBe('Layer 3 done. Every layer is reviewed.')
	})

	it('goes back to a skipped file when the last layer completes', () => {
		const next = reducePanel(
			state({ layerIndex: 2, fileIndex: 1, viewed: new Set(['a1', 'a3', 'b1', 'c1']) }),
			{ type: 'viewed', paths: new Set(['a1', 'a3', 'b1', 'c1', 'c2']) },
		)

		expect(at(next)).toEqual([0, 1])
		expect(next.toast).toBe('Layer 3 done. Next: Layer a')
	})

	it('never lands on a viewed file when a layer completes', () => {
		const next = reducePanel(
			state({ layerIndex: 0, fileIndex: 2, viewed: new Set(['a1', 'a2', 'b1', 'c1', 'c2']) }),
			{ type: 'viewed', paths: new Set(['a1', 'a2', 'a3', 'b1', 'c1', 'c2']) },
		)

		expect(at(next)).toEqual([0, 2])
		expect(next.toast).toBe('Layer 1 done. Every layer is reviewed.')
	})

	it('ignores a viewed set that did not change', () => {
		const current = state({ viewed: new Set(['a1']) })

		expect(reducePanel(current, { type: 'viewed', paths: new Set(['a1']) })).toBe(current)
	})

	it('toggles raw order and collapse without moving', () => {
		const raw = reducePanel(state({ layerIndex: 1 }), { type: 'toggle-raw' })

		expect(raw.isRaw).toBe(true)
		expect(at(raw)).toEqual([1, 0])
		expect(reducePanel(raw, { type: 'toggle-collapsed' }).isCollapsed).toBe(true)
	})

	it('skips the collapsed trailing layer on j and reaches it on n', () => {
		const last = state({ layers: TRAILING, layerIndex: 2, fileIndex: 1 })

		expect(at(reducePanel(last, { type: 'next-file' }))).toEqual([2, 1])
		expect(at(reducePanel(last, { type: 'next-layer' }))).toEqual([3, 0])
		expect(at(reducePanel({ ...last, isTrailingExpanded: true }, { type: 'next-file' }))).toEqual([
			3, 0,
		])
	})

	it('walks the trailing layer with j and k while it is current', () => {
		const inside = state({ layers: TRAILING, layerIndex: 3, fileIndex: 0 })

		expect(at(reducePanel(inside, { type: 'next-file' }))).toEqual([3, 1])
		expect(at(reducePanel(inside, { type: 'previous-file' }))).toEqual([2, 1])
	})

	it('skips a collapsed trailing layer when looking for the next unviewed file', () => {
		const current = state({ layers: TRAILING, layerIndex: 2, fileIndex: 1 })
		const expanded = reducePanel(current, { type: 'toggle-trailing' })
		const viewed = { type: 'viewed' as const, paths: new Set(['c2']) }

		expect(expanded.isTrailingExpanded).toBe(true)
		expect(at(reducePanel(current, viewed))).toEqual([0, 0])
		expect(at(reducePanel(expanded, viewed))).toEqual([3, 0])
	})

	it('moves into the trailing layer with a toast when the last code layer completes', () => {
		const next = reducePanel(
			state({ layers: TRAILING, layerIndex: 2, fileIndex: 0, viewed: new Set(['c2']) }),
			{ type: 'viewed', paths: new Set(['c1', 'c2']) },
		)

		expect(at(next)).toEqual([3, 0])
		expect(next.toast).toBe('Layer 3 done. Next: Layer g')
	})

	it('clamps a selection outside the layer', () => {
		expect(at(reducePanel(state(), { type: 'select', layerIndex: 9, fileIndex: 9 }))).toEqual([
			2, 1,
		])
	})
})

describe('createPanelStore', () => {
	it('restores a persisted position and saves every move', () => {
		const saved: PanelPosition[] = []
		const store = createPanelStore(LAYERS, {
			savePosition: (position) => saved.push(position),
			status: '',
		})
		store.dispatch({ type: 'next-file' })
		store.dispatch({ type: 'toggle-raw' })

		expect(saved.at(-1)).toEqual({ layerIndex: 0, fileIndex: 1, isRaw: true, isCollapsed: false })

		const restored = createPanelStore(LAYERS, {
			position: saved.at(-1),
			savePosition: () => undefined,
			status: '',
		})

		expect(currentFile(restored.getSnapshot())?.path).toBe('a2')
		expect(restored.getSnapshot().isRaw).toBe(true)
	})

	it('notifies subscribers and clears the toast after two seconds', () => {
		vi.useFakeTimers()
		const store = createPanelStore(LAYERS, { savePosition: () => undefined, status: '' })
		const listener = vi.fn()
		store.subscribe(listener)
		store.dispatch({ type: 'select', layerIndex: 0, fileIndex: 2 })
		store.dispatch({ type: 'viewed', paths: new Set(['a1', 'a2', 'a3']) })

		expect(store.getSnapshot().toast).toBe('Layer 1 done. Next: Layer b')
		expect(listener).toHaveBeenCalledTimes(2)

		vi.advanceTimersByTime(TOAST_MILLISECONDS)

		expect(store.getSnapshot().toast).toBeUndefined()
		vi.useRealTimers()
	})

	it('takes the page viewed state as the starting point instead of a completion', () => {
		const store = createPanelStore(LAYERS, {
			position: { layerIndex: 0, fileIndex: 2 },
			viewed: new Set(['a1', 'a2', 'a3']),
			savePosition: () => undefined,
			status: '',
		})
		store.dispatch({ type: 'viewed', paths: new Set(['a1', 'a2', 'a3']) })

		expect(at(store.getSnapshot())).toEqual([0, 2])
		expect(store.getSnapshot().toast).toBeUndefined()
	})

	it('restarts the dismiss timer for a second toast', () => {
		vi.useFakeTimers()
		const store = createPanelStore(LAYERS, { savePosition: () => undefined, status: '' })
		store.dispatch({ type: 'select', layerIndex: 0, fileIndex: 2 })
		store.dispatch({ type: 'viewed', paths: new Set(['a1', 'a2', 'a3']) })
		vi.advanceTimersByTime(TOAST_MILLISECONDS - 500)
		store.dispatch({ type: 'viewed', paths: new Set(['a1', 'a2', 'a3', 'b1']) })

		expect(store.getSnapshot().toast).toBe('Layer 2 done. Next: Layer c')

		vi.advanceTimersByTime(TOAST_MILLISECONDS - 500)

		expect(store.getSnapshot().toast).toBe('Layer 2 done. Next: Layer c')

		vi.advanceTimersByTime(500)

		expect(store.getSnapshot().toast).toBeUndefined()
		vi.useRealTimers()
	})
})
