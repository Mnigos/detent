import { GROUPING_SCHEMA, parseGroupingResponse } from '../layers/grouping'
import { timeoutFor } from '../model/openrouter'
import { failure, type ModelProvider, type ProviderAnswer } from '../model/provider'
import { recordChatGptRequest } from '../model/usage'
import { PRIORITY_SCHEMA, parsePriorityResponse } from '../priority/schema'
import type { Settings } from '../settings'
import { clearNotice, readAccount, setNotice } from './account'
import { pickModel } from './messages'
import { listModels } from './models'
import { respond, responsesRequest } from './responses'
import { accessToken, invalidateAccessToken, SignInRequired } from './session'

// After a usage-limit answer detent stops asking for a while instead of failing every page.
export const LIMIT_PAUSE_MILLISECONDS = 10 * 60_000
export const LIMIT_NOTICE = 'ChatGPT plan usage limit reached. Check it in ChatGPT settings.'
const INELIGIBLE_NOTICE = 'ChatGPT plan usage is not available for this account.'

let pausedUntil = 0

/** For tests: forget a usage-limit pause. */
export function resumeAfterLimit() {
	pausedUntil = 0
}

async function ask<T>(
	model: string,
	input: string,
	name: string,
	schema: object,
	parse: (text: string) => T | undefined,
): Promise<ProviderAnswer<T>> {
	if (!model) return { error: failure('request', 'chatgpt') }
	if (Date.now() < pausedUntil) return { error: failure('limit', 'chatgpt') }

	let token: string
	try {
		token = await accessToken()
	} catch (error) {
		return {
			error: failure(error instanceof SignInRequired ? 'unauthorized' : 'request', 'chatgpt'),
		}
	}
	const answer = await respond(
		token,
		responsesRequest(model, input, name, schema),
		timeoutFor(input),
	)
	if (answer.isCharged) await recordChatGptRequest().catch(() => undefined)
	const { error } = answer
	if (error?.kind === 'unauthorized') invalidateAccessToken(token)
	if (error?.kind === 'limit') {
		pausedUntil = Date.now() + LIMIT_PAUSE_MILLISECONDS
		await setNotice(LIMIT_NOTICE)
	}
	if (error?.kind === 'ineligible') await setNotice(INELIGIBLE_NOTICE)
	if (error) return { error }

	await clearNotice()
	const value = parse(answer.text ?? '')

	return value ? { value } : { error: failure('invalid', 'chatgpt') }
}

/**
 * ChatGPT, when an account is signed in with plan usage. The model is the one chosen in the popup,
 * or a Luna model when the account lists one, else the first listed.
 */
export async function chatGptProvider({
	chatgptModel,
}: Settings): Promise<ModelProvider | undefined> {
	if (!(await readAccount())?.tokens) return undefined

	// A saved model the account no longer lists falls back to the default, as the popup shows it.
	// Without the list (offline) the saved choice is used as it is.
	const models = await listModels().catch(() => [])
	const model = pickModel(chatgptModel, models)
	return {
		id: 'chatgpt',
		model,
		labeler: `chatgpt:${model}`,
		group: (input) => ask(model, input, 'layers', GROUPING_SCHEMA, parseGroupingResponse),
		prioritize: (input) => ask(model, input, 'priorities', PRIORITY_SCHEMA, parsePriorityResponse),
	}
}
