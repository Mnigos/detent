// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { HIDE_TESTS_KEY } from '@/src/lib/panel/hide-tests'
import { createPanelStore, type PanelLayer, type PanelStore } from '@/src/lib/panel/store'
import { Panel } from './Panel'

const file = (path: string, role: 'server' | 'test') => ({ path, role, additions: 1, deletions: 0 })
const LAYERS: PanelLayer[] = [
	{
		id: 'api',
		name: 'API changes',
		summary: '',
		isTrailing: false,
		files: [file('api/a.ts', 'server'), file('api/a.spec.ts', 'test'), file('api/b.ts', 'server')],
	},
	{
		id: 'tests',
		name: 'Tests',
		summary: '',
		isTrailing: false,
		files: [file('e2e/flow.ts', 'test')],
	},
]

let root: Root
let host: HTMLElement
let store: PanelStore

const button = (name: string) =>
	[...host.querySelectorAll('button')].find((element) => element.textContent === name)
const hint = () => host.querySelector('[data-detent-hint]')

beforeEach(() => {
	;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
	fakeBrowser.reset()
	host = document.createElement('div')
	document.body.append(host)
	root = createRoot(host)
	store = createPanelStore(LAYERS, { status: 'Ready', savePosition: vi.fn() })
	act(() => root.render(<Panel store={store} onScrollToFile={vi.fn()} onToggleViewed={vi.fn()} />))
})

afterEach(() => {
	act(() => root.unmount())
	host.remove()
})

describe('Panel Hide tests', () => {
	it('hides tests from the layer list and file list, with a hint to show them again', async () => {
		expect(button('Hide tests')?.getAttribute('aria-pressed')).toBe('false')
		expect(host.textContent).toContain('a.spec.ts')
		expect(host.textContent).toContain('Tests')
		expect(hint()).toBeNull()

		act(() => button('Hide tests')?.click())
		expect(button('Hide tests')?.getAttribute('aria-pressed')).toBe('true')
		expect(host.textContent).not.toContain('a.spec.ts')
		expect(host.textContent).toContain('2 files · 0/2')
		expect(host.querySelector('ol')?.children).toHaveLength(1)
		expect(hint()?.textContent).toBe('2 test files hiddenShow')
		await vi.waitFor(async () =>
			expect(await fakeBrowser.storage.local.get(HIDE_TESTS_KEY)).toEqual({
				[HIDE_TESTS_KEY]: true,
			}),
		)

		act(() => button('Show')?.click())
		expect(button('Hide tests')?.getAttribute('aria-pressed')).toBe('false')
		expect(host.textContent).toContain('a.spec.ts')
		expect(hint()).toBeNull()
	})
})
