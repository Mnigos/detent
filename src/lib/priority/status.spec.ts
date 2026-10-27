import { describe, expect, it } from 'vitest'
import { STATUS_LINES } from '../panel/status'
import { PRIORITY_LINES, priorityStatusFor } from './status'

describe('priorityStatusFor', () => {
	it('uses the exact structural fallback line when a configured labeler has no ranking', () => {
		expect(priorityStatusFor({ source: 'fallback', labeler: 'openrouter' })).toBe(
			'Priorities come from the file structure.',
		)
	})

	it.each([
		[0, '$0.00'],
		[0.002, '$0.0020'],
		[1.235, '$1.24'],
	])('formats cost %s as %s', (cost, formatted) => {
		expect(
			priorityStatusFor({ source: 'model', labeler: 'openrouter', model: 'vendor/model', cost }),
		).toBe(`Priorities from vendor/model · ${formatted}.`)
	})

	it('names the model and the cost of a fresh answer', () => {
		expect(priorityStatusFor({ source: 'model', labeler: 'openrouter', model: 'm' })).toBe(
			'Priorities from m.',
		)
		expect(
			priorityStatusFor({ source: 'model', labeler: 'openrouter', model: 'm', cost: 0.0123 }),
		).toBe('Priorities from m · $0.01.')
	})

	it.each([
		['unauthorized', STATUS_LINES.unauthorized],
		['credits', STATUS_LINES.credits],
		['timeout', PRIORITY_LINES.timeout],
		['request', PRIORITY_LINES.request],
		['invalid', PRIORITY_LINES.request],
	] as const)('explains a %s error', (kind, line) => {
		expect(priorityStatusFor({ source: 'fallback', labeler: 'none', error: { kind } })).toBe(line)
	})

	it('asks for a key when there is none and reports a failed save', () => {
		expect(priorityStatusFor({ source: 'fallback', labeler: 'none' })).toBe(
			PRIORITY_LINES.missingKey,
		)
		expect(
			priorityStatusFor({ source: 'model', labeler: 'openrouter', model: 'm', cacheError: true }),
		).toBe('Priorities ready, but could not be saved. Reloading may rank them again.')
	})
})
