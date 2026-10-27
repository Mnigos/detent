import { describe, expect, it } from 'vitest'
import { fileIds } from '../layers/file-ids'
import { condenseForPriorities } from './prompt'

describe('condenseForPriorities', () => {
	it('lists the title, description and numbered files with status and size, without generated ones', () => {
		const input = condenseForPriorities(
			[
				{ path: 'src/b.ts', role: 'server', status: 'modified', additions: 4, deletions: 2 },
				{ path: 'bun.lock', role: 'generated', status: 'modified', additions: 90, deletions: 9 },
				{ path: 'src/a.ts', role: 'contract', status: 'added', additions: 12, deletions: 0 },
			],
			{ title: 'Charge plans', body: 'Adds plan charging.' },
		)

		expect(input.startsWith('Pull request: Charge plans\nAdds plan charging.')).toBe(true)
		expect(input).toContain('at most 10 files')
		expect(input).toContain(
			'- src/a.ts [contract] added +12/-0 @1\n- src/b.ts [server] modified +4/-2 @2',
		)
		expect(input).not.toContain('bun.lock')
		expect(fileIds(input)).toEqual(
			new Map([
				['src/a.ts', '@1'],
				['src/b.ts', '@2'],
			]),
		)
	})
})
