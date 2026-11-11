import type { GroupingEntry } from '../layers/grouping'
import type { PriorityEntry } from '../priority/schema'

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
