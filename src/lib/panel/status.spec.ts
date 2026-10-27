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
})
