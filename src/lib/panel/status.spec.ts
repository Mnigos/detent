import { describe, expect, it } from 'vitest'
import { STATUS_LINES, statusLineFor } from './status'

describe('statusLineFor', () => {
	it('names the OpenRouter model that produced the labels', () => {
		expect(
			statusLineFor({ source: 'model', labeler: 'openrouter', model: 'openai/gpt-5.6-luna' }),
		).toBe('Layer names from openai/gpt-5.6-luna.')
	})

	it('adds the cost of a fresh answer and leaves a cached one without it', () => {
		expect(
			statusLineFor({ source: 'model', labeler: 'openrouter', model: 'm', cost: 0.0123 }),
		).toBe('Layer names from m · $0.01.')
	})

	it.each([
		['unauthorized', STATUS_LINES.unauthorized],
		['credits', STATUS_LINES.credits],
		['timeout', STATUS_LINES.timeout],
		['request', STATUS_LINES.request],
		['invalid', STATUS_LINES.request],
	] as const)('explains an OpenRouter %s error', (kind, line) => {
		expect(
			statusLineFor({ source: 'fallback', labeler: 'none', model: 'x', error: { kind } }),
		).toBe(line)
	})

	it('asks for a key when there is none', () => {
		expect(statusLineFor({ source: 'fallback', labeler: 'none' })).toBe(STATUS_LINES.missingKey)
	})

	it('stays quiet when a model answer named none of the layers', () => {
		expect(
			statusLineFor({ source: 'fallback', labeler: 'openrouter', model: 'openai/gpt-5.6-luna' }),
		).toBe(STATUS_LINES.fallback)
	})

	it.each([
		[
			'unauthorized',
			'Sign in to ChatGPT again in the extension popup; layer names come from the file structure.',
		],
		['limit', 'ChatGPT plan usage limit reached; layer names come from the file structure.'],
		[
			'unavailable',
			'ChatGPT plan usage is unavailable right now; layer names come from the file structure.',
		],
		[
			'ineligible',
			'ChatGPT plan usage is not available for this account; layer names come from the file structure.',
		],
		['timeout', 'ChatGPT took too long; layer names come from the file structure.'],
		['invalid', 'ChatGPT request failed; layer names come from the file structure.'],
	] as const)('names ChatGPT for a %s error', (kind, line) => {
		expect(
			statusLineFor({ source: 'fallback', labeler: 'none', error: { kind, provider: 'chatgpt' } }),
		).toBe(line)
	})

	it('shows a ChatGPT answer without a cost', () => {
		expect(statusLineFor({ source: 'model', labeler: 'chatgpt', model: 'gpt-6-luna' })).toBe(
			'Layer names from gpt-6-luna.',
		)
	})
})
