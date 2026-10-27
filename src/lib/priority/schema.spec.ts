import { describe, expect, it } from 'vitest'
import { PRIORITY_SCHEMA, parsePriorityResponse, toPriorityEntries } from './schema'

describe('parsePriorityResponse', () => {
	it.each(['medium', 'low'])('drops the reason entirely for %s', (priority) => {
		expect(
			parsePriorityResponse(
				JSON.stringify({ files: [{ file: '@1', priority, reason: 'Discard this.' }] }),
			),
		).toEqual([{ path: '@1', priority }])
	})

	it.each(['critical', '', 'urgent!', 1, null, {}, ['urgent']])(
		'rejects invalid priority %j without losing valid neighbors',
		(priority) => {
			expect(
				parsePriorityResponse(
					JSON.stringify({
						files: [
							{ file: '@1', priority, reason: 'Invalid.' },
							{ file: '@2', priority: 'high', reason: 'Valid.' },
						],
					}),
				),
			).toEqual([{ path: '@2', priority: 'high', reason: 'Valid.' }])
		},
	)

	it('reads ranked files and keeps reasons only on Urgent and High', () => {
		const text = JSON.stringify({
			files: [
				{ file: '@2', priority: 'urgent', reason: ' Breaks login. ' },
				{ file: '@1', priority: 'medium', reason: 'Wiring only.' },
				{ file: '@3', priority: 'high', reason: '' },
			],
		})

		expect(parsePriorityResponse(text)).toEqual([
			{ path: '@2', priority: 'urgent', reason: 'Breaks login.' },
			{ path: '@1', priority: 'medium' },
			{ path: '@3', priority: 'high' },
		])
	})

	it('drops entries without a file or a known priority and keeps the first entry of a file', () => {
		expect(
			toPriorityEntries([
				{ file: '@1', priority: 'critical' },
				{ priority: 'high' },
				{ file: '@2', priority: 'HIGH', reason: 'x'.repeat(300) },
				{ file: '@2', priority: 'low' },
				null,
				'@3',
			]),
		).toEqual([{ path: '@2', priority: 'high', reason: 'x'.repeat(140) }])
	})

	it('reads saved entries by path', () => {
		expect(toPriorityEntries([{ path: 'src/a.ts', priority: 'low' }])).toEqual([
			{ path: 'src/a.ts', priority: 'low' },
		])
	})

	it.each(['not json', '{}', '{"files":[]}', '{"files":"@1"}', 'null'])(
		'returns nothing for %s',
		(text) => {
			expect(parsePriorityResponse(text)).toBeUndefined()
		},
	)

	it('asks for every field strictly, with the four priorities as an enum', () => {
		const item = PRIORITY_SCHEMA.properties.files.items

		expect(item.required).toEqual(['file', 'priority', 'reason'])
		expect(item.properties.priority.enum).toEqual(['urgent', 'high', 'medium', 'low'])
	})
})
