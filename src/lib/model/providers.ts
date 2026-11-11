import { chatGptProvider } from '../chatgpt/provider'
import type { Settings } from '../settings'
import { groupLayersWithOpenRouter, prioritizeWithOpenRouter } from './openrouter'
import type { ModelProvider } from './provider'
import { recordUsage } from './usage'

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
	if (settings.provider === 'chatgpt') return chatGptProvider(settings)

	return settings.openRouterKey ? openRouterProvider(settings) : undefined
}
