// What the popup and the callback page may ask the service worker. Tokens never cross this line:
// the answers carry the account email, the model list and one notice line at most.
import { browser } from 'wxt/browser'
import type { ChatGptModel } from './models'

/** Where a ChatGPT user reviews and limits what apps take from their plan. */
export const USAGE_SETTINGS_URL = 'https://chatgpt.com/settings/usage'

export const CHATGPT_MESSAGE = {
	status: 'detent:chatgpt:status',
	signIn: 'detent:chatgpt:sign-in',
	signOut: 'detent:chatgpt:sign-out',
	callback: 'detent:chatgpt:callback',
} as const

export interface ChatGptStatus {
	signedIn: boolean
	email?: string
	models: ChatGptModel[]
	/** The last thing that went wrong, in one line. */
	notice?: string
}

export type CallbackAnswer = { ok: true; email?: string } | { ok: false; message: string }

export const SIGNED_OUT: ChatGptStatus = { signedIn: false, models: [] }

const ask = <T>(type: string, extra: object = {}) =>
	browser.runtime.sendMessage({ type, ...extra }) as Promise<T>

export const chatGpt = {
	status: () => ask<ChatGptStatus | undefined>(CHATGPT_MESSAGE.status),
	signIn: () => ask<{ ok: boolean; message?: string } | undefined>(CHATGPT_MESSAGE.signIn),
	signOut: () => ask<ChatGptStatus | undefined>(CHATGPT_MESSAGE.signOut),
	finish: (href: string) => ask<CallbackAnswer | undefined>(CHATGPT_MESSAGE.callback, { href }),
}
