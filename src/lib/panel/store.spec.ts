import { describe, expect, it, vi } from 'vitest'
import {
	createPanelStore,
	currentFile,
	type PanelLayer,
	type PanelPosition,
	type PanelState,
	reducePanel,
	statusOf,
	TOAST_MILLISECONDS,
	viewModeOf,
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
	groupLayers: LAYERS,
	priorityLayers: [],
	layerIndex: 0,
	fileIndex: 0,
	isRaw: false,
	isCollapsed: false,
	isPriority: false,
	viewed: new Set(),
	status: 'Layer names come from the file structure.',
	priorityStatus: '',
	collapsedSections: new Set(),
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

		expect(saved.at(-1)).toEqual({
			layerIndex: 0,
			fileIndex: 1,
			isRaw: true,
			isCollapsed: false,
			isPriority: false,
		})

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

describe('Priority Review', () => {
	const section = (name: string, ...paths: string[]): PanelLayer => ({
		...layer(name.toLowerCase(), ...paths),
		id: `priority:${name.toLowerCase()}`,
		name,
		isCollapsible: true,
	})
	const PRIORITY = [section('Urgent', 'c2', 'a2'), section('High', 'b1'), section('Low', 'a1')]
	const options = {
		savePosition: () => undefined,
		status: 'Layer names come from the file structure.',
		priorityLayers: PRIORITY,
		priorityStatus: 'Priorities come from the file structure.',
		collapsedSections: ['priority:low'],
	}

	it('switches between layers, priorities and files, keeping the current file', () => {
		const saved: PanelPosition[] = []
		const store = createPanelStore(LAYERS, {
			...options,
			savePosition: (position) => saved.push(position),
		})
		store.dispatch({ type: 'select', layerIndex: 0, fileIndex: 1 })
		store.dispatch({ type: 'set-mode', mode: 'priority' })

		expect(store.getSnapshot().layers).toBe(PRIORITY)
		expect(currentFile(store.getSnapshot())?.path).toBe('a2')
		expect(viewModeOf(store.getSnapshot())).toBe('priority')
		expect(statusOf(store.getSnapshot())).toBe('Priorities come from the file structure.')
		expect(saved.at(-1)).toMatchObject({ isPriority: true, isRaw: false, layerIndex: 0 })

		store.dispatch({ type: 'set-mode', mode: 'files' })
		expect(viewModeOf(store.getSnapshot())).toBe('files')
		expect(statusOf(store.getSnapshot())).toBe('Layer names come from the file structure.')
		store.dispatch({ type: 'toggle-raw' })
		expect(viewModeOf(store.getSnapshot())).toBe('priority')

		store.dispatch({ type: 'set-mode', mode: 'layers' })
		expect(store.getSnapshot().layers).toBe(LAYERS)
		expect(currentFile(store.getSnapshot())?.path).toBe('a2')
	})

	it('restores Priority Review only where priority sections are offered', () => {
		const position = { layerIndex: 1, fileIndex: 0, isPriority: true }
		const restored = createPanelStore(LAYERS, { ...options, position })
		const classic = createPanelStore(LAYERS, {
			savePosition: () => undefined,
			status: '',
			position,
		})

		expect(currentFile(restored.getSnapshot())?.path).toBe('b1')
		expect(classic.getSnapshot()).toMatchObject({ isPriority: false, layers: LAYERS })
	})

	it('keeps new groups and new priorities apart and shows only those of the current mode', () => {
		const store = createPanelStore(LAYERS, { ...options, position: { isPriority: true } })
		const regrouped = [layer('z', 'a1', 'a2', 'a3', 'b1', 'c1', 'c2')]
		store.dispatch({ type: 'labels', layers: regrouped, status: 'Layer names from m.' })

		expect(store.getSnapshot()).toMatchObject({ layers: PRIORITY, groupLayers: regrouped })

		const ranked = [section('Urgent', 'b1')]
		store.dispatch({ type: 'priorities', layers: ranked, status: 'Priorities from m.' })
		expect(store.getSnapshot()).toMatchObject({
			layers: ranked,
			priorityStatus: 'Priorities from m.',
		})
		store.dispatch({ type: 'set-mode', mode: 'layers' })
		expect(store.getSnapshot().layers).toBe(regrouped)
	})

	it('keeps a folded current section folded until j moves within it, then unfolds it', () => {
		const store = createPanelStore(LAYERS, {
			...options,
			position: { isPriority: true, layerIndex: 0, fileIndex: 0 },
		})
		store.dispatch({ type: 'toggle-section', id: 'priority:urgent' })
		expect(store.getSnapshot().collapsedSections).toEqual(
			new Set(['priority:low', 'priority:urgent']),
		)
		expect(currentFile(store.getSnapshot())?.path).toBe('c2')

		store.dispatch({ type: 'next-file' })
		expect(currentFile(store.getSnapshot())?.path).toBe('a2')
		expect(store.getSnapshot().collapsedSections).toEqual(new Set(['priority:low']))

		store.dispatch({ type: 'next-file' })
		store.dispatch({ type: 'next-file' })
		expect(currentFile(store.getSnapshot())?.path).toBe('a1')
		expect(store.getSnapshot().collapsedSections.size).toBe(0)
	})

	it('names the finished priority in the toast and unfolds the section it moves to', () => {
		const next = reducePanel(
			state({
				layers: PRIORITY,
				priorityLayers: PRIORITY,
				isPriority: true,
				layerIndex: 1,
				collapsedSections: new Set(['priority:low']),
			}),
			{ type: 'viewed', paths: new Set(['b1']) },
		)

		expect(next.toast).toBe('High done. Next: Low')
		expect(next.collapsedSections.size).toBe(0)
	})

	it.each(['layers', 'priority'] as const)(
		'r returns from Files to the previous %s mode without moving',
		(mode) => {
			const store = createPanelStore(LAYERS, options)
			store.dispatch({ type: 'select', layerIndex: 0, fileIndex: 1 })
			store.dispatch({ type: 'set-mode', mode })
			for (const expected of ['files', mode]) {
				store.dispatch({ type: 'toggle-raw' })
				expect(viewModeOf(store.getSnapshot())).toBe(expected)
				expect(currentFile(store.getSnapshot())?.path).toBe('a2')
			}
		},
	)

	it('preserves the selected path through every directed mode transition', () => {
		const store = createPanelStore(LAYERS, options)
		store.dispatch({ type: 'select', layerIndex: 0, fileIndex: 1 })
		for (const mode of ['priority', 'files', 'layers', 'files', 'priority', 'layers'] as const) {
			store.dispatch({ type: 'set-mode', mode })
			expect(viewModeOf(store.getSnapshot())).toBe(mode)
			expect(currentFile(store.getSnapshot())?.path).toBe('a2')
		}
	})

	it('unfolds Low when changing modes puts the selected file inside it', () => {
		const store = createPanelStore(LAYERS, options)
		store.dispatch({ type: 'set-mode', mode: 'priority' })
		expect(currentFile(store.getSnapshot())?.path).toBe('a1')
		expect(store.getSnapshot().collapsedSections.has('priority:low')).toBe(false)
	})

	it.each([
		['next-file', 1, 'priority:low', 'a1'],
		['previous-file', 1, 'priority:urgent', 'a2'],
	] as const)(
		'%s enters and unfolds a folded priority section',
		(type, layerIndex, folded, expectedPath) => {
			const store = createPanelStore(LAYERS, {
				...options,
				collapsedSections: [folded],
				position: { isPriority: true, layerIndex },
			})
			store.dispatch({ type })
			expect(currentFile(store.getSnapshot())?.path).toBe(expectedPath)
			expect(store.getSnapshot().collapsedSections.has(folded)).toBe(false)
		},
	)

	it.each([
		['next-layer', 1, 'priority:low', 'a1'],
		['previous-layer', 1, 'priority:urgent', 'c2'],
	] as const)('%s unfolds the section it enters', (type, layerIndex, folded, expectedPath) => {
		const store = createPanelStore(LAYERS, {
			...options,
			collapsedSections: [folded],
			position: { isPriority: true, layerIndex },
		})
		store.dispatch({ type })
		expect(currentFile(store.getSnapshot())?.path).toBe(expectedPath)
		expect(store.getSnapshot().collapsedSections.has(folded)).toBe(false)
	})
})
