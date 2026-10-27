import { describe, expect, it } from 'vitest'
import { fileIds, resolveFileIds } from './file-ids'

const INPUT = [
	'Pull request: T',
	'',
	'- apps/api/src/a.ts [server] +1/-0 @1',
	'- apps/web/src/b.tsx [ui] +2/-1 @2 needs @1 :: signal',
	'not a file line @3',
].join('\n')

describe('file ids', () => {
	it('reads the @number of every file line', () => {
		expect([...fileIds(INPUT)]).toEqual([
			['apps/api/src/a.ts', '@1'],
			['apps/web/src/b.tsx', '@2'],
		])
	})

	it('resolves @numbers in an answer and leaves paths and unknown numbers alone', () => {
		expect(
			resolveFileIds(
				[
					{
						name: 'Step',
						summary: 'S.',
						files: ['@2', ' @1', 'apps/api/src/a.ts', '@9'],
						focus: ['@2'],
					},
				],
				fileIds(INPUT),
			),
		).toEqual([
			{
				name: 'Step',
				summary: 'S.',
				files: ['apps/web/src/b.tsx', 'apps/api/src/a.ts', 'apps/api/src/a.ts', '@9'],
				focus: ['apps/web/src/b.tsx'],
			},
		])
	})
})
