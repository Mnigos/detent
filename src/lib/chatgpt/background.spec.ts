import { beforeEach, describe, expect, it, vi } from 'vitest'
import { browser } from 'wxt/browser'
import { vault, vaultStore } from '../../test/memory-vault'
import {
	chatGptStatus,
	handleChatGptMessage,
	installCallbackRule,
	isExtensionPage,
} from './background'
import { listModels } from './models'
import { signOut } from './session'
import { beginSignIn, completeSignIn } from './sign-in'

vi.mock('wxt/browser', () => ({
	browser: {
		runtime: { id: 'detent-id', getURL: (path: string) => `chrome-extension://detent-id${path}` },
		tabs: { create: vi.fn() },
		declarativeNetRequest: { updateSessionRules: vi.fn() },
	},
}))
vi.mock('./vault', () => import('../../test/memory-vault'))
vi.mock('./models', () => ({ listModels: vi.fn(), forgetModels: vi.fn() }))
vi.mock('./session', () => ({ signOut: vi.fn() }))
vi.mock('./sign-in', () => ({ beginSignIn: vi.fn(), completeSignIn: vi.fn() }))

const POPUP = { id: 'detent-id', url: 'chrome-extension://detent-id/popup.html' }
const MODELS = [{ slug: 'gpt-6-luna', name: 'GPT-6 Luna' }]

beforeEach(() => {
	vi.clearAllMocks()
	vaultStore.clear()
	vi.mocked(listModels).mockResolvedValue(MODELS)
	vi.mocked(beginSignIn).mockResolvedValue('https://auth.openai.com/api/accounts/authorize?x=1')
})

const send = (message: object, sender: object = POPUP) =>
	new Promise((resolve) => {
		if (!handleChatGptMessage(message, sender, resolve)) resolve('not handled')
	})

describe('installCallbackRule', () => {
	it('redirects only the loopback callback path, query kept, to the extension page', async () => {
		await installCallbackRule()
		const { addRules, removeRuleIds } =
			vi.mocked(browser.declarativeNetRequest.updateSessionRules).mock.calls[0]?.[0] ?? {}
		const rule = addRules?.[0]
		const filter = new RegExp(String(rule?.condition.regexFilter))

		expect(removeRuleIds).toEqual([rule?.id])
		expect(rule?.action).toEqual({
			type: 'redirect',
			redirect: { regexSubstitution: 'chrome-extension://detent-id/chatgpt-callback.html\\1' },
		})
		expect(rule?.condition.resourceTypes).toEqual(['main_frame'])
		const callback = 'http://127.0.0.1:47801/auth/callback?code=c&state=s'
		expect(callback.replace(filter, 'chrome-extension://detent-id/chatgpt-callback.html$1')).toBe(
			'chrome-extension://detent-id/chatgpt-callback.html?code=c&state=s',
		)
		expect(filter.test('http://127.0.0.1:1455/auth/callback?code=c')).toBe(false)
		expect(filter.test('http://127.0.0.1:47801/auth/callbacks?code=c')).toBe(false)
		expect(filter.test('http://localhost:47801/auth/callback?code=c')).toBe(false)
	})
})

describe('handleChatGptMessage', () => {
	it.each([
		['a content script on github.com', { id: 'detent-id', url: 'https://github.com/o/r/pull/1' }],
		['another extension', { id: 'other', url: 'chrome-extension://other/popup.html' }],
		['no page', { id: 'detent-id' }],
	])('refuses %s', async (_name, sender) => {
		expect(isExtensionPage(sender)).toBe(false)
		await expect(send({ type: 'detent:chatgpt:status' }, sender)).resolves.toBeUndefined()
		await send({ type: 'detent:chatgpt:sign-out' }, sender)
		expect(signOut).not.toHaveBeenCalled()
	})

	it('leaves other messages alone', async () => {
		await expect(send({ type: 'detent:prioritize' })).resolves.toBe('not handled')
	})

	it('sets the callback rule before it opens the authorize page', async () => {
		await expect(send({ type: 'detent:chatgpt:sign-in' })).resolves.toEqual({ ok: true })
		expect(
			vi.mocked(browser.declarativeNetRequest.updateSessionRules).mock.invocationCallOrder[0],
		).toBeLessThan(vi.mocked(browser.tabs.create).mock.invocationCallOrder[0] ?? 0)
		expect(browser.tabs.create).toHaveBeenCalledWith({
			url: 'https://auth.openai.com/api/accounts/authorize?x=1',
		})
	})

	it('does not open the authorize page when the callback rule cannot be set', async () => {
		vi.mocked(browser.declarativeNetRequest.updateSessionRules).mockRejectedValueOnce(
			new Error('x'),
		)
		vi.spyOn(console, 'warn').mockImplementation(() => undefined)

		await expect(send({ type: 'detent:chatgpt:sign-in' })).resolves.toMatchObject({ ok: false })
		expect(browser.tabs.create).not.toHaveBeenCalled()
	})

	it('answers a failed sign-out or status with nothing, never a signed-out look-alike', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => undefined)
		vi.mocked(signOut).mockRejectedValueOnce(new Error('vault write failed'))
		await expect(send({ type: 'detent:chatgpt:sign-out' })).resolves.toBeUndefined()

		vi.spyOn(vault, 'get').mockRejectedValueOnce(new Error('vault read failed'))
		await expect(send({ type: 'detent:chatgpt:status' })).resolves.toBeUndefined()
	})

	it('hands the callback URL to the sign-in', async () => {
		vi.mocked(completeSignIn).mockResolvedValue({ ok: true, email: 'r@example.com' })
		const sender = { id: 'detent-id', url: 'chrome-extension://detent-id/chatgpt-callback.html' }
		const href = 'chrome-extension://detent-id/chatgpt-callback.html?code=c&state=s'

		await expect(send({ type: 'detent:chatgpt:callback', href }, sender)).resolves.toEqual({
			ok: true,
			email: 'r@example.com',
		})
		expect(completeSignIn).toHaveBeenCalledWith(href)
	})
})

describe('chatGptStatus', () => {
	it('is signed out with the last notice and no models', async () => {
		vaultStore.set('notice', 'Sign in to ChatGPT again.')
		await expect(chatGptStatus()).resolves.toEqual({
			signedIn: false,
			models: [],
			notice: 'Sign in to ChatGPT again.',
		})
		expect(listModels).not.toHaveBeenCalled()
	})

	it('shows the email and the models when signed in, never a token', async () => {
		vaultStore.set('account', {
			clientId: 'oaiapp_issued',
			email: 'r@example.com',
			tokens: {
				accessToken: 'secret-access',
				refreshToken: 'secret-refresh',
				idToken: 'secret-id',
			},
		})
		const status = await chatGptStatus()

		expect(status).toEqual({ signedIn: true, email: 'r@example.com', models: MODELS })
		expect(JSON.stringify(status)).not.toContain('secret')
	})

	it('is signed out when loading the models ended the session', async () => {
		vaultStore.set('account', { clientId: 'c', tokens: { accessToken: 'a' } })
		vi.mocked(listModels).mockImplementation(async () => {
			vaultStore.set('account', { clientId: 'c' })
			vaultStore.set('notice', 'Sign in to ChatGPT again.')
			throw new Error('SignInRequired')
		})

		await expect(chatGptStatus()).resolves.toEqual({
			signedIn: false,
			models: [],
			notice: 'Sign in to ChatGPT again.',
		})
	})

	it('says so when the models cannot be loaded', async () => {
		vaultStore.set('account', { clientId: 'c', tokens: { accessToken: 'a' } })
		vi.mocked(listModels).mockRejectedValue(new Error('HTTP 503'))
		await expect(chatGptStatus()).resolves.toMatchObject({
			signedIn: true,
			models: [],
			notice: 'Could not load the ChatGPT models.',
		})
	})
})
