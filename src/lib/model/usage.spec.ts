import { beforeEach, describe, expect, it, vi } from 'vitest'
import { browser } from 'wxt/browser'
import { formatCost, readUsage, recordUsage, resetUsage, usageOf } from './usage'

vi.mock('wxt/browser', () => ({
	browser: { storage: { local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } } },
}))

let stored: Record<string, unknown>

beforeEach(() => {
	stored = {}
	vi.mocked(browser.storage.local.get).mockImplementation(async (key) => ({
		[String(key)]: stored[String(key)],
	}))
	vi.mocked(browser.storage.local.set).mockImplementation(async (items) => {
		Object.assign(stored, items)
	})
	vi.mocked(browser.storage.local.remove).mockImplementation(async (key) => {
		delete stored[String(key)]
	})
})

describe('usage counter', () => {
	it('counts grouping and ranking answers that land at the same time', async () => {
		const delta = { promptTokens: 10, completionTokens: 2, cost: 0.001 }
		await Promise.all([recordUsage(delta), recordUsage(delta), recordUsage(delta)])

		expect(await readUsage()).toEqual({
			requests: 3,
			promptTokens: 30,
			completionTokens: 6,
			cost: 0.003,
		})
	})

	it('starts empty, sums every recorded response and resets to nothing', async () => {
		expect(await readUsage()).toEqual({
			requests: 0,
			promptTokens: 0,
			completionTokens: 0,
			cost: 0,
		})
		await recordUsage({ promptTokens: 1000, completionTokens: 200, cost: 0.01 })
		const usage = await recordUsage({ promptTokens: 500, completionTokens: 100, cost: 0.005 })
		expect(usage).toEqual({ requests: 2, promptTokens: 1500, completionTokens: 300, cost: 0.015 })
		expect(await readUsage()).toEqual(usage)
		await resetUsage()
		expect((await readUsage()).requests).toBe(0)
	})

	it('reads the OpenRouter usage block and ignores a missing or malformed one', () => {
		expect(usageOf({ usage: { prompt_tokens: 12, completion_tokens: 3, cost: 0.0004 } })).toEqual({
			promptTokens: 12,
			completionTokens: 3,
			cost: 0.0004,
		})
		expect(usageOf({ usage: { prompt_tokens: 'x' } })).toEqual({
			promptTokens: 0,
			completionTokens: 0,
			cost: 0,
		})
		expect(usageOf({})).toBeUndefined()
		expect(usageOf(undefined)).toBeUndefined()
	})

	it('formats tiny costs with more precision than cents', () => {
		expect(formatCost(0)).toBe('$0.00')
		expect(formatCost(0.0034)).toBe('$0.0034')
		expect(formatCost(1.5)).toBe('$1.50')
	})
})
