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

// Luna is fast and good enough for naming layers and ranking files; the account's first listed
// model is often a heavier one that only adds latency here.
const PREFERRED_MODEL = 'gpt-6-luna'
const PREFERRED_FAMILY = 'luna'

/**
 * The saved choice while the account still lists it. Otherwise `gpt-6-luna`, then the first listed
 * Luna (the server lists newer versions first), then the first listed model. Without a list the
 * saved choice is used as it is, and `gpt-6-luna` when nothing is saved.
 */
export function pickModel(saved: string, models: ChatGptModel[]) {
	const slugs = models.map((model) => model.slug)
	if (slugs.includes(saved)) return saved

	return (
		slugs.find((slug) => slug === PREFERRED_MODEL) ??
		slugs.find((slug) => slug.includes(PREFERRED_FAMILY)) ??
		slugs[0] ??
		(saved || PREFERRED_MODEL)
	)
}

export const SIGNED_OUT: ChatGptStatus = { signedIn: false, models: [] }
const UNREACHABLE: ChatGptStatus = {
	...SIGNED_OUT,
	notice: 'ChatGPT did not answer. Reopen the popup to try again.',
}
// Longer than the worker's own per-request limits, so a slow refresh still gets its answer.
const STATUS_TIMEOUT_MILLISECONDS = 20_000

const ask = <T>(type: string, extra: object = {}) =>
	browser.runtime.sendMessage({ type, ...extra }) as Promise<T>

export const chatGpt = {
	/** The account as the worker sees it; never hangs the popup. */
	status: () =>
		Promise.race([
			ask<ChatGptStatus | undefined>(CHATGPT_MESSAGE.status).catch(() => undefined),
			new Promise<undefined>((resolve) => setTimeout(resolve, STATUS_TIMEOUT_MILLISECONDS)),
		]).then((status) => status ?? UNREACHABLE),
	signIn: () => ask<{ ok: boolean; message?: string } | undefined>(CHATGPT_MESSAGE.signIn),
	signOut: () => ask<ChatGptStatus | undefined>(CHATGPT_MESSAGE.signOut),
	finish: (href: string) => ask<CallbackAnswer | undefined>(CHATGPT_MESSAGE.callback, { href }),
}
