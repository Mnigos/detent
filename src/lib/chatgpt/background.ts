// The service worker side of ChatGPT: the only place that talks to auth.openai.com and
// api.openai.com and reads the credential vault.
import { browser } from 'wxt/browser'
import { CALLBACK_PORT, readAccount, readNotice } from './account'
import { CHATGPT_MESSAGE, type ChatGptStatus } from './messages'
import { forgetModels, listModels } from './models'
import { signOut } from './session'
import { beginSignIn, completeSignIn } from './sign-in'

export const CALLBACK_PAGE = '/chatgpt-callback.html'
const CALLBACK_RULE_ID = 1

/**
 * Turns the loopback redirect into the extension's callback page before the request is sent, so
 * the authorization code never reaches whatever listens on 127.0.0.1. Session rules last until the
 * browser closes; the rule is set again on every worker start and before every sign-in.
 */
export function installCallbackRule() {
	return browser.declarativeNetRequest.updateSessionRules({
		removeRuleIds: [CALLBACK_RULE_ID],
		addRules: [
			{
				id: CALLBACK_RULE_ID,
				priority: 1,
				action: {
					type: 'redirect',
					redirect: { regexSubstitution: `${browser.runtime.getURL(CALLBACK_PAGE)}\\1` },
				},
				condition: {
					regexFilter: `^http://127\\.0\\.0\\.1:${CALLBACK_PORT}/auth/callback(\\?.*)?$`,
					resourceTypes: ['main_frame'],
				},
			},
		],
	})
}

export async function chatGptStatus(): Promise<ChatGptStatus> {
	const signedOut = async (): Promise<ChatGptStatus> => ({
		signedIn: false,
		models: [],
		notice: await readNotice(),
	})
	if (!(await readAccount())?.tokens) return signedOut()

	const models = await listModels().catch(() => undefined)
	// Loading the models may have refreshed the session, or ended it.
	const [account, notice] = await Promise.all([readAccount(), readNotice()])
	if (!account?.tokens) return signedOut()

	return {
		signedIn: true,
		email: account.email,
		models: models ?? [],
		notice: notice ?? (models ? undefined : 'Could not load the ChatGPT models.'),
	}
}

async function startSignIn() {
	await installCallbackRule()
	const url = await beginSignIn()
	await browser.tabs.create({ url })

	return { ok: true }
}

type Sender = { id?: string; url?: string }

/** Only detent's own pages (popup, callback page) may drive the account; content scripts may not. */
export const isExtensionPage = (sender: Sender) =>
	sender.id === browser.runtime.id &&
	typeof sender.url === 'string' &&
	sender.url.startsWith(browser.runtime.getURL('/'))

const actions: Record<string, (message: { href?: unknown }) => Promise<unknown>> = {
	[CHATGPT_MESSAGE.status]: chatGptStatus,
	[CHATGPT_MESSAGE.signIn]: startSignIn,
	[CHATGPT_MESSAGE.signOut]: async () => {
		await signOut()
		forgetModels()
		return chatGptStatus()
	},
	[CHATGPT_MESSAGE.callback]: async ({ href }) => {
		forgetModels()
		return completeSignIn(String(href))
	},
}

const SIGN_IN_FAILED = { ok: false, message: 'ChatGPT sign-in failed. Try again.' }
// A failure answers in the shape its caller expects. Status and sign-out answer nothing: the popup
// then says ChatGPT did not answer or the sign-out failed, instead of reading it as signed out.
const failures: Record<string, unknown> = {
	[CHATGPT_MESSAGE.signIn]: SIGN_IN_FAILED,
	[CHATGPT_MESSAGE.callback]: SIGN_IN_FAILED,
}

/** Answers a ChatGPT message; `false` leaves the message to the other listeners. */
export function handleChatGptMessage(
	message: unknown,
	sender: Sender,
	reply: (value: unknown) => void,
): boolean {
	const type = (message as { type?: unknown } | null)?.type
	const action = typeof type === 'string' ? actions[type] : undefined
	if (!action) return false
	if (!isExtensionPage(sender)) {
		reply(undefined)
		return false
	}

	action(message as { href?: unknown })
		.then(reply)
		.catch((error: unknown) => {
			console.warn('[detent] chatgpt', error instanceof Error ? error.message : error)
			reply(failures[String(type)])
		})
	return true
}
