import { describe, expect, it, vi } from 'vitest'
import type { FileRole } from '../layers/roles'
import {
	createPanelStore,
	currentFile,
	isLayerComplete,
	type PanelLayer,
	viewedCount,
} from './store'
import { hiddenTestPaths, hiddenTestsHint, withoutTests } from './test-filter'

const file = (path: string, role: FileRole = 'server') => ({
	path,
	role,
	additions: 1,
	deletions: 0,
})

const layer = (id: string, ...files: ReturnType<typeof file>[]): PanelLayer => ({
	id,
	name: id,
	summary: '',
	isTrailing: false,
	files,
})

const API = layer('api', file('api/a.ts'), file('api/a.spec.ts', 'test'), file('api/b.ts'))
const TESTS = layer('tests', file('e2e/flow.ts', 'test'), file('api/b.test.ts', 'test'))
const WEB = layer('web', file('web/page.tsx', 'ui'), file('web/page.test.tsx', 'test'))
const LAYERS = [API, TESTS, WEB]
const PRIORITY = [
	{
		...layer('urgent', file('api/a.spec.ts', 'test'), file('web/page.tsx', 'ui')),
		isCollapsible: true,
	},
	{ ...layer('low', file('api/a.ts'), file('e2e/flow.ts', 'test')), isCollapsible: true },
]

const paths = (layers: PanelLayer[]) => layers.map((entry) => entry.files.map((f) => f.path))
const storeOf = (
	options: Parameters<typeof createPanelStore>[1] = {
		status: '',
		savePosition: vi.fn(),
	},
) => createPanelStore(LAYERS, options)

describe('withoutTests', () => {
	it('drops test files and the layers left empty, keeping the others as they were', () => {
		const shown = withoutTests(LAYERS)
		expect(shown.map((entry) => entry.id)).toEqual(['api', 'web'])
		expect(paths(shown)).toEqual([['api/a.ts', 'api/b.ts'], ['web/page.tsx']])
		expect(shown[0]).toMatchObject({ name: 'api', summary: '', isTrailing: false })
	})

	it('returns the same layers when there is no test file to drop', () => {
		const layers = [layer('only', file('a.ts'))]
		expect(withoutTests(layers)).toBe(layers)
	})
})

describe('hiddenTestsHint', () => {
	it.each([
		[1, '1 test file hidden'],
		[12, '12 test files hidden'],
	])('says %i as "%s"', (count, text) => {
		expect(hiddenTestsHint(count)).toBe(text)
	})
})

describe('hide-tests in the panel store', () => {
	it('filters the layers on screen without touching the group layers', () => {
		const store = storeOf()
		store.dispatch({ type: 'hide-tests', isHiding: true })
		const state = store.getSnapshot()
		expect(state.isHidingTests).toBe(true)
		expect(paths(state.layers)).toEqual([['api/a.ts', 'api/b.ts'], ['web/page.tsx']])
		expect(state.groupLayers).toBe(LAYERS)
		expect([...hiddenTestPaths(state)].sort()).toEqual([
			'api/a.spec.ts',
			'api/b.test.ts',
			'e2e/flow.ts',
			'web/page.test.tsx',
		])

		store.dispatch({ type: 'hide-tests', isHiding: false })
		expect(store.getSnapshot().layers).toBe(LAYERS)
		expect(hiddenTestPaths(store.getSnapshot()).size).toBe(0)
	})

	it('ignores a dispatch that repeats the current filter', () => {
		const store = storeOf()
		const before = store.getSnapshot()
		store.dispatch({ type: 'hide-tests', isHiding: false })
		expect(store.getSnapshot()).toBe(before)
	})

	it('counts viewed files and completes layers over the shown files only', () => {
		const store = storeOf({
			status: '',
			savePosition: vi.fn(),
			viewed: new Set(['api/a.ts', 'api/b.ts']),
			isHidingTests: true,
		})
		const [api] = store.getSnapshot().layers
		expect(api && viewedCount(api, store.getSnapshot().viewed)).toBe(2)
		expect(api?.files).toHaveLength(2)
		expect(isLayerComplete(api, store.getSnapshot().viewed)).toBe(true)
	})

	it('walks j/k and n/p over shown files and layers only', () => {
		const store = storeOf({ status: '', savePosition: vi.fn(), isHidingTests: true })
		const walk: (string | undefined)[] = []
		for (let step = 0; step < 4; step += 1) {
			walk.push(currentFile(store.getSnapshot())?.path)
			store.dispatch({ type: 'next-file' })
		}
		expect(walk).toEqual(['api/a.ts', 'api/b.ts', 'web/page.tsx', 'web/page.tsx'])
		store.dispatch({ type: 'previous-layer' })
		expect(store.getSnapshot().layers[store.getSnapshot().layerIndex]?.id).toBe('api')
		store.dispatch({ type: 'next-layer' })
		expect(store.getSnapshot().layers[store.getSnapshot().layerIndex]?.id).toBe('web')
	})

	it('jumps to the next unviewed shown file when a layer is finished', () => {
		const store = storeOf({ status: '', savePosition: vi.fn(), isHidingTests: true })
		store.dispatch({ type: 'viewed', paths: new Set(['api/a.ts', 'api/b.ts']) })
		expect(currentFile(store.getSnapshot())?.path).toBe('web/page.tsx')
		expect(store.getSnapshot().toast).toBe('Layer 1 done. Next: web')
	})

	it('moves the cursor off a test file that is being hidden, then keeps it on show', () => {
		const store = storeOf({
			status: '',
			savePosition: vi.fn(),
			position: { layerIndex: 1, fileIndex: 0 },
		})
		expect(currentFile(store.getSnapshot())?.path).toBe('e2e/flow.ts')
		store.dispatch({ type: 'hide-tests', isHiding: true })
		expect(currentFile(store.getSnapshot())?.path).toBe('web/page.tsx')
		store.dispatch({ type: 'hide-tests', isHiding: false })
		expect(currentFile(store.getSnapshot())?.path).toBe('web/page.tsx')
	})

	it('falls back to the file before when no shown file follows', () => {
		const store = storeOf({
			status: '',
			savePosition: vi.fn(),
			position: { layerIndex: 2, fileIndex: 1 },
		})
		store.dispatch({ type: 'hide-tests', isHiding: true })
		expect(currentFile(store.getSnapshot())?.path).toBe('web/page.tsx')
	})

	it('keeps the selected shown file in place across the toggle', () => {
		const store = storeOf({
			status: '',
			savePosition: vi.fn(),
			position: { layerIndex: 2, fileIndex: 0 },
		})
		store.dispatch({ type: 'hide-tests', isHiding: true })
		expect(store.getSnapshot()).toMatchObject({ layerIndex: 1, fileIndex: 0 })
	})

	it('filters Priority Review sections and new labels while hiding', () => {
		const store = storeOf({
			status: '',
			savePosition: vi.fn(),
			priorityLayers: PRIORITY,
			isHidingTests: true,
		})
		store.dispatch({ type: 'set-mode', mode: 'priority' })
		expect(paths(store.getSnapshot().layers)).toEqual([['web/page.tsx'], ['api/a.ts']])
		store.dispatch({ type: 'set-mode', mode: 'files' })
		expect(paths(store.getSnapshot().layers)).toEqual([['web/page.tsx'], ['api/a.ts']])
		store.dispatch({ type: 'set-mode', mode: 'layers' })
		store.dispatch({
			type: 'labels',
			layers: [layer('all', file('api/a.ts'), file('api/a.spec.ts', 'test'))],
			status: 'Done.',
		})
		expect(paths(store.getSnapshot().layers)).toEqual([['api/a.ts']])
	})

	it('opens a folded priority section when the cursor moves off a hidden test into it', () => {
		const sections = [
			{
				...layer('folded', file('api/a.spec.ts', 'test'), file('api/a.ts')),
				isCollapsible: true,
			},
		]
		const store = storeOf({
			status: '',
			savePosition: vi.fn(),
			priorityLayers: sections,
			position: { isPriority: true },
		})
		store.dispatch({ type: 'toggle-section', id: 'folded' })
		expect(store.getSnapshot().collapsedSections.has('folded')).toBe(true)
		store.dispatch({ type: 'hide-tests', isHiding: true })
		expect(currentFile(store.getSnapshot())?.path).toBe('api/a.ts')
		expect(store.getSnapshot().collapsedSections.has('folded')).toBe(false)
	})

	it('does not save a position change caused only by filtering out other layers', () => {
		const savePosition = vi.fn()
		const store = storeOf({ status: '', savePosition })
		store.dispatch({ type: 'hide-tests', isHiding: true })
		expect(savePosition).not.toHaveBeenCalled()
	})
})
