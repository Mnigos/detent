import { browser } from 'wxt/browser'

export const SETTINGS_KEY = 'settings'
export const DEFAULT_MODEL = 'openai/gpt-5.6-luna'

export interface Settings {
	openRouterKey: string
	model: string
	/** Off keeps GitHub's pages untouched: no layers, no requests. */
	isEnabled: boolean
	/** Diff size (+additions −deletions · files) on each row of a pull request list. */
	showListStats: boolean
}

const isText = (value: unknown): value is string => typeof value === 'string'

export async function readSettings(): Promise<Settings> {
	const stored = (await browser.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as
		| Partial<Settings>
		| undefined
	const model = isText(stored?.model) ? stored.model.trim() : ''

	return {
		openRouterKey: isText(stored?.openRouterKey) ? stored.openRouterKey.trim() : '',
		model: model || DEFAULT_MODEL,
		isEnabled: stored?.isEnabled !== false,
		showListStats: stored?.showListStats !== false,
	}
}

export async function writeSettings(partial: Partial<Settings>): Promise<Settings> {
	const settings = { ...(await readSettings()), ...partial }
	await browser.storage.local.set({ [SETTINGS_KEY]: settings })

	return settings
}
