import { browser } from 'wxt/browser'

export const SETTINGS_KEY = 'settings'
export const DEFAULT_MODEL = 'openai/gpt-5.6-luna'

export type ProviderChoice = 'openrouter' | 'chatgpt'

export interface Settings {
	/** Which model provider names the layers and ranks the files. */
	provider: ProviderChoice
	openRouterKey: string
	/** The OpenRouter model; ChatGPT keeps its own choice in `chatgptModel`. */
	model: string
	/** A model slug from the signed-in ChatGPT account's list; empty takes the default (Luna). */
	chatgptModel: string
	/** Off keeps GitHub's pages untouched: no layers, no requests. */
	isEnabled: boolean
	/** Diff size (+additions −deletions · files) and merge conflicts on each row of a pull request list. */
	showListStats: boolean
	/** Clicking an image in a description or comment opens it over the page, not in a new tab. */
	showImagePreview: boolean
}

export const DEFAULT_SETTINGS: Settings = {
	provider: 'openrouter',
	openRouterKey: '',
	model: DEFAULT_MODEL,
	chatgptModel: '',
	isEnabled: true,
	showListStats: true,
	showImagePreview: true,
}

const isText = (value: unknown): value is string => typeof value === 'string'

export async function readSettings(): Promise<Settings> {
	const stored = (await browser.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as
		| Partial<Settings>
		| undefined
	const model = isText(stored?.model) ? stored.model.trim() : ''

	return {
		provider: stored?.provider === 'chatgpt' ? 'chatgpt' : 'openrouter',
		openRouterKey: isText(stored?.openRouterKey) ? stored.openRouterKey.trim() : '',
		model: model || DEFAULT_MODEL,
		chatgptModel: isText(stored?.chatgptModel) ? stored.chatgptModel.trim() : '',
		isEnabled: stored?.isEnabled !== false,
		showListStats: stored?.showListStats !== false,
		showImagePreview: stored?.showImagePreview !== false,
	}
}

let pending: Promise<unknown> = Promise.resolve()

// Each write saves the whole record; one queue keeps two quick changes from undoing each other.
export function writeSettings(partial: Partial<Settings>): Promise<Settings> {
	const write = pending.then(async () => {
		const settings = { ...(await readSettings()), ...partial }
		await browser.storage.local.set({ [SETTINGS_KEY]: settings })

		return settings
	})
	pending = write.catch(() => undefined)

	return write
}
