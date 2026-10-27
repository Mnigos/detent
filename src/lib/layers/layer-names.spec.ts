import { describe, expect, it } from 'vitest'
import type { Draft } from './layer-budget'
import { baseName, nameDrafts } from './layer-names'

const draft = (...core: string[]): Draft => ({ core, attached: [], rank: 1 })

const named = (drafts: Draft[]) => nameDrafts(drafts).map((entry) => [entry.name, entry.core])

describe('baseName', () => {
	it('uses the last two specific segments of the common directory', () => {
		expect(
			baseName(['apps/web/src/modules/billing/a.tsx', 'apps/web/src/modules/billing/b.tsx']),
		).toBe('web · billing')
	})

	it.each([
		[['apps/api/src/a.service.ts', 'apps/web/src/b.tsx'], 'API changes'],
		[['apps/web/src/a.tsx', 'apps/web/src/b.tsx', 'apps/api/src/c.service.ts'], 'Web changes'],
		[['packages/contracts/a.ts', 'packages/domain/b.ts'], 'Shared changes'],
		[['LICENSE', 'CODEOWNERS'], 'Other changes'],
	])('names %j after its dominant role', (core, name) => {
		expect(baseName(core)).toBe(name)
	})
})

describe('nameDrafts', () => {
	it('keeps distinct names and fixed names as they are', () => {
		const fixed = { ...draft('bun.lock'), name: 'Generated' }

		expect(named([draft('apps/api/src/a.ts'), draft('apps/web/src/b.tsx'), fixed])).toEqual([
			['api', ['apps/api/src/a.ts']],
			['web', ['apps/web/src/b.tsx']],
			['Generated', ['bun.lock']],
		])
	})

	it('appends the branch most files sit in when two layers share a directory', () => {
		const result = named([
			draft('apps/web/src/billing/a.tsx', 'apps/web/src/shared/x.tsx'),
			draft('apps/web/src/profile/a.tsx', 'apps/web/src/profile/b.tsx', 'apps/web/src/hooks/h.ts'),
		])

		expect(result.map(([name]) => name)).toEqual(['web · billing', 'web · profile'])
	})

	it('appends the directory that tells layers with the same tail apart', () => {
		const result = named([
			draft(
				'apps/web/src/modules/billing/components/a.tsx',
				'apps/web/src/modules/billing/components/b.tsx',
			),
			draft(
				'apps/api/src/modules/billing/components/a.ts',
				'apps/api/src/modules/billing/components/b.ts',
			),
		])

		expect(result.map(([name]) => name)).toEqual([
			'billing · components · web',
			'billing · components · api',
		])
	})

	it('merges layers nothing distinguishes into the earlier one', () => {
		const result = named([
			draft('apps/web/src/billing/a.tsx', 'apps/web/src/shared/x.tsx'),
			draft('apps/api/src/z.ts'),
			draft('apps/web/src/billing/b.tsx', 'apps/web/src/shared/y.tsx'),
		])

		expect(result).toEqual([
			[
				'web',
				[
					'apps/web/src/billing/a.tsx',
					'apps/web/src/billing/b.tsx',
					'apps/web/src/shared/x.tsx',
					'apps/web/src/shared/y.tsx',
				],
			],
			['api', ['apps/api/src/z.ts']],
		])
	})

	it('never returns two layers with the same name', () => {
		const drafts = Array.from({ length: 6 }, (_, index) =>
			draft(`apps/web/src/modules/feature/part-${index % 2}/file-${index}.tsx`),
		)
		const names = nameDrafts(drafts).map((entry) => entry.name)

		expect(new Set(names).size).toBe(names.length)
	})
})
