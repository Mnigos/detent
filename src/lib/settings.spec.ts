import { beforeEach, describe, expect, it } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { DEFAULT_MODEL, readSettings, SETTINGS_KEY, writeSettings } from './settings'

beforeEach(() => {
	fakeBrowser.reset()
})

describe('readSettings', () => {
	it('answers an empty key and the default model when nothing is stored', async () => {
		await expect(readSettings()).resolves.toEqual({ openRouterKey: '', model: DEFAULT_MODEL })
	})

	it('trims what is stored and falls back to the default model for a blank one', async () => {
		await fakeBrowser.storage.local.set({
			[SETTINGS_KEY]: { openRouterKey: ' sk-or-1 ', model: '  ' },
		})

		await expect(readSettings()).resolves.toEqual({
			openRouterKey: 'sk-or-1',
			model: DEFAULT_MODEL,
		})
	})

	it('ignores stored values that lost their shape', async () => {
		await fakeBrowser.storage.local.set({ [SETTINGS_KEY]: { openRouterKey: 3, model: null } })

		await expect(readSettings()).resolves.toEqual({ openRouterKey: '', model: DEFAULT_MODEL })
	})
})

describe('writeSettings', () => {
	it('merges the partial into the stored settings and returns the result', async () => {
		await writeSettings({ openRouterKey: 'sk-or-1' })

		await expect(writeSettings({ model: 'anthropic/claude-sonnet-5' })).resolves.toEqual({
			openRouterKey: 'sk-or-1',
			model: 'anthropic/claude-sonnet-5',
		})
		await expect(fakeBrowser.storage.local.get(SETTINGS_KEY)).resolves.toEqual({
			[SETTINGS_KEY]: { openRouterKey: 'sk-or-1', model: 'anthropic/claude-sonnet-5' },
		})
	})
})
