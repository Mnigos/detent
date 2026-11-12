// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type ChatGptStatus, chatGpt, SIGNED_OUT } from '@/src/lib/chatgpt/messages'
import { EMPTY_USAGE, requestUsageReset } from '@/src/lib/model/usage'
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
	requestUsageReset: vi.fn(async () => true),
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

async function render(
	settings: Settings,
	chatgpt: ChatGptStatus = SIGNED_OUT,
	chatgptRequests = 0,
) {
	await act(async () =>
		root.render(
			<App
				settings={settings}
				usage={{ ...EMPTY_USAGE, requests: 2, cost: 0.0123 }}
				chatgpt={Promise.resolve(chatgpt)}
				chatgptRequests={chatgptRequests}
			/>,
		),
	)
}
const button = (name: string) =>
	[...container.querySelectorAll('button')].find(
		(element) => element.textContent === name && visible(element),
	)
// Hidden provider sections stay mounted; only what is shown counts.
const visible = (element: Element) => !element.closest('[hidden]')
const text = () =>
	[...container.querySelectorAll('p, span, label, legend, button, a, option')]
		.filter(visible)
		.map((element) => element.textContent)
		.join(' ')
const click = async (element: Element | undefined) => {
	await act(async () => {
		;(element as HTMLElement).click()
	})
}

describe('switches', () => {
	const checkbox = (label: string) =>
		[...container.querySelectorAll('label')]
			.find((element) => element.textContent?.includes(label))
			?.querySelector<HTMLInputElement>('input[type="checkbox"]') ?? undefined

	it('saves only the image preview switch when it is turned off', async () => {
		await render(DEFAULT_SETTINGS)
		const preview = checkbox('Preview images from descriptions and comments')
		expect(preview?.checked).toBe(true)

		await click(preview)

		expect(writeSettings).toHaveBeenCalledExactlyOnceWith({ showImagePreview: false })
		expect(preview?.checked).toBe(false)
	})

	it('shows the stored image preview switch off', async () => {
		await render({ ...DEFAULT_SETTINGS, showImagePreview: false })

		expect(checkbox('Preview images from descriptions and comments')?.checked).toBe(false)
	})
})

describe('provider choice', () => {
	it('shows the OpenRouter key and cost counter by default', async () => {
		await render(DEFAULT_SETTINGS)

		expect(text()).toContain('OpenRouter API key')
		expect(text()).toContain('Usage: $0.01 · 2 requests')
		expect(button('Continue with ChatGPT')).toBeUndefined()
	})

	it('switches to ChatGPT, saves the choice and shows the request count without a cost', async () => {
		await render(DEFAULT_SETTINGS, SIGNED_OUT, 1)
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

	it('asks the worker about ChatGPT only once ChatGPT is chosen', async () => {
		vi.mocked(chatGpt.status).mockResolvedValue(SIGNED_OUT)
		await act(async () =>
			root.render(<App settings={DEFAULT_SETTINGS} usage={EMPTY_USAGE} chatgptRequests={0} />),
		)
		expect(chatGpt.status).not.toHaveBeenCalled()

		await click(container.querySelector('input[value="chatgpt"]') ?? undefined)
		expect(chatGpt.status).toHaveBeenCalledOnce()
		expect(button('Continue with ChatGPT')).toBeDefined()
		await click(container.querySelector('input[value="openrouter"]') ?? undefined)
		await click(container.querySelector('input[value="chatgpt"]') ?? undefined)
		expect(chatGpt.status).toHaveBeenCalledOnce()
	})

	it('says what reaches OpenAI besides the pull requests', async () => {
		await render(CHATGPT)
		expect(text()).toContain('Signing in and loading the model list also reach OpenAI.')
	})

	it('resets only the counter of the chosen provider', async () => {
		await render(CHATGPT, SIGNED_OUT, 4)
		await click(button('reset'))

		expect(requestUsageReset).toHaveBeenCalledExactlyOnceWith('chatgpt')
		expect(text()).toContain('Usage: 0 requests')
	})

	it('keeps the shown count when the worker could not reset it', async () => {
		vi.mocked(requestUsageReset).mockResolvedValueOnce(false)
		await render(CHATGPT, SIGNED_OUT, 4)
		await click(button('reset'))

		expect(text()).toContain('Usage: 4 requests')
	})
})

describe('ChatGPT account', () => {
	it('signed out: offers Continue with ChatGPT and nothing else', async () => {
		vi.mocked(chatGpt.signIn).mockResolvedValue({ ok: true })
		await render(CHATGPT)

		expect(container.querySelector('select')).toBeNull()
		expect(button('Sign out')).toBeUndefined()
		await click(button('Continue with ChatGPT'))
		expect(chatGpt.signIn).toHaveBeenCalledOnce()
		expect(container.querySelector('[role="alert"]')).toBeNull()
	})

	it('keeps typed and saved values when switching providers back and forth', async () => {
		vi.mocked(chatGpt.signOut).mockResolvedValue(SIGNED_OUT)
		await render(CHATGPT, SIGNED_IN)
		await click(button('Sign out'))
		await click(container.querySelector('input[value="openrouter"]') ?? undefined)
		const key = container.querySelector('input[type="password"]') as HTMLInputElement
		await act(async () => {
			const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
			setValue?.call(key, 'sk-or-new')
			key.dispatchEvent(new Event('input', { bubbles: true }))
		})
		await click(container.querySelector('input[value="chatgpt"]') ?? undefined)
		expect(button('Continue with ChatGPT')).toBeDefined()
		await click(container.querySelector('input[value="openrouter"]') ?? undefined)

		expect((container.querySelector('input[type="password"]') as HTMLInputElement).value).toBe(
			'sk-or-new',
		)
	})

	it('shows the OpenRouter settings at once while ChatGPT has not answered', async () => {
		await act(async () =>
			root.render(
				<App
					settings={DEFAULT_SETTINGS}
					usage={EMPTY_USAGE}
					chatgpt={new Promise(() => {})}
					chatgptRequests={0}
				/>,
			),
		)

		expect(text()).toContain('OpenRouter API key')
		expect((container.querySelector('input[type="password"]') as HTMLInputElement).disabled).toBe(
			false,
		)
	})

	it('signed in: shows the email, the listed models by name in order, and sign out', async () => {
		await render(CHATGPT, SIGNED_IN)

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

	it('selects a Luna model by default even when a heavier one is listed first', async () => {
		await render(CHATGPT, {
			...SIGNED_IN,
			models: [{ slug: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' }, ...SIGNED_IN.models],
		})
		expect(container.querySelector('select')?.value).toBe('gpt-6-luna')
	})

	it('keeps the chosen model and saves a new choice', async () => {
		await render({ ...CHATGPT, chatgptModel: 'gpt-5.6-terra' }, SIGNED_IN)
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
		await render(CHATGPT, SIGNED_IN)
		await click(button('Sign out'))

		expect(chatGpt.signOut).toHaveBeenCalledOnce()
		expect(button('Continue with ChatGPT')).toBeDefined()
		expect(text()).not.toContain('reviewer@example.com')
	})

	it('shows an error as one short line', async () => {
		await render(CHATGPT, {
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
		await render(CHATGPT, { ...SIGNED_OUT, notice: undefined })
		await click(button('Continue with ChatGPT'))

		expect(container.querySelector('[role="alert"]')?.textContent).toBe(
			'ChatGPT sign-in failed. Try again.',
		)
	})

	it('signed out with a notice: asks to sign in again', async () => {
		await render(CHATGPT, { ...SIGNED_OUT, notice: 'Sign in to ChatGPT again.' })

		expect(container.querySelector('[role="alert"]')?.textContent).toBe('Sign in to ChatGPT again.')
		expect(button('Continue with ChatGPT')).toBeDefined()
	})
})
