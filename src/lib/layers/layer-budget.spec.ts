import { describe, expect, it } from 'vitest'
import type { Edge } from './graph'
import { type Draft, layerBudget, mergeToBudget } from './layer-budget'

const draft = (rank: number, ...core: string[]): Draft => ({ core, attached: [], rank })

const edge = (from: string, to: string): Edge => ({ from, to, kind: 'import' })

const cores = (drafts: Draft[]) => drafts.map((entry) => entry.core)

describe('layerBudget', () => {
	it.each([
		[0, 3],
		[12, 3],
		[13, 5],
		[30, 5],
		[31, 7],
		[61, 10],
		[150, 10],
		[403, 27],
		[60, 7],
		[500, 30],
	])('allows %i reviewable files %i layers', (files, budget) => {
		expect(layerBudget(files)).toBe(budget)
	})
})

describe('mergeToBudget', () => {
	const api = draft(1, 'apps/api/a.ts', 'apps/api/b.ts')
	const web = draft(2, 'apps/web/a.tsx', 'apps/web/b.tsx')
	const tool = draft(3, 'tools/x.ts')

	it('leaves the layers alone when they fit the budget', () => {
		expect(mergeToBudget([api, web, tool], [], 3)).toEqual([api, web, tool])
	})

	it('merges the smallest layer into the one it shares the most edges with, either way', () => {
		const edges = [edge('apps/web/a.tsx', 'tools/x.ts'), edge('tools/x.ts', 'apps/web/b.tsx')]

		expect(cores(mergeToBudget([api, web, tool], edges, 2))).toEqual([
			['apps/api/a.ts', 'apps/api/b.ts'],
			['apps/web/a.tsx', 'apps/web/b.tsx', 'tools/x.ts'],
		])
	})

	it('breaks an edge tie by the longest shared directory, then by order', () => {
		const sibling = draft(3, 'apps/web/c.tsx')
		const edges = [
			edge('apps/web/c.tsx', 'apps/api/a.ts'),
			edge('apps/web/c.tsx', 'apps/web/a.tsx'),
		]

		expect(cores(mergeToBudget([api, web, sibling], edges, 2))).toEqual([
			['apps/api/a.ts', 'apps/api/b.ts'],
			['apps/web/a.tsx', 'apps/web/b.tsx', 'apps/web/c.tsx'],
		])
		expect(
			cores(mergeToBudget([api, web, tool], [edge('tools/x.ts', 'apps/api/a.ts')], 2)),
		).toEqual([
			['apps/api/a.ts', 'apps/api/b.ts', 'tools/x.ts'],
			['apps/web/a.tsx', 'apps/web/b.tsx'],
		])
	})

	it('falls back to the longest shared directory without edges', () => {
		const sibling = draft(3, 'apps/web/c.tsx')

		expect(cores(mergeToBudget([api, web, sibling], [], 2))).toEqual([
			['apps/api/a.ts', 'apps/api/b.ts'],
			['apps/web/a.tsx', 'apps/web/b.tsx', 'apps/web/c.tsx'],
		])
	})

	it('falls back to the smallest other layer when nothing beyond the root is shared', () => {
		const big = draft(1, 'apps/api/a.ts', 'apps/api/b.ts', 'apps/api/c.ts')

		expect(cores(mergeToBudget([big, web, tool], [], 2))).toEqual([
			['apps/api/a.ts', 'apps/api/b.ts', 'apps/api/c.ts'],
			['apps/web/a.tsx', 'apps/web/b.tsx', 'tools/x.ts'],
		])
	})

	it('keeps the position and rank of the earlier layer and sorts the merged core', () => {
		const late = draft(0, 'apps/api/0.ts')
		const [merged] = mergeToBudget([api, web, late], [edge('apps/api/0.ts', 'apps/api/a.ts')], 2)

		expect(merged).toEqual({
			core: ['apps/api/0.ts', 'apps/api/a.ts', 'apps/api/b.ts'],
			attached: [],
			rank: 1,
		})
	})

	it('picks the earlier of two equally small layers first', () => {
		const first = draft(1, 'apps/api/a.ts')
		const second = draft(2, 'apps/web/c.tsx')

		expect(cores(mergeToBudget([first, second, web], [], 2))).toEqual([
			['apps/api/a.ts', 'apps/web/c.tsx'],
			['apps/web/a.tsx', 'apps/web/b.tsx'],
		])
	})
})
