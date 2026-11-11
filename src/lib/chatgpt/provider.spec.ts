import { beforeEach, describe, expect, it, vi } from 'vitest'
import { vaultStore } from '../../test/memory-vault'
import { recordChatGptRequest } from '../model/usage'
import { DEFAULT_SETTINGS } from '../settings'
import { listModels } from './models'
import { chatGptProvider, LIMIT_NOTICE, resumeAfterLimit } from './provider'
import { respond } from './responses'
import { accessToken, invalidateAccessToken, SignInRequired } from './session'

vi.mock('./vault', () => import('../../test/memory-vault'))
vi.mock('./models', () => ({ listModels: vi.fn() }))
vi.mock('./session', async (original) => ({
	...(await original<typeof import('./session')>()),
	accessToken: vi.fn(),
	invalidateAccessToken: vi.fn(),
}))
vi.mock('./responses', async (original) => ({
	...(await original<typeof import('./responses')>()),
	respond: vi.fn(),
}))
vi.mock('../model/usage', () => ({ recordChatGptRequest: vi.fn(async () => 1) }))

const SETTINGS = { ...DEFAULT_SETTINGS, provider: 'chatgpt' as const, chatgptModel: 'gpt-6-luna' }
const LAYERS = [{ name: 'Start', summary: 'Read it.', files: ['a.ts'] }]

beforeEach(() => {
	vi.clearAllMocks()
	vaultStore.clear()
	resumeAfterLimit()
	vaultStore.set('account', { clientId: 'oaiapp_issued', tokens: { accessToken: 'access-1' } })
	vi.mocked(accessToken).mockResolvedValue('access-1')
	vi.mocked(listModels).mockResolvedValue([])
	vi.mocked(respond).mockResolvedValue({
		text: JSON.stringify({ layers: LAYERS }),
		isCharged: true,
	})
})

describe('chatGptProvider', () => {
	it('is not set up while signed out', async () => {
		vaultStore.delete('account')
		await expect(chatGptProvider(SETTINGS)).resolves.toBeUndefined()
	})

	it('keys answers by provider and model, groups with the layers schema and counts the request', async () => {
		const provider = await chatGptProvider(SETTINGS)

		expect(provider).toMatchObject({
			id: 'chatgpt',
			model: 'gpt-6-luna',
			labeler: 'chatgpt:gpt-6-luna',
		})
		await expect(provider?.group('input')).resolves.toEqual({ value: LAYERS })
		const [token, request] = vi.mocked(respond).mock.calls[0] ?? []
		expect(token).toBe('access-1')
		expect(request).toMatchObject({ model: 'gpt-6-luna', text: { format: { name: 'layers' } } })
		expect(recordChatGptRequest).toHaveBeenCalledOnce()
	})

	it('ranks with the priorities schema', async () => {
		const files = [{ file: '@1', priority: 'urgent', reason: 'Auth.' }]
		vi.mocked(respond).mockResolvedValue({ text: JSON.stringify({ files }), isCharged: true })
		const provider = await chatGptProvider(SETTINGS)

		await expect(provider?.prioritize('input')).resolves.toMatchObject({
			value: [expect.objectContaining({ path: '@1' })],
		})
		expect(vi.mocked(respond).mock.calls[0]?.[1]).toMatchObject({
			text: { format: { name: 'priorities' } },
		})
	})

	it('replaces a saved model the account no longer lists, as the popup shows it', async () => {
		vi.mocked(listModels).mockResolvedValue([{ slug: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' }])
		await expect(chatGptProvider(SETTINGS)).resolves.toMatchObject({
			model: 'gpt-5.6-terra',
			labeler: 'chatgpt:gpt-5.6-terra',
		})
	})

	it('keeps the saved model when the list cannot be loaded', async () => {
		vi.mocked(listModels).mockRejectedValue(new Error('offline'))
		await expect(chatGptProvider(SETTINGS)).resolves.toMatchObject({ model: 'gpt-6-luna' })
	})

	it('asks gpt-6-luna under its usual cache key when nothing is chosen and the list fails', async () => {
		vi.mocked(listModels).mockRejectedValue(new Error('HTTP 503'))
		const provider = await chatGptProvider({ ...SETTINGS, chatgptModel: '' })

		expect(provider).toMatchObject({ model: 'gpt-6-luna', labeler: 'chatgpt:gpt-6-luna' })
		await expect(provider?.group('input')).resolves.toEqual({ value: LAYERS })
	})

	it('takes the Luna default when none is chosen', async () => {
		vi.mocked(listModels).mockResolvedValue([
			{ slug: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' },
			{ slug: 'gpt-6-luna', name: 'GPT-6 Luna' },
		])
		await expect(chatGptProvider({ ...SETTINGS, chatgptModel: '' })).resolves.toMatchObject({
			model: 'gpt-6-luna',
		})
	})

	it('pauses after a usage-limit answer and says so in the popup', async () => {
		vi.mocked(respond).mockResolvedValue({
			error: { kind: 'limit', status: 429, provider: 'chatgpt' },
			isCharged: false,
		})
		const provider = await chatGptProvider(SETTINGS)

		await expect(provider?.group('input')).resolves.toMatchObject({ error: { kind: 'limit' } })
		await expect(provider?.prioritize('input')).resolves.toEqual({
			error: { kind: 'limit', provider: 'chatgpt' },
		})
		expect(respond).toHaveBeenCalledOnce()
		expect(vaultStore.get('notice')).toBe(LIMIT_NOTICE)
		expect(recordChatGptRequest).not.toHaveBeenCalled()
	})

	it('asks for a new sign-in when the session is gone', async () => {
		vi.mocked(accessToken).mockRejectedValue(new SignInRequired())
		const provider = await chatGptProvider(SETTINGS)

		await expect(provider?.group('input')).resolves.toEqual({
			error: { kind: 'unauthorized', provider: 'chatgpt' },
		})
		expect(respond).not.toHaveBeenCalled()
	})

	it('drops an access token the API refused', async () => {
		vi.mocked(respond).mockResolvedValue({
			error: { kind: 'unauthorized', status: 401, provider: 'chatgpt' },
			isCharged: false,
		})
		await (await chatGptProvider(SETTINGS))?.group('input')

		expect(invalidateAccessToken).toHaveBeenCalledWith('access-1')
	})

	it('reports an answer outside the schema as invalid', async () => {
		vi.mocked(respond).mockResolvedValue({ text: 'not json', isCharged: true })
		await expect((await chatGptProvider(SETTINGS))?.group('input')).resolves.toEqual({
			error: { kind: 'invalid', provider: 'chatgpt' },
		})
	})
})
