// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	CANCEL,
	COMMAND,
	ENV,
	HANDLER,
	HANDLER_SPEC,
	LOCK,
	loadChangesPage,
	nativeTree,
	pageState,
} from '../../test/changes-page'
import type { PanelLayer } from '../panel/store'
import { TOGGLE_ID } from './mode-toggle'
import type { TreeTemplates } from './native'
import { createTreeView, TREE_ID, type TreeHandlers } from './render'

let anchorIds: Map<string, string>
let templates: TreeTemplates
let handlers: TreeHandlers

const ourList = () =>
	document.querySelector<HTMLUListElement>(`#${TREE_ID} ul[role="tree"]`) as HTMLUListElement

const rowOf = (path: string) =>
	ourList().querySelector<HTMLLIElement>(`li[data-path="${path}"]`) as HTMLLIElement

const folderOf = (path: string) =>
	ourList().querySelector<HTMLLIElement>(`li[data-folder="${path}"]`) as HTMLLIElement

const label = (row: Element | null | undefined) =>
	row?.querySelector(':scope > [style*="--level"] [class*="content-text"]')?.textContent

const mixedLayer = (): PanelLayer => ({
	id: 'mixed',
	name: 'Mixed',
	summary: '',
	isTrailing: false,
	files: [LOCK, COMMAND, ENV, HANDLER].map((path) => ({
		path,
		role: 'other',
		additions: 1,
		deletions: 0,
	})),
})

const footer = () => document.querySelector(`#${TREE_ID} .fgColor-muted.f6.px-2`)?.textContent

beforeEach(async () => {
	;({ anchorIds, templates } = await loadChangesPage())
	handlers = {
		onSelect: vi.fn(),
		onToggleTrailing: vi.fn(),
		onToggleSection: vi.fn(),
		onSetMode: vi.fn(),
	}
})

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('createTreeView', () => {
	it('updates priority viewed/total counts in both open and folded sections without replacing rows', () => {
		const section = (name: string, paths: string[]): PanelLayer => ({
			id: `priority:${name.toLowerCase()}`,
			name,
			summary: '',
			isTrailing: false,
			isCollapsible: true,
			files: paths.map((path) => ({ path, role: 'other', additions: 3, deletions: 0 })),
		})
		const sections = [section('Urgent', [HANDLER, ENV]), section('Low', [HANDLER_SPEC, LOCK])]
		const state = pageState({
			layers: sections,
			priorityLayers: sections,
			isPriority: true,
			layerIndex: 0,
			fileIndex: 0,
			collapsedSections: new Set(['priority:low']),
			viewed: new Set<string>(),
			priorityStatus: 'Priorities from model · $0.01.',
		})
		const view = createTreeView(templates, anchorIds, handlers)
		view.apply(nativeTree(), state)
		const rows = [...ourList().querySelectorAll(':scope > li')]
		view.apply(nativeTree(), { ...state, viewed: new Set([HANDLER, HANDLER_SPEC, LOCK]) })
		expect([...ourList().querySelectorAll(':scope > li')]).toEqual(rows)
		expect(rows.map((row) => row.querySelector('[data-detent-count]')?.textContent)).toEqual([
			'1/2',
			'2/2',
		])
		expect(rows.map((row) => row.getAttribute('aria-expanded'))).toEqual(['true', 'false'])
		expect(rows[1]?.querySelector('[data-detent-check]')).not.toBeNull()
		expect(footer()).toBe('Priorities from model · $0.01.')
		view.detach()
	})

	it('hides the native tree and renders sections and files after it in GitHub markup', () => {
		createTreeView(templates, anchorIds, handlers).apply(nativeTree(), pageState())

		expect(nativeTree().style.display).toBe('none')
		expect(nativeTree().nextElementSibling?.id).toBe(TREE_ID)
		expect(ourList().className).toBe(nativeTree().className)
		const sections = [...ourList().querySelectorAll<HTMLElement>(':scope > li')]
		expect(sections.map((row) => row.getAttribute('aria-level'))).toEqual(['1', '1', '1'])
		expect(
			sections.map((row) => row.querySelector('[class*="content-text"]')?.textContent),
		).toEqual(['Extend the environment schema', 'Record lifecycle analytics', 'Generated'])
		expect(sections.map((row) => row.querySelector('.f6')?.textContent)).toEqual([
			'0/1',
			'1/4',
			'0/1',
		])
		expect(sections.map((row) => row.getAttribute('aria-expanded'))).toEqual([
			'true',
			'true',
			'false',
		])
		expect(sections[1]?.hasAttribute('aria-current')).toBe(true)
		expect(sections[2]?.querySelector('ul')).toBeNull()
		const files = [...ourList().querySelectorAll<HTMLElement>('li[data-path]')]
		expect(files.map((row) => row.querySelector('a')?.getAttribute('href'))).toEqual(
			[ENV, COMMAND, HANDLER, CANCEL, HANDLER_SPEC].map((path) => `#${anchorIds.get(path)}`),
		)
		expect(rowOf(ENV).getAttribute('aria-level')).toBe('3')
		expect(rowOf(ENV).querySelectorAll('[class*="level-line"]')).toHaveLength(2)
		expect(rowOf(LOCK)).toBeNull()
		expect(rowOf(ENV).getAttribute('aria-label')).toBe('env.schema.ts')
		expect(rowOf(ENV).querySelector('a')?.title).toBe(ENV)
		expect(footer()).toBe('Layer names come from the file structure.')
	})

	it('places wrapping summaries below the fixed native row, before its files', () => {
		createTreeView(templates, anchorIds, handlers).apply(nativeTree(), pageState())
		const row = ourList().querySelector(':scope > li')
		const box = row?.querySelector<HTMLElement>('[style*="--level"]')
		const summary = box?.nextElementSibling

		expect(box?.textContent).not.toContain('Check the new variables first.')
		expect(box?.style.height).toBe('')
		expect(summary?.textContent).toBe('Check the new variables first.')
		expect(summary?.nextElementSibling?.getAttribute('role')).toBe('group')
		expect(summary?.querySelector('[class*="item-visual"]')?.textContent).toBe('')
		expect(summary?.querySelector('[class*="item-toggle"]')?.textContent).toBe('')
	})

	it('uses small Primer buttons and switches their variants with the selected mode', () => {
		const view = createTreeView(templates, anchorIds, handlers)
		view.apply(nativeTree(), pageState())
		const buttons = [...document.querySelectorAll<HTMLButtonElement>(`#${TOGGLE_ID} button`)]
		expect(buttons.map((button) => button.textContent)).toEqual(['Layers', 'Priority', 'Files'])
		expect(buttons.map((button) => button.dataset.size)).toEqual(['small', 'small', 'small'])
		expect(buttons.map((button) => button.dataset.variant)).toEqual([
			'default',
			'invisible',
			'invisible',
		])
		for (const button of buttons) expect(button.className).toContain('prc-Button-ButtonBase')
		view.apply(nativeTree(), pageState({ isRaw: true }))
		expect(buttons.map((button) => button.dataset.variant)).toEqual([
			'invisible',
			'invisible',
			'default',
		])
	})

	it('patches ticks and counts in place instead of rebuilding rows', () => {
		const view = createTreeView(templates, anchorIds, handlers)
		const state = pageState({ layerIndex: 0, viewed: new Set() })
		view.apply(nativeTree(), state)
		const envRow = rowOf(ENV)
		const section = ourList().querySelector('li[data-layer="env"]')
		expect(section?.querySelector('[data-detent-count]')?.textContent).toBe('0/1')

		view.apply(nativeTree(), { ...state, viewed: new Set([ENV]) })
		expect(rowOf(ENV)).toBe(envRow)
		expect(envRow.querySelector('a')?.className).toContain('fgColor-muted')
		expect(section?.querySelector('[data-detent-count]')?.textContent).toBe('1/1')
		expect(section?.querySelector('[data-detent-check]')).not.toBeNull()

		view.apply(nativeTree(), { ...state, viewed: new Set() })
		expect(rowOf(ENV)).toBe(envRow)
		expect(envRow.querySelector('a')?.className).not.toContain('fgColor-muted')
		expect(section?.querySelector('[data-detent-check]')).toBeNull()
	})

	it('keeps the Layers/Files toggle above the native tree and copies each file its own status icon', () => {
		const native = nativeTree()
		const icons = new Map([
			[ENV, 'fgColor-success'],
			[COMMAND, 'fgColor-attention'],
		])
		for (const [path, className] of icons) {
			const visual = native.querySelector(`li[id="${path}"] [class*="item-visual"]`)
			visual?.replaceChildren(Object.assign(document.createElement('svg'), { className }))
		}
		const view = createTreeView(templates, anchorIds, handlers)
		const state = pageState()
		view.apply(native, state)
		expect(document.getElementById(TOGGLE_ID)?.nextElementSibling).toBe(native)
		const originalRows = new Map([...icons.keys()].map((path) => [path, rowOf(path)]))

		view.apply(native, { ...state, layers: [...state.layers] })
		for (const [path, className] of icons) {
			expect(rowOf(path)).not.toBe(originalRows.get(path))
			expect(rowOf(path).querySelector('[class*="item-visual"] svg')?.getAttribute('class')).toBe(
				className,
			)
		}
	})

	it('marks files worth a careful read with an accent dot', () => {
		const state = pageState()
		const [first] = state.layers
		if (!first) throw new Error('fixture layer missing')
		const layers = [
			{ ...first, files: first.files.map((file) => ({ ...file, isFocus: true })) },
			...state.layers.slice(1),
		]
		createTreeView(templates, anchorIds, handlers).apply(nativeTree(), { ...state, layers })
		expect(rowOf(ENV).querySelector('[data-detent-focus]')?.textContent).toBe('●')
		expect(rowOf(ENV).querySelector('a')?.title).toContain('Worth a careful read')
		expect(rowOf(COMMAND).querySelector('[data-detent-focus]')).toBeNull()
	})

	it('marks the current row selected and viewed rows muted', () => {
		createTreeView(templates, anchorIds, handlers).apply(nativeTree(), pageState())

		expect(rowOf(HANDLER).getAttribute('aria-selected')).toBe('true')
		expect(rowOf(HANDLER).firstElementChild?.classList.contains('bg-neutral-muted')).toBe(true)
		expect(rowOf(COMMAND).getAttribute('aria-selected')).toBe('false')
		expect(rowOf(COMMAND).querySelector('a')?.classList.contains('fgColor-muted')).toBe(true)
		expect(rowOf(HANDLER).querySelector('a')?.classList.contains('fgColor-default')).toBe(true)
	})

	it('moves selection within and between layers without replacing rows', () => {
		const view = createTreeView(templates, anchorIds, handlers)
		const state = pageState()
		view.apply(nativeTree(), state)
		const rows = [...ourList().querySelectorAll('li[role="treeitem"]')]

		for (const [layerIndex, fileIndex, path, layer] of [
			[1, 2, CANCEL, 'billing'],
			[0, 0, ENV, 'env'],
		] as const) {
			view.apply(nativeTree(), { ...state, layerIndex, fileIndex })

			const updated = [...ourList().querySelectorAll('li[role="treeitem"]')]
			expect(updated).toHaveLength(rows.length)
			for (const [index, row] of updated.entries()) expect(row).toBe(rows[index])
			expect([...ourList().querySelectorAll('[aria-selected="true"]')]).toEqual([rowOf(path)])
			expect([...ourList().querySelectorAll('.bg-neutral-muted')]).toEqual([
				rowOf(path).firstElementChild,
			])
			expect(
				[...ourList().querySelectorAll<HTMLElement>(':scope > li[aria-current]')].map(
					(row) => row.dataset.layer,
				),
			).toEqual([layer])
		}
	})

	it('rebuilds rows and opens the collapsed trailing layer when it is selected', () => {
		const view = createTreeView(templates, anchorIds, handlers)
		const state = pageState()
		view.apply(nativeTree(), state)
		const rows = [...ourList().querySelectorAll('li[role="treeitem"]')]
		const trailing = ourList().querySelector('li[data-layer="generated"]')
		expect(trailing?.getAttribute('aria-expanded')).toBe('false')
		expect(trailing?.querySelector('[role="group"]')).toBeNull()
		expect(rowOf(LOCK)).toBeNull()

		view.apply(nativeTree(), { ...state, layerIndex: 2, fileIndex: 0 })

		for (const row of rows) expect(ourList().contains(row)).toBe(false)
		const expanded = ourList().querySelector('li[data-layer="generated"]')
		expect(expanded?.getAttribute('aria-expanded')).toBe('true')
		expect(expanded?.hasAttribute('aria-current')).toBe(true)
		expect(expanded?.querySelector('[role="group"]')?.contains(rowOf(LOCK))).toBe(true)
		expect(rowOf(LOCK).getAttribute('aria-selected')).toBe('true')
		expect(rowOf(LOCK).firstElementChild?.classList.contains('bg-neutral-muted')).toBe(true)
	})

	it('checks a completed section and shows the toast in the footer', () => {
		createTreeView(templates, anchorIds, handlers).apply(
			nativeTree(),
			pageState({
				viewed: new Set([ENV]),
				toast: 'Layer 1 done. Next: Record lifecycle analytics',
			}),
		)
		const first = ourList().querySelector(':scope > li') as HTMLElement

		expect(first.querySelector('[class*="item-visual"]')?.textContent).toBe('✓')
		expect(footer()).toBe('Layer 1 done. Next: Record lifecycle analytics')
	})

	it('reports clicks on rows, the trailing chevron and the toggle', () => {
		createTreeView(templates, anchorIds, handlers).apply(nativeTree(), pageState())
		rowOf(CANCEL).click()
		;(ourList().querySelector(':scope > li') as HTMLElement).click()
		;(
			ourList().querySelector('li[data-layer="generated"] [class*="item-toggle"]') as HTMLElement
		).click()
		;(document.querySelector(`#${TOGGLE_ID} button[data-mode="files"]`) as HTMLElement).click()

		expect(handlers.onSelect).toHaveBeenNthCalledWith(1, 1, 2)
		expect(handlers.onSelect).toHaveBeenNthCalledWith(2, 0, 0)
		expect(handlers.onSelect).toHaveBeenCalledTimes(2)
		expect(handlers.onToggleTrailing).toHaveBeenCalledTimes(1)
		expect(handlers.onSetMode).toHaveBeenCalledWith('files')
	})

	it('applies the GitHub filter box to the layers by keeping the anchors left in the native tree', () => {
		const input = document.createElement('input')
		input.setAttribute('aria-label', 'Filter files…')
		document.body.prepend(input)
		const view = createTreeView(templates, anchorIds, handlers)
		view.apply(nativeTree(), pageState())
		expect(ourList().querySelectorAll('li[data-path]')).toHaveLength(5)

		input.value = 'env'
		for (const anchor of nativeTree().querySelectorAll('a[href^="#diff-"]'))
			if (anchor.getAttribute('href') !== `#${anchorIds.get(ENV)}`) anchor.remove()
		view.apply(nativeTree(), pageState())
		expect(
			[...ourList().querySelectorAll<HTMLLIElement>('li[data-path]')].map(
				(row) => row.dataset.path,
			),
		).toEqual([ENV])
		expect(ourList().querySelectorAll('li[data-layer]')).toHaveLength(1)

		for (const anchor of nativeTree().querySelectorAll('a[href^="#diff-"]')) anchor.remove()
		view.apply(nativeTree(), pageState())
		expect(ourList().querySelectorAll('li[data-layer]')).toHaveLength(0)
		expect(footer()).toBe('No files match the filter.')

		input.value = ''
		view.apply(nativeTree(), pageState())
		expect(ourList().querySelectorAll('li[data-path]')).toHaveLength(5)
		input.remove()
	})

	it('nests the files of each layer under folder rows with growing levels', () => {
		createTreeView(templates, anchorIds, handlers).apply(nativeTree(), pageState())
		const commands = 'apps/api/src/modules/billing/application/commands'

		const billing = ourList().querySelector('li[data-layer="billing"] > ul[role="group"]')
		const folders = [...(billing?.querySelectorAll<HTMLLIElement>('li[data-folder]') ?? [])]
		expect(folders.map((row) => row.dataset.folder)).toEqual([commands])
		const folder = folderOf(commands)
		expect(folder.parentElement).toBe(billing)
		expect(folder.getAttribute('aria-level')).toBe('2')
		expect(folder.getAttribute('aria-expanded')).toBe('true')
		expect(folder.querySelector('[class*="directory-icon"]')).not.toBeNull()
		expect(
			folder.querySelectorAll(':scope > [style*="--level"] [class*="level-line"]'),
		).toHaveLength(1)
		expect(label(folder)).toBe(commands)
		const files = [...folder.querySelectorAll<HTMLLIElement>(':scope > ul > li[data-path]')]
		expect(files.map((row) => row.dataset.path)).toEqual([COMMAND, HANDLER, CANCEL, HANDLER_SPEC])
		for (const row of files) expect(row.getAttribute('aria-level')).toBe('3')
	})

	it('compresses single-child folder chains and groups files of a folder under one row', () => {
		const state = pageState({ layers: [mixedLayer()], layerIndex: 0, fileIndex: 0 })
		createTreeView(templates, anchorIds, handlers).apply(nativeTree(), state)
		const section = ourList().querySelector('li[data-layer="mixed"] > ul[role="group"]')

		const top = [...(section?.children ?? [])] as HTMLLIElement[]
		expect(top.map((row) => row.dataset.folder ?? row.dataset.path)).toEqual(['apps/api/src', LOCK])
		expect(rowOf(LOCK).getAttribute('aria-level')).toBe('2')
		const src = folderOf('apps/api/src')
		const nested = [...src.querySelectorAll<HTMLLIElement>(':scope > ul > li')]
		expect(nested.map(label)).toEqual(['config/env', 'modules/billing/application/commands'])
		expect(nested.map((row) => row.getAttribute('aria-level'))).toEqual(['3', '3'])
		expect(nested[1]?.dataset.folder).toBe('apps/api/src/modules/billing/application/commands')
		expect(
			[...(nested[1]?.querySelectorAll<HTMLLIElement>('li[data-path]') ?? [])].map(
				(row) => row.dataset.path,
			),
		).toEqual([COMMAND, HANDLER])
		expect(rowOf(HANDLER).getAttribute('aria-level')).toBe('4')
		expect(rowOf(HANDLER).querySelectorAll('[class*="level-line"]')).toHaveLength(3)
		expect(rowOf(HANDLER).getAttribute('aria-label')).toBe(
			'deliver-billing-lifecycle-analytics.handler.ts',
		)
	})

	it('reports nested file clicks with the layer position of the file and ignores folder clicks', () => {
		const state = pageState({ layers: [mixedLayer()], layerIndex: 0, fileIndex: 0 })
		createTreeView(templates, anchorIds, handlers).apply(nativeTree(), state)

		rowOf(ENV).click()
		;(folderOf('apps/api/src').firstElementChild as HTMLElement).click()

		expect(handlers.onSelect).toHaveBeenCalledTimes(1)
		expect(handlers.onSelect).toHaveBeenCalledWith(0, 2)
	})

	it('patches selection and viewed state of nested rows in place', () => {
		const view = createTreeView(templates, anchorIds, handlers)
		const state = pageState({
			layers: [mixedLayer()],
			layerIndex: 0,
			fileIndex: 0,
			viewed: new Set(),
		})
		view.apply(nativeTree(), state)
		const handlerRow = rowOf(HANDLER)
		const folders = [...ourList().querySelectorAll('li[data-folder]')]

		view.apply(nativeTree(), { ...state, fileIndex: 3, viewed: new Set([HANDLER]) })

		expect(rowOf(HANDLER)).toBe(handlerRow)
		expect([...ourList().querySelectorAll('li[data-folder]')]).toEqual(folders)
		expect([...ourList().querySelectorAll('[aria-selected="true"]')]).toEqual([handlerRow])
		expect(handlerRow.firstElementChild?.classList.contains('bg-neutral-muted')).toBe(true)
		expect(handlerRow.querySelector('a')?.className).toContain('fgColor-muted')
		expect(rowOf(LOCK).getAttribute('aria-selected')).toBe('false')
		for (const folder of folders) expect(folder.getAttribute('aria-selected')).toBe('false')
		expect(ourList().querySelector('[data-detent-count]')?.textContent).toBe('1/4')
	})

	it('hides folders the filter leaves empty', () => {
		const input = document.createElement('input')
		input.setAttribute('aria-label', 'Filter files…')
		document.body.prepend(input)
		const view = createTreeView(templates, anchorIds, handlers)
		const state = pageState({ layers: [mixedLayer()], layerIndex: 0, fileIndex: 0 })
		view.apply(nativeTree(), state)
		expect(ourList().querySelectorAll('li[data-folder]')).toHaveLength(3)

		input.value = 'env'
		for (const anchor of nativeTree().querySelectorAll('a[href^="#diff-"]'))
			if (anchor.getAttribute('href') !== `#${anchorIds.get(ENV)}`) anchor.remove()
		view.apply(nativeTree(), state)

		expect(
			[...ourList().querySelectorAll<HTMLLIElement>('li[data-folder]')].map(
				(row) => row.dataset.folder,
			),
		).toEqual(['apps/api/src/config/env'])
		expect(
			[...ourList().querySelectorAll<HTMLLIElement>('li[data-path]')].map(
				(row) => row.dataset.path,
			),
		).toEqual([ENV])
		expect(rowOf(ENV).getAttribute('aria-level')).toBe('3')
		input.remove()
	})

	it('shows the native tree again in Files mode and follows a re-rendered native tree', () => {
		const view = createTreeView(templates, anchorIds, handlers)
		view.apply(nativeTree(), pageState({ isRaw: true }))

		expect(nativeTree().style.display).toBe('')
		expect(ourList().hidden).toBe(true)
		expect(document.querySelector(`#${TOGGLE_ID} button[aria-pressed="true"]`)?.textContent).toBe(
			'Files',
		)

		const first = nativeTree()
		const replacement = first.cloneNode(true) as HTMLUListElement
		first.replaceWith(replacement)
		view.apply(replacement, pageState())

		expect(replacement.style.display).toBe('none')
		expect(replacement.nextElementSibling?.id).toBe(TREE_ID)
		expect(document.querySelectorAll(`#${TREE_ID}`)).toHaveLength(1)

		view.detach()

		expect(replacement.style.display).toBe('')
		expect(document.getElementById(TREE_ID)).toBeNull()
	})

	it('renders Priority Review as foldable sections with reasons as row tooltips', () => {
		const priorityFile = (path: string, reason?: string) => ({
			path,
			role: 'server' as const,
			additions: 1,
			deletions: 0,
			...(reason ? { reason } : {}),
		})
		const sections: PanelLayer[] = [
			{
				id: 'priority:urgent',
				name: 'Urgent',
				summary: '',
				isTrailing: false,
				isCollapsible: true,
				files: [priorityFile(HANDLER, 'Sends analytics twice.')],
			},
			{
				id: 'priority:low',
				name: 'Low',
				summary: '',
				isTrailing: false,
				isCollapsible: true,
				files: [priorityFile(HANDLER_SPEC), priorityFile(LOCK)],
			},
		]
		const priority = pageState({
			layers: sections,
			priorityLayers: sections,
			isPriority: true,
			layerIndex: 0,
			fileIndex: 0,
			viewed: new Set(),
			priorityStatus: 'Priorities come from the file structure.',
			collapsedSections: new Set(['priority:low']),
		})
		const view = createTreeView(templates, anchorIds, handlers)
		view.apply(nativeTree(), priority)
		const sectionRows = [...ourList().querySelectorAll<HTMLElement>(':scope > li')]

		expect(ourList().getAttribute('aria-label')).toBe('Priority Review')
		expect(sectionRows.map((row) => label(row))).toEqual(['Urgent', 'Low'])
		expect(sectionRows.map((row) => row.querySelector('[data-detent-count]')?.textContent)).toEqual(
			['0/1', '0/2'],
		)
		expect(sectionRows.map((row) => row.getAttribute('aria-expanded'))).toEqual(['true', 'false'])
		expect(rowOf(HANDLER).querySelector('a')?.title).toBe(`${HANDLER}\nSends analytics twice.`)
		expect(rowOf(HANDLER_SPEC)).toBeNull()
		expect(footer()).toBe('Priorities come from the file structure.')
		expect(document.querySelector(`#${TOGGLE_ID} button[aria-pressed="true"]`)?.textContent).toBe(
			'Priority',
		)

		;(
			ourList().querySelector('li[data-layer="priority:low"] [class*="item-toggle"]') as HTMLElement
		).click()
		;(document.querySelector(`#${TOGGLE_ID} button[data-mode="layers"]`) as HTMLElement).click()
		expect(handlers.onToggleSection).toHaveBeenCalledWith('priority:low')
		expect(handlers.onSelect).not.toHaveBeenCalled()
		expect(handlers.onSetMode).toHaveBeenCalledWith('layers')

		view.apply(nativeTree(), { ...priority, collapsedSections: new Set(['priority:urgent']) })
		expect(
			[...ourList().querySelectorAll(':scope > li')].map((row) =>
				row.getAttribute('aria-expanded'),
			),
		).toEqual(['false', 'true'])
		expect(rowOf(HANDLER)).toBeNull()
		expect(rowOf(HANDLER_SPEC)).not.toBeNull()
	})

	it('lists priority files flat in ranked order with their folder as muted text', () => {
		const urgent: PanelLayer = {
			id: 'priority:urgent',
			name: 'Urgent',
			summary: '',
			isTrailing: false,
			isCollapsible: true,
			files: [HANDLER, ENV, COMMAND].map((path) => ({
				path,
				role: 'server',
				additions: 1,
				deletions: 0,
			})),
		}
		createTreeView(templates, anchorIds, handlers).apply(
			nativeTree(),
			pageState({
				layers: [urgent],
				priorityLayers: [urgent],
				isPriority: true,
				layerIndex: 0,
				fileIndex: 1,
			}),
		)
		const rows = [...ourList().querySelectorAll<HTMLLIElement>('li[data-path]')]

		expect(ourList().querySelectorAll('li[data-folder]')).toHaveLength(0)
		expect(rows.map((row) => row.dataset.path)).toEqual([HANDLER, ENV, COMMAND])
		expect(rows.map((row) => row.getAttribute('aria-level'))).toEqual(['2', '2', '2'])
		expect(rows[1]?.querySelector('[data-detent-folder]')?.textContent).toBe(
			'apps/api/src/config/env',
		)
		expect(rows[1]?.querySelector('[data-detent-folder]')?.className).toBe('fgColor-muted')
		expect(rows[1]?.getAttribute('aria-label')).toBe('env.schema.ts')
		expect(rows.map((row) => row.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false'])
	})
})
