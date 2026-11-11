// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	CANCEL,
	COMMAND,
	ENV,
	ENV_ANCHOR,
	HANDLER,
	HANDLER_SPEC,
	HANDLER_SPEC_ANCHOR,
	LAYERS,
	loadChangesPage,
	nativeTree,
} from '../../test/changes-page'
import { createPanelStore, type PanelLayer, type PanelStore } from '../panel/store'
import { createDiffView } from './diffs'
import { HIDE_TESTS_LABEL, TOGGLE_ID } from './mode-toggle'
import { findDiffsList, type TreeTemplates } from './native'
import { createTreeView, TREE_ID, type TreeHandlers } from './render'

let anchorIds: Map<string, string>
let templates: TreeTemplates
let handlers: TreeHandlers
let store: PanelStore

const ourList = () => document.querySelector(`#${TREE_ID} ul[role="tree"]`) as HTMLUListElement
const rowOf = (path: string) => ourList().querySelector(`li[data-path="${path}"]`)
const sectionOf = (id: string) => ourList().querySelector(`:scope > li[data-layer="${id}"]`)
const countOf = (id: string) => sectionOf(id)?.querySelector('[data-detent-count]')?.textContent
const hint = () => document.querySelector<HTMLElement>(`#${TREE_ID} [data-detent-hint]`)
const testsButton = () =>
	document.querySelector<HTMLButtonElement>(`#${TOGGLE_ID} button[data-detent-tests]`)
const nativeRow = (id: string) => document.getElementById(id) as HTMLElement
const entryOf = (anchor: string) => document.getElementById(anchor)?.parentElement

const PRIORITY: PanelLayer[] = [
	{
		id: 'priority:urgent',
		name: 'Urgent',
		summary: '',
		isTrailing: false,
		isCollapsible: true,
		files: [HANDLER_SPEC, HANDLER].map((path) => ({
			path,
			role: path === HANDLER_SPEC ? 'test' : 'server',
			additions: 1,
			deletions: 0,
		})),
	},
	{
		id: 'priority:low',
		name: 'Low',
		summary: '',
		isTrailing: false,
		isCollapsible: true,
		files: [ENV, COMMAND, CANCEL].map((path) => ({
			path,
			role: 'server',
			additions: 1,
			deletions: 0,
		})),
	},
]

beforeEach(async () => {
	;({ anchorIds, templates } = await loadChangesPage())
	handlers = {
		onSelect: vi.fn(),
		onToggleTrailing: vi.fn(),
		onToggleSection: vi.fn(),
		onSetMode: vi.fn(),
		onToggleTests: vi.fn(),
	}
	store = createPanelStore(LAYERS, {
		status: 'Ready',
		savePosition: vi.fn(),
		priorityLayers: PRIORITY,
		viewed: new Set([COMMAND]),
	})
})

describe('Hide tests in the tree', () => {
	it('keeps every file, an off switch and no hint while tests are shown', () => {
		createTreeView(templates, anchorIds, handlers).apply(nativeTree(), store.getSnapshot())
		expect(rowOf(HANDLER_SPEC)).not.toBeNull()
		expect(countOf('billing')).toBe('1/4')
		expect(hint()?.hidden).toBe(true)
		expect(testsButton()?.getAttribute('aria-pressed')).toBe('false')
		expect(testsButton()?.getAttribute('aria-label')).toBe(HIDE_TESTS_LABEL)
		expect(testsButton()?.type).toBe('button')
	})

	it('drops test rows in Layers mode, counts shown files only and offers to show them again', () => {
		const view = createTreeView(templates, anchorIds, handlers)
		store.dispatch({ type: 'hide-tests', isHiding: true })
		view.apply(nativeTree(), store.getSnapshot())
		expect(rowOf(HANDLER_SPEC)).toBeNull()
		expect(rowOf(HANDLER)).not.toBeNull()
		expect(countOf('billing')).toBe('1/3')
		expect(testsButton()?.getAttribute('aria-pressed')).toBe('true')
		expect(testsButton()?.dataset.variant).toBe('default')
		expect(hint()?.hidden).toBe(false)
		expect(hint()?.textContent).toBe('1 test file hiddenShow')
		hint()?.querySelector('button')?.click()
		testsButton()?.click()
		expect(handlers.onToggleTests).toHaveBeenCalledTimes(2)

		store.dispatch({ type: 'hide-tests', isHiding: false })
		view.apply(nativeTree(), store.getSnapshot())
		expect(rowOf(HANDLER_SPEC)).not.toBeNull()
		expect(countOf('billing')).toBe('1/4')
		expect(hint()?.hidden).toBe(true)
		expect(testsButton()?.getAttribute('aria-pressed')).toBe('false')
	})

	it('drops a layer that only held tests', () => {
		const tests: PanelLayer = {
			id: 'tests',
			name: 'Tests',
			summary: '',
			isTrailing: false,
			files: [{ path: HANDLER_SPEC, role: 'test', additions: 1, deletions: 0 }],
		}
		const layers = [LAYERS[0] as PanelLayer, tests]
		store = createPanelStore(layers, { status: '', savePosition: vi.fn(), isHidingTests: true })
		createTreeView(templates, anchorIds, handlers).apply(nativeTree(), store.getSnapshot())
		expect(sectionOf('env')).not.toBeNull()
		expect(sectionOf('tests')).toBeNull()
	})

	it('drops test rows from Priority Review sections', () => {
		const view = createTreeView(templates, anchorIds, handlers)
		store.dispatch({ type: 'set-mode', mode: 'priority' })
		store.dispatch({ type: 'hide-tests', isHiding: true })
		view.apply(nativeTree(), store.getSnapshot())
		expect(store.getSnapshot().isPriority).toBe(true)
		expect(rowOf(HANDLER_SPEC)).toBeNull()
		expect(rowOf(HANDLER)).not.toBeNull()
		expect(countOf('priority:urgent')).toBe('0/1')
		expect(hint()?.textContent).toContain('1 test file hidden')
	})

	it('hides GitHub tree rows of hidden tests in Files mode and restores them', () => {
		const view = createTreeView(templates, anchorIds, handlers)
		store.dispatch({ type: 'set-mode', mode: 'files' })
		store.dispatch({ type: 'hide-tests', isHiding: true })
		view.apply(nativeTree(), store.getSnapshot())
		expect(nativeTree().style.display).toBe('')
		expect(nativeRow(HANDLER_SPEC).style.display).toBe('none')
		expect(nativeRow(HANDLER).style.display).toBe('')
		expect(nativeRow(ENV).style.display).toBe('')
		expect(hint()?.hidden).toBe(false)

		store.dispatch({ type: 'hide-tests', isHiding: false })
		view.apply(nativeTree(), store.getSnapshot())
		expect(nativeRow(HANDLER_SPEC).style.display).toBe('')
	})

	it('hides a GitHub directory row with nothing but hidden tests left in it', () => {
		const layers: PanelLayer[] = LAYERS.map((layer) => ({
			...layer,
			files: layer.files.map((file) =>
				file.path === ENV ? { ...file, role: 'test' as const } : file,
			),
		}))
		store = createPanelStore(layers, {
			status: '',
			savePosition: vi.fn(),
			position: { isRaw: true },
			isHidingTests: true,
		})
		const view = createTreeView(templates, anchorIds, handlers)
		view.apply(nativeTree(), store.getSnapshot())
		expect(nativeRow(ENV).style.display).toBe('none')
		expect(nativeRow('apps/api/src/config/env').style.display).toBe('none')
		expect(nativeRow('apps/api/src').style.display).toBe('')
		expect(nativeRow('apps/api/src/modules/billing').style.display).toBe('')

		view.detach()
		expect(nativeRow(ENV).style.display).toBe('')
		expect(nativeRow('apps/api/src/config/env').style.display).toBe('')
	})
})

describe('Hide tests on the Changes page diffs', () => {
	it('takes hidden test diffs off the page in every mode and puts them back', () => {
		const diffs = createDiffView(anchorIds)
		const list = findDiffsList() as HTMLElement
		store.dispatch({ type: 'hide-tests', isHiding: true })
		diffs.apply(list, store.getSnapshot())
		expect(entryOf(HANDLER_SPEC_ANCHOR)?.style.display).toBe('none')
		expect(entryOf(ENV_ANCHOR)?.style.display).toBe('')

		store.dispatch({ type: 'set-mode', mode: 'files' })
		diffs.apply(list, store.getSnapshot())
		expect(entryOf(HANDLER_SPEC_ANCHOR)?.style.display).toBe('none')

		store.dispatch({ type: 'hide-tests', isHiding: false })
		diffs.apply(list, store.getSnapshot())
		expect(entryOf(HANDLER_SPEC_ANCHOR)?.style.display).toBe('')

		store.dispatch({ type: 'hide-tests', isHiding: true })
		diffs.apply(list, store.getSnapshot())
		diffs.detach()
		expect(entryOf(HANDLER_SPEC_ANCHOR)?.style.display).toBe('')
	})

	it('counts only shown files in the layer header', () => {
		const diffs = createDiffView(anchorIds)
		const list = findDiffsList() as HTMLElement
		store.dispatch({ type: 'hide-tests', isHiding: true })
		diffs.apply(list, store.getSnapshot())
		const header = list.querySelector('[data-detent-section="billing"]')
		expect(header?.firstElementChild?.lastElementChild?.textContent).toBe('1/3')
		diffs.detach()
	})
})
