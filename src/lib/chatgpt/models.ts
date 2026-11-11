import { API_URL, REQUEST_TIMEOUT_MILLISECONDS } from './account'
import { accessToken, invalidateAccessToken } from './session'

export const MODELS_URL = `${API_URL}/models`
const CACHE_MILLISECONDS = 10 * 60_000

export interface ChatGptModel {
	slug: string
	name: string
}

interface ListedModel {
	slug?: unknown
	id?: unknown
	display_name?: unknown
	visibility?: unknown
}

/** The models meant for a picker (`visibility: "list"`), in the server's order. */
export function listedModels(payload: unknown): ChatGptModel[] {
	const body = payload as { models?: unknown; data?: unknown } | undefined
	const models = Array.isArray(body?.models)
		? body.models
		: Array.isArray(body?.data)
			? body.data
			: []

	return (models as (ListedModel | null)[]).flatMap((model) => {
		if (!model || typeof model !== 'object') return []
		const slug = typeof model.slug === 'string' ? model.slug : model.id
		if (model.visibility !== 'list' || typeof slug !== 'string' || !slug) return []

		return [{ slug, name: typeof model.display_name === 'string' ? model.display_name : slug }]
	})
}

let cached: { at: number; models: Promise<ChatGptModel[]> } | undefined

/** Drops the cached list, e.g. when the signed-in account changes. */
export function forgetModels() {
	cached = undefined
}

/** The signed-in account's model catalog, cached for a few minutes. */
export function listModels(): Promise<ChatGptModel[]> {
	if (cached && Date.now() - cached.at < CACHE_MILLISECONDS) return cached.models

	const models = (async () => {
		const token = await accessToken()
		const response = await fetch(MODELS_URL, {
			headers: { Authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
		})
		if (response.status === 401) invalidateAccessToken(token)
		if (!response.ok) throw new Error(`models: HTTP ${response.status}`)

		return listedModels(await response.json())
	})()
	cached = { at: Date.now(), models }
	models.catch(() => {
		if (cached?.models === models) cached = undefined
	})

	return models
}
