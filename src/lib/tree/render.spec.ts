// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	CANCEL,
	COMMAND,
	ENV,
	HANDLER,
	HANDLER_SPEC,
	loadChangesPage,
	nativeTree,
	pageState,
} from '../../test/changes-page'
import type { TreeTemplates } from './native'
import { createTreeView, TREE_ID, type TreeHandlers } from './render'

let anchorIds: Map<string, string>
let templates: TreeTemplates
let handlers: TreeHandlers

const ourList = () =>
	document.querySelector<HTMLUListElement>(`#${TREE_ID} ul[role="tree"]`) as HTMLUListElement

const rowOf = (path: string) =>
	ourList().querySelector<HTMLLIElement>(`li[data-path="${path}"]`) as HTMLLIElement

const footer = () => document.querySelector(`#${TREE_ID} .fgColor-muted.f6.px-2`)?.textContent

beforeEach(async () => {
	;({ anchorIds, templates } = await loadChangesPage())
	handlers = { onSelect: vi.fn(), onToggleTrailing: vi.fn(), onSetRaw: vi.fn() }
})

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('createTreeView', () => {
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
		expect(rowOf(ENV).getAttribute('aria-level')).toBe('2')
		expect(rowOf(ENV).querySelectorAll('[class*="level-line"]')).toHaveLength(1)
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
		const buttons = [...view.root.querySelectorAll('button')]
		expect(buttons.map((button) => button.dataset.size)).toEqual(['small', 'small'])
		expect(buttons.map((button) => button.dataset.variant)).toEqual(['default', 'invisible'])
		for (const button of buttons) expect(button.className).toContain('prc-Button-ButtonBase')
		view.apply(nativeTree(), pageState({ isRaw: true }))
		expect(buttons.map((button) => button.dataset.variant)).toEqual(['invisible', 'default'])
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
		;(document.querySelector(`#${TREE_ID} button[aria-pressed="false"]`) as HTMLElement).click()

		expect(handlers.onSelect).toHaveBeenNthCalledWith(1, 1, 2)
		expect(handlers.onSelect).toHaveBeenNthCalledWith(2, 0, 0)
		expect(handlers.onSelect).toHaveBeenCalledTimes(2)
		expect(handlers.onToggleTrailing).toHaveBeenCalledTimes(1)
		expect(handlers.onSetRaw).toHaveBeenCalledWith(true)
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

	it('shows the native tree again in Files mode and follows a re-rendered native tree', () => {
		const view = createTreeView(templates, anchorIds, handlers)
		view.apply(nativeTree(), pageState({ isRaw: true }))

		expect(nativeTree().style.display).toBe('')
		expect(ourList().hidden).toBe(true)
		expect(document.querySelector(`#${TREE_ID} button[aria-pressed="true"]`)?.textContent).toBe(
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
})
