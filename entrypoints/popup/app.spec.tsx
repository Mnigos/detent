// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type ChatGptStatus, chatGpt, SIGNED_OUT } from '@/src/lib/chatgpt/messages'
import { EMPTY_USAGE, resetChatGptRequests, resetUsage } from '@/src/lib/model/usage'
import { DEFAULT_SETTINGS, type Settings, writeSettings } from '@/src/lib/settings'
import { App } from './app'

vi.mock('@/src/lib/chatgpt/messages', async (original) => ({
	...(await original<typeof import('@/src/lib/chatgpt/messages')>()),
	chatGpt: { status: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), finish: vi.fn() },
}))
vi.mock('@/src/lib/settings', async (original) => ({
	...(await original<typeof import('@/src/lib/settings')>()),
	writeSettings: vi.fn(async () => ({})),
}))
vi.mock('@/src/lib/model/usage', async (original) => ({
	...(await original<typeof import('@/src/lib/model/usage')>()),
	resetUsage: vi.fn(async () => undefined),
	resetChatGptRequests: vi.fn(async () => undefined),
}))
vi.mock('@/src/lib/model/openrouter', () => ({ testOpenRouter: vi.fn() }))

const SIGNED_IN: ChatGptStatus = {
	signedIn: true,
	email: 'reviewer@example.com',
	models: [
		{ slug: 'gpt-6-luna', name: 'GPT-6 Luna' },
		{ slug: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
		{ slug: 'gpt-5.6-luna', name: 'GPT-5.6 Luna' },
	],
}
const CHATGPT: Settings = { ...DEFAULT_SETTINGS, provider: 'chatgpt' }

let container: HTMLDivElement
let root: Root

beforeEach(() => {
	;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
	vi.clearAllMocks()
	container = document.createElement('div')
	document.body.append(container)
	root = createRoot(container)
})
afterEach(() => {
	act(() => root.unmount())
	container.remove()
})

function render(settings: Settings, chatgpt: ChatGptStatus = SIGNED_OUT, chatgptRequests = 0) {
	act(() =>
		root.render(
			<App
				settings={settings}
				usage={{ ...EMPTY_USAGE, requests: 2, cost: 0.0123 }}
				chatgpt={chatgpt}
				chatgptRequests={chatgptRequests}
			/>,
		),
	)
}
const button = (name: string) =>
	[...container.querySelectorAll('button')].find((element) => element.textContent === name)
const text = () => container.textContent ?? ''
const click = async (element: Element | undefined) => {
	await act(async () => {
		;(element as HTMLElement).click()
	})
}

describe('provider choice', () => {
	it('shows the OpenRouter key and cost counter by default', () => {
		render(DEFAULT_SETTINGS)

		expect(text()).toContain('OpenRouter API key')
		expect(text()).toContain('Usage: $0.01 · 2 requests')
		expect(button('Continue with ChatGPT')).toBeUndefined()
	})

	it('switches to ChatGPT, saves the choice and shows the request count without a cost', async () => {
		render(DEFAULT_SETTINGS, SIGNED_OUT, 1)
		await click(container.querySelector('input[value="chatgpt"]') ?? undefined)

		expect(writeSettings).toHaveBeenCalledWith({ provider: 'chatgpt' })
		expect(text()).not.toContain('OpenRouter API key')
		expect(button('Continue with ChatGPT')).toBeDefined()
		expect(text()).toContain('Usage: 1 request')
		expect(text()).not.toContain('$')
		expect(
			container.querySelector('a[href="https://chatgpt.com/settings/usage"]')?.textContent,
		).toBe('Manage usage')
		expect(text()).toContain('count against your ChatGPT plan')
	})

	it('resets only the counter of the chosen provider', async () => {
		render(CHATGPT, SIGNED_OUT, 4)
		await click(button('reset'))

		expect(resetChatGptRequests).toHaveBeenCalledOnce()
		expect(resetUsage).not.toHaveBeenCalled()
		expect(text()).toContain('Usage: 0 requests')
	})
})

describe('ChatGPT account', () => {
	it('signed out: offers Continue with ChatGPT and nothing else', async () => {
		vi.mocked(chatGpt.signIn).mockResolvedValue({ ok: true })
		render(CHATGPT)

		expect(container.querySelector('select')).toBeNull()
		expect(button('Sign out')).toBeUndefined()
		await click(button('Continue with ChatGPT'))
		expect(chatGpt.signIn).toHaveBeenCalledOnce()
		expect(container.querySelector('[role="alert"]')).toBeNull()
	})

	it('signed in: shows the email, the listed models by name in order, and sign out', () => {
		render(CHATGPT, SIGNED_IN)

		expect(text()).toContain('Signed in as reviewer@example.com')
		const options = [...container.querySelectorAll('option')]
		expect(options.map((option) => option.textContent)).toEqual([
			'GPT-6 Luna',
			'GPT-5.6 Terra',
			'GPT-5.6 Luna',
		])
		expect(container.querySelector('select')?.value).toBe('gpt-6-luna')
		expect(button('Sign out')).toBeDefined()
		expect(button('Continue with ChatGPT')).toBeUndefined()
	})

	it('keeps the chosen model and saves a new choice', async () => {
		render({ ...CHATGPT, chatgptModel: 'gpt-5.6-terra' }, SIGNED_IN)
		const select = container.querySelector('select') as HTMLSelectElement
		expect(select.value).toBe('gpt-5.6-terra')

		await act(async () => {
			select.value = 'gpt-5.6-luna'
			select.dispatchEvent(new Event('change', { bubbles: true }))
		})
		expect(writeSettings).toHaveBeenCalledWith({ chatgptModel: 'gpt-5.6-luna' })
	})

	it('signs out into the signed-out state', async () => {
		vi.mocked(chatGpt.signOut).mockResolvedValue(SIGNED_OUT)
		render(CHATGPT, SIGNED_IN)
		await click(button('Sign out'))

		expect(chatGpt.signOut).toHaveBeenCalledOnce()
		expect(button('Continue with ChatGPT')).toBeDefined()
		expect(text()).not.toContain('reviewer@example.com')
	})

	it('shows an error as one short line', () => {
		render(CHATGPT, {
			...SIGNED_IN,
			notice: 'ChatGPT plan usage limit reached. Check it in ChatGPT settings.',
		})

		const alerts = container.querySelectorAll('[role="alert"]')
		expect(alerts).toHaveLength(1)
		expect(alerts[0]?.textContent).toBe(
			'ChatGPT plan usage limit reached. Check it in ChatGPT settings.',
		)
	})

	it('shows a failed sign-in start', async () => {
		vi.mocked(chatGpt.signIn).mockResolvedValue({
			ok: false,
			message: 'ChatGPT sign-in failed. Try again.',
		})
		render(CHATGPT, { ...SIGNED_OUT, notice: undefined })
		await click(button('Continue with ChatGPT'))

		expect(container.querySelector('[role="alert"]')?.textContent).toBe(
			'ChatGPT sign-in failed. Try again.',
		)
	})

	it('signed out with a notice: asks to sign in again', () => {
		render(CHATGPT, { ...SIGNED_OUT, notice: 'Sign in to ChatGPT again.' })

		expect(container.querySelector('[role="alert"]')?.textContent).toBe('Sign in to ChatGPT again.')
		expect(button('Continue with ChatGPT')).toBeDefined()
	})
})
