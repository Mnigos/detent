import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { SETTINGS_KEY } from '../settings'
import {
	followHideTests,
	HIDE_TESTS_KEY,
	readHideTests,
	toggleHideTests,
	writeHideTests,
} from './hide-tests'
import { createPanelStore, type PanelLayer } from './store'

const LAYERS: PanelLayer[] = [
	{
		id: 'api',
		name: 'API',
		summary: '',
		isTrailing: false,
		files: [
			{ path: 'api/a.ts', role: 'server', additions: 1, deletions: 0 },
			{ path: 'api/a.spec.ts', role: 'test', additions: 1, deletions: 0 },
		],
	},
]

const newStore = () => createPanelStore(LAYERS, { status: '', savePosition: vi.fn() })

beforeEach(() => {
	fakeBrowser.reset()
})

describe('hideTests preference', () => {
	it('is off until saved, then reads back what was saved', async () => {
		await expect(readHideTests()).resolves.toBe(false)
		await writeHideTests(true)
		await expect(readHideTests()).resolves.toBe(true)
		await writeHideTests(false)
		await expect(readHideTests()).resolves.toBe(false)
	})

	it('treats anything but true as off', async () => {
		await fakeBrowser.storage.local.set({ [HIDE_TESTS_KEY]: 'yes' })
		await expect(readHideTests()).resolves.toBe(false)
	})

	it('lives outside the settings record, so saving it never remounts detent', async () => {
		await writeHideTests(true)
		const stored = await fakeBrowser.storage.local.get(null)
		expect(stored).toEqual({ [HIDE_TESTS_KEY]: true })
		expect(stored[SETTINGS_KEY]).toBeUndefined()
	})

	it('toggles the page at once and saves the choice', async () => {
		const store = newStore()
		toggleHideTests(store)
		expect(store.getSnapshot().isHidingTests).toBe(true)
		await vi.waitFor(async () => expect(await readHideTests()).toBe(true))
		toggleHideTests(store)
		expect(store.getSnapshot().isHidingTests).toBe(false)
		await vi.waitFor(async () => expect(await readHideTests()).toBe(false))
	})

	it('follows a change saved by another tab until stopped', async () => {
		const store = newStore()
		const stop = followHideTests(store)
		await fakeBrowser.storage.local.set({ [HIDE_TESTS_KEY]: true })
		expect(store.getSnapshot().isHidingTests).toBe(true)
		expect(store.getSnapshot().layers[0]?.files.map((file) => file.path)).toEqual(['api/a.ts'])
		await fakeBrowser.storage.local.set({ [HIDE_TESTS_KEY]: false })
		expect(store.getSnapshot().isHidingTests).toBe(false)

		stop()
		await fakeBrowser.storage.local.set({ [HIDE_TESTS_KEY]: true })
		expect(store.getSnapshot().isHidingTests).toBe(false)
	})

	it('ignores other keys and other storage areas', async () => {
		const store = newStore()
		const stop = followHideTests(store)
		await fakeBrowser.storage.local.set({ [SETTINGS_KEY]: { isEnabled: true } })
		await fakeBrowser.storage.session.set({ [HIDE_TESTS_KEY]: true })
		expect(store.getSnapshot().isHidingTests).toBe(false)
		stop()
	})
})
