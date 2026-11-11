// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { ContentScriptContext } from 'wxt/utils/content-script-context'
import { followHideTests, HIDE_TESTS_KEY } from '../lib/panel/hide-tests'
import { createReviewSession } from '../lib/panel/session'
import { createPanelStore, currentFile } from '../lib/panel/store'
import {
	CANCEL,
	COMMAND,
	ENV,
	HANDLER,
	HANDLER_SPEC,
	HANDLER_SPEC_ANCHOR,
	LAYERS,
	LOCK,
	loadChangesPage,
} from '../test/changes-page'
import { startTree } from './mount'

vi.mock('../lib/panel/session', () => ({ createReviewSession: vi.fn() }))

let tree: Awaited<ReturnType<typeof startTree>>
let store: ReturnType<typeof createPanelStore>
let ctx: ContentScriptContext
let stopFollowing: () => void

const testsButton = () =>
	document.querySelector<HTMLButtonElement>('#detent-tree-toggle button[data-detent-tests]')
const ourRow = (path: string) => document.querySelector(`#detent-tree li[data-path="${path}"]`)
const specEntry = () => document.getElementById(HANDLER_SPEC_ANCHOR)?.parentElement
const press = async (key: string) => {
	document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
	await vi.advanceTimersByTimeAsync(50)
}

beforeEach(async () => {
	fakeBrowser.reset()
	const { anchorIds } = await loadChangesPage()
	vi.useFakeTimers()
	vi.stubGlobal('scrollTo', vi.fn())
	store = createPanelStore(LAYERS, { status: 'Ready', savePosition: vi.fn() })
	stopFollowing = followHideTests(store)
	vi.mocked(createReviewSession).mockResolvedValue({ store, anchorIds, stop: vi.fn() })
	ctx = new ContentScriptContext('hide-tests-test')
	tree = await startTree(ctx, { owner: 'owner', repo: 'repo', number: 1, tab: 'changes' })
	tree.mount()
	await vi.advanceTimersByTimeAsync(50)
})

afterEach(() => {
	stopFollowing()
	tree.remove()
	ctx.abort()
	vi.clearAllTimers()
	vi.useRealTimers()
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe('Hide tests on the Changes page', () => {
	it('hides the test row and diff on click, saves the choice and restores both', async () => {
		expect(ourRow(HANDLER_SPEC)).not.toBeNull()
		testsButton()?.click()
		await vi.advanceTimersByTimeAsync(50)
		expect(ourRow(HANDLER_SPEC)).toBeNull()
		expect(specEntry()?.style.display).toBe('none')
		expect(testsButton()?.getAttribute('aria-pressed')).toBe('true')
		await expect(fakeBrowser.storage.local.get(HIDE_TESTS_KEY)).resolves.toEqual({
			[HIDE_TESTS_KEY]: true,
		})

		document.querySelector<HTMLButtonElement>('#detent-tree [data-detent-hint] button')?.click()
		await vi.advanceTimersByTimeAsync(50)
		expect(ourRow(HANDLER_SPEC)).not.toBeNull()
		expect(specEntry()?.style.display).toBe('')
		await expect(fakeBrowser.storage.local.get(HIDE_TESTS_KEY)).resolves.toEqual({
			[HIDE_TESTS_KEY]: false,
		})
	})

	it('applies a change saved in another tab without asking for the diff again', async () => {
		const sessions = vi.mocked(createReviewSession).mock.calls.length
		await fakeBrowser.storage.local.set({ [HIDE_TESTS_KEY]: true })
		await vi.advanceTimersByTimeAsync(50)
		expect(ourRow(HANDLER_SPEC)).toBeNull()
		expect(specEntry()?.style.display).toBe('none')
		expect(vi.mocked(createReviewSession).mock.calls.length).toBe(sessions)
	})

	it('steps j/k over shown files only', async () => {
		store.dispatch({ type: 'select', layerIndex: 1, fileIndex: 2 })
		expect(currentFile(store.getSnapshot())?.path).toBe(CANCEL)
		await press('j')
		expect(currentFile(store.getSnapshot())?.path).toBe(HANDLER_SPEC)
		await press('k')
		testsButton()?.click()
		await vi.advanceTimersByTimeAsync(50)
		expect(currentFile(store.getSnapshot())?.path).toBe(CANCEL)
		await press('j')
		expect(currentFile(store.getSnapshot())?.path).toBe(CANCEL)
		await press('k')
		expect(currentFile(store.getSnapshot())?.path).toBe(HANDLER)
	})

	it('settles on the first layer with unviewed shown files, ignoring hidden tests', async () => {
		testsButton()?.click()
		await vi.advanceTimersByTimeAsync(50)
		store.dispatch({ type: 'select', layerIndex: 0, fileIndex: 0 })
		store.dispatch({ type: 'viewed', paths: new Set([COMMAND, HANDLER, CANCEL]) })
		await vi.advanceTimersByTimeAsync(50)
		store.dispatch({ type: 'viewed', paths: new Set([ENV, COMMAND, HANDLER, CANCEL]) })
		await vi.advanceTimersByTimeAsync(50)
		// The billing layer counts as done without its spec, so the jump skips past it.
		expect(currentFile(store.getSnapshot())?.path).toBe(LOCK)
		expect(store.getSnapshot().toast).toBe('Layer 1 done. Next: Generated')
	})
})
