import type { GroupingEntry } from '../layers/grouping'
import type { PriorityEntry } from '../priority/schema'
import type { Settings } from '../settings'
import { groupLayersWithOpenRouter, prioritizeWithOpenRouter } from './openrouter'
import { recordUsage } from './usage'

export type ProviderId = 'openrouter' | 'chatgpt'

export const PROVIDER_NAMES: Record<ProviderId, string> = {
	openrouter: 'OpenRouter',
	chatgpt: 'ChatGPT',
}

export interface ModelError {
	kind:
		| 'unauthorized'
		| 'credits'
		| 'request'
		| 'timeout'
		| 'invalid'
		/** The ChatGPT plan (or detent's share of it) is used up for now. */
		| 'limit'
		/** ChatGPT could not check plan usage; worth another try later. */
		| 'unavailable'
		/** ChatGPT plan usage is not allowed for this account, workspace or region. */
		| 'ineligible'
	status?: number
	/** Which provider failed, so the page can name it; absent means OpenRouter. */
	provider?: ProviderId
}

/** An error detent raises itself; OpenRouter errors stay untagged as they always were. */
export const failure = (kind: ModelError['kind'], provider: ProviderId): ModelError =>
	provider === 'openrouter' ? { kind } : { kind, provider }

export interface ProviderAnswer<T> {
	value?: T
	error?: ModelError
	/** US dollars, when the provider bills per request. */
	cost?: number
}

/** One configured model behind the Layers grouping and the Priority Review ranking. */
export interface ModelProvider {
	id: ProviderId
	model: string
	/** Cache and in-flight key: answers of one provider and model are never served for another. */
	labeler: string
	group(input: string): Promise<ProviderAnswer<GroupingEntry[]>>
	prioritize(input: string): Promise<ProviderAnswer<PriorityEntry[]>>
}

export function openRouterProvider({ openRouterKey: key, model }: Settings): ModelProvider {
	return {
		id: 'openrouter',
		model,
		labeler: `openrouter:${model}`,
		async group(input) {
			const { layers, error, usage } = await groupLayersWithOpenRouter({ key, model, input })
			if (usage) await recordUsage(usage).catch(() => undefined)

			return { value: layers, error, cost: usage?.cost }
		},
		async prioritize(input) {
			const { priorities, error, usage } = await prioritizeWithOpenRouter({ key, model, input })
			if (usage) await recordUsage(usage).catch(() => undefined)

			return { value: priorities, error, cost: usage?.cost }
		},
	}
}

/** The provider chosen in the popup, or nothing when it is not set up: then detent stays local. */
export async function resolveProvider(settings: Settings): Promise<ModelProvider | undefined> {
	if (settings.provider === 'openrouter')
		return settings.openRouterKey ? openRouterProvider(settings) : undefined

	return undefined
}
