import { describe, expect, it } from 'vitest'
import { hasUnassigned, placeLeftovers } from './leftovers'

const group = (name: string, ...files: string[]) => ({ name, summary: `${name}.`, files })

describe('placeLeftovers', () => {
	it('adds an omitted file to the group closest by directory', () => {
		const groups = [
			group('Billing', 'apps/api/src/billing/plan.ts'),
			group('Web', 'apps/web/src/routes/index.tsx'),
		]
		expect(
			placeLeftovers(groups, [
				'apps/api/src/billing/plan.ts',
				'apps/api/src/billing/plan.repository.ts',
				'apps/web/src/components/button.tsx',
			]),
		).toEqual([
			group('Billing', 'apps/api/src/billing/plan.ts', 'apps/api/src/billing/plan.repository.ts'),
			group('Web', 'apps/web/src/routes/index.tsx', 'apps/web/src/components/button.tsx'),
		])
	})

	it('dissolves an unassigned group and keeps only files nothing is close to', () => {
		const groups = [
			group('Billing', 'apps/api/src/billing/plan.ts'),
			group('Unassigned changes', 'apps/api/src/billing/hooks.ts', 'README.md'),
		]
		const placed = placeLeftovers(groups, [
			'apps/api/src/billing/plan.ts',
			'apps/api/src/billing/hooks.ts',
			'README.md',
		])
		expect(placed.map((entry) => entry.files)).toEqual([
			['apps/api/src/billing/plan.ts', 'apps/api/src/billing/hooks.ts'],
			['README.md'],
		])
		expect(hasUnassigned(placed)).toBe(true)
		expect(hasUnassigned(placed.slice(0, 1))).toBe(false)
	})

	it('does not touch groups when nothing is missing', () => {
		const groups = [group('Billing', 'apps/api/src/billing/plan.ts')]
		expect(placeLeftovers(groups, ['apps/api/src/billing/plan.ts'])).toEqual(groups)
	})
})
