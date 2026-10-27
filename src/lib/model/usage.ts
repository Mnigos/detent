import { browser } from 'wxt/browser'

export const USAGE_KEY = 'usage'

/** What this extension has spent on OpenRouter since the counter was last reset. */
export interface Usage {
	requests: number
	promptTokens: number
	completionTokens: number
	/** US dollars, as OpenRouter reports them per response. */
	cost: number
}

export interface UsageDelta {
	promptTokens: number
	completionTokens: number
	cost: number
}

export const EMPTY_USAGE: Usage = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 }

const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

export async function readUsage(): Promise<Usage> {
	const stored = (await browser.storage.local.get(USAGE_KEY))[USAGE_KEY] as
		| Partial<Usage>
		| undefined

	return {
		requests: number(stored?.requests),
		promptTokens: number(stored?.promptTokens),
		completionTokens: number(stored?.completionTokens),
		cost: number(stored?.cost),
	}
}

let pending: Promise<unknown> = Promise.resolve()

// Grouping and ranking answers land together; one queue keeps each read-add-write from losing the other.
export function recordUsage(delta: UsageDelta): Promise<Usage> {
	const write = pending.then(async () => {
		const previous = await readUsage()
		const usage: Usage = {
			requests: previous.requests + 1,
			promptTokens: previous.promptTokens + delta.promptTokens,
			completionTokens: previous.completionTokens + delta.completionTokens,
			cost: previous.cost + delta.cost,
		}
		await browser.storage.local.set({ [USAGE_KEY]: usage })

		return usage
	})
	pending = write.catch(() => undefined)

	return write
}

export async function resetUsage(): Promise<void> {
	await browser.storage.local.remove(USAGE_KEY)
}

/** OpenRouter's `usage` block of a completion, when the request asked for it. */
export function usageOf(payload: unknown): UsageDelta | undefined {
	const usage = (payload as { usage?: Record<string, unknown> } | undefined)?.usage
	if (!usage || typeof usage !== 'object') return undefined

	return {
		promptTokens: number(usage.prompt_tokens),
		completionTokens: number(usage.completion_tokens),
		cost: number(usage.cost),
	}
}

export const formatCost = (cost: number) =>
	`$${cost < 0.01 && cost > 0 ? cost.toFixed(4) : cost.toFixed(2)}`
