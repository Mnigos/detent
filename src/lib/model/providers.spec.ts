import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../settings'
import { groupLayersWithOpenRouter, prioritizeWithOpenRouter } from './openrouter'
import { failure } from './provider'
import { resolveProvider } from './providers'
import { recordUsage } from './usage'

vi.mock('./openrouter', () => ({
	groupLayersWithOpenRouter: vi.fn(),
	prioritizeWithOpenRouter: vi.fn(),
}))
vi.mock('./usage', () => ({ recordUsage: vi.fn(async () => undefined) }))

const USAGE = { promptTokens: 10, completionTokens: 2, cost: 0.002 }

beforeEach(() => {
	vi.clearAllMocks()
})

describe('resolveProvider', () => {
	it('has no provider without an OpenRouter key', async () => {
		await expect(resolveProvider(DEFAULT_SETTINGS)).resolves.toBeUndefined()
	})

	it('keys OpenRouter answers by provider and model and records their cost', async () => {
		vi.mocked(groupLayersWithOpenRouter).mockResolvedValue({ layers: [], usage: USAGE })
		vi.mocked(prioritizeWithOpenRouter).mockResolvedValue({ error: { kind: 'credits' } })
		const provider = await resolveProvider({ ...DEFAULT_SETTINGS, openRouterKey: 'k', model: 'm' })

		expect(provider).toMatchObject({ id: 'openrouter', model: 'm', labeler: 'openrouter:m' })
		await expect(provider?.group('input')).resolves.toEqual({ value: [], cost: 0.002 })
		expect(groupLayersWithOpenRouter).toHaveBeenCalledWith({ key: 'k', model: 'm', input: 'input' })
		expect(recordUsage).toHaveBeenCalledExactlyOnceWith(USAGE)
		await expect(provider?.prioritize('input')).resolves.toEqual({ error: { kind: 'credits' } })
	})
})

describe('failure', () => {
	it('tags only non-OpenRouter errors with their provider', () => {
		expect(failure('invalid', 'openrouter')).toEqual({ kind: 'invalid' })
		expect(failure('limit', 'chatgpt')).toEqual({ kind: 'limit', provider: 'chatgpt' })
	})
})
