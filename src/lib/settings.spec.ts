import { beforeEach, describe, expect, it } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { DEFAULT_MODEL, readSettings, SETTINGS_KEY, writeSettings } from './settings'

beforeEach(() => {
	fakeBrowser.reset()
})

describe('readSettings', () => {
	it('answers an empty key and the default model when nothing is stored', async () => {
		await expect(readSettings()).resolves.toEqual({
			provider: 'openrouter',
			openRouterKey: '',
			model: DEFAULT_MODEL,
			chatgptModel: '',
			isEnabled: true,
			showListStats: true,
		})
	})

	it('trims what is stored and falls back to the default model for a blank one', async () => {
		await fakeBrowser.storage.local.set({
			[SETTINGS_KEY]: { openRouterKey: ' sk-or-1 ', model: '  ' },
		})

		await expect(readSettings()).resolves.toEqual({
			provider: 'openrouter',
			openRouterKey: 'sk-or-1',
			model: DEFAULT_MODEL,
			chatgptModel: '',
			isEnabled: true,
			showListStats: true,
		})
	})

	it('ignores stored values that lost their shape', async () => {
		await fakeBrowser.storage.local.set({ [SETTINGS_KEY]: { openRouterKey: 3, model: null } })

		await expect(readSettings()).resolves.toEqual({
			provider: 'openrouter',
			openRouterKey: '',
			model: DEFAULT_MODEL,
			chatgptModel: '',
			isEnabled: true,
			showListStats: true,
		})
	})

	it('is enabled unless the stored flag says false', async () => {
		expect((await readSettings()).isEnabled).toBe(true)
		await fakeBrowser.storage.local.set({ [SETTINGS_KEY]: { isEnabled: false } })
		expect((await readSettings()).isEnabled).toBe(false)
	})

	it('shows list stats unless the stored flag says false', async () => {
		expect((await readSettings()).showListStats).toBe(true)
		await fakeBrowser.storage.local.set({ [SETTINGS_KEY]: { showListStats: false } })
		expect((await readSettings()).showListStats).toBe(false)
	})
})

describe('provider choice', () => {
	it('keeps the ChatGPT choice and its own model apart from the OpenRouter model', async () => {
		await fakeBrowser.storage.local.set({
			[SETTINGS_KEY]: { provider: 'chatgpt', chatgptModel: ' gpt-6-luna ', model: 'm/x' },
		})

		await expect(readSettings()).resolves.toMatchObject({
			provider: 'chatgpt',
			chatgptModel: 'gpt-6-luna',
			model: 'm/x',
		})
	})

	it('falls back to OpenRouter for anything else', async () => {
		await fakeBrowser.storage.local.set({ [SETTINGS_KEY]: { provider: 'gemini' } })

		expect((await readSettings()).provider).toBe('openrouter')
	})
})

describe('writeSettings', () => {
	it('merges the partial into the stored settings and returns the result', async () => {
		await writeSettings({ openRouterKey: 'sk-or-1' })

		const expected = {
			provider: 'openrouter',
			openRouterKey: 'sk-or-1',
			model: 'anthropic/claude-sonnet-5',
			chatgptModel: '',
			isEnabled: true,
			showListStats: true,
		}
		await expect(writeSettings({ model: 'anthropic/claude-sonnet-5' })).resolves.toEqual(expected)
		await expect(fakeBrowser.storage.local.get(SETTINGS_KEY)).resolves.toEqual({
			[SETTINGS_KEY]: expected,
		})
	})
})
