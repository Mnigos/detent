import { describe, expect, it } from 'vitest'
import { classifyRole } from '../layers/roles'
import { heuristicPriorities, type PriorityFile } from './heuristic'
import { buildPrioritySections } from './sections'

const file = (
	path: string,
	additions = 10,
	deletions = 0,
	status: PriorityFile['status'] = 'modified',
): PriorityFile => ({ path, role: classifyRole(path), status, additions, deletions })

const priorityOf = (entries: ReturnType<typeof heuristicPriorities>, path: string) =>
	entries.find((entry) => entry.path === path)?.priority

describe('heuristicPriorities', () => {
	it.each([
		[1, 1, 'low'],
		[2, 0, 'low'],
		[0, 2, 'low'],
		[2, 1, 'medium'],
		[0, 3, 'medium'],
	])('classifies ordinary code +%i/-%i as %s', (additions, deletions, priority) => {
		const path = 'src/format.ts'
		expect(heuristicPriorities([file(path, additions, deletions)])).toEqual([{ path, priority }])
	})

	it.each([
		[19, 'medium'],
		[20, 'high'],
	] as const)('ranks a deleted code file of %i lines as %s', (deletions, priority) => {
		const path = 'src/legacy.ts'
		expect(heuristicPriorities([file(path, 0, deletions, 'deleted')])[0]?.priority).toBe(priority)
	})

	it.each([
		[39, 'medium'],
		[40, 'high'],
	] as const)('ranks %i changed server lines as %s', (size, priority) => {
		const path = 'src/server/report.ts'
		expect(heuristicPriorities([file(path, size - 10, 10)])[0]?.priority).toBe(priority)
	})

	it.each([
		'src/auth.generated.ts',
		'src/billing.gen.ts',
		'packages/db/migrations/meta/1.json',
		'src/security/dist/bundle.js',
		'bun.lock',
	])('keeps generated file %s Low despite risky names and a large deletion', (path) => {
		expect(heuristicPriorities([file(path, 0, 400, 'deleted')])).toEqual([
			{ path, priority: 'low' },
		])
	})

	it.each([
		'src/__mocks__/auth.ts',
		'src/fixtures/billing.ts',
		'src/__snapshots__/billing.snap',
		'src/components/auth.stories.tsx',
		'docs/security.md',
		'src/auth.spec.ts',
	])('keeps skimmed file %s Low despite risky names and size', (path) => {
		expect(heuristicPriorities([file(path, 100)])).toEqual([{ path, priority: 'low' }])
	})

	it('gives a migration an Urgent slot before larger billing files at the cap', () => {
		const billing = Array.from({ length: 11 }, (_, index) =>
			file(`src/server/billing/${index}.ts`, 100 - index),
		)
		const migration = file('db/migrations/999_add_table.sql', 3)
		const files = [...billing, migration]
		const sections = buildPrioritySections(files, heuristicPriorities(files))
		expect(
			sections.map((section) => [section.name, section.files.map((file) => file.path)]),
		).toEqual([
			['Urgent', [migration.path, ...billing.slice(0, 9).map((file) => file.path)]],
			['High', billing.slice(9).map((file) => file.path)],
		])
	})

	it('orders High files by contracts, server, then risky UI before larger ordinary UI', () => {
		const inputs = [
			file('src/components/large.tsx', 0, 90, 'deleted'),
			file('src/components/billing.tsx', 3),
			file('src/server/large.ts', 40),
			file('src/contracts/small.ts', 3),
		]
		expect(heuristicPriorities(inputs).map(({ path, priority }) => [path, priority])).toEqual([
			['src/contracts/small.ts', 'high'],
			['src/server/large.ts', 'high'],
			['src/components/billing.tsx', 'high'],
			['src/components/large.tsx', 'high'],
		])
	})

	it('treats a rename with code changes as a change, while a pure risky rename stays Low', () => {
		expect(heuristicPriorities([file('src/server/auth.ts', 3, 0, 'renamed')])[0]?.priority).toBe(
			'urgent',
		)
		expect(heuristicPriorities([file('src/server/auth.ts', 0, 0, 'renamed')])).toEqual([
			{ path: 'src/server/auth.ts', priority: 'low' },
		])
	})

	it('ranks a modified code file with 20 removed lines High', () => {
		expect(heuristicPriorities([file('src/legacy.ts', 3, 20)])[0]?.priority).toBe('high')
	})

	it('lets a risky path win over the tiny-change rule, so a two-line billing change stays Urgent', () => {
		expect(heuristicPriorities([file('src/server/billing.ts', 1, 1)])[0]?.priority).toBe('urgent')
	})

	it.each([
		['packages/db/migrations/0004_add_plans.sql', 'urgent'],
		['apps/api/src/modules/auth/session.service.ts', 'urgent'],
		['apps/api/src/modules/billing/charge.handler.ts', 'urgent'],
		['apps/web/src/components/billing/plan-card.tsx', 'high'],
		['packages/contracts/src/user.contract.ts', 'high'],
		['apps/web/src/components/header.tsx', 'medium'],
		['apps/api/src/modules/users/users.service.spec.ts', 'low'],
		['docs/setup.md', 'low'],
		['bun.lock', 'low'],
		['apps/web/src/__snapshots__/header.snap', 'low'],
		['apps/api/test/fixtures/user.json', 'low'],
	])('ranks %s as %s', (path, priority) => {
		expect(priorityOf(heuristicPriorities([file(path)]), path)).toBe(priority)
	})

	it('weighs server changes by size and leaves tiny touches and pure renames low', () => {
		const entries = heuristicPriorities([
			file('apps/api/src/modules/users/users.service.ts', 60, 10),
			file('apps/api/src/modules/teams/teams.service.ts', 8, 2),
			file('apps/web/src/components/footer.tsx', 1, 1),
			file('apps/web/src/components/moved.tsx', 0, 0, 'renamed'),
		])

		expect(entries.map((entry) => entry.priority)).toEqual(['high', 'medium', 'low', 'low'])
	})

	it('treats a large deletion of code as a risky change', () => {
		const path = 'apps/api/src/modules/legacy/importer.ts'

		expect(heuristicPriorities([file(path, 0, 120, 'deleted')])).toEqual([
			{ path, priority: 'high', reason: 'Deletes 120 lines of code.' },
		])
	})

	it('keeps a migration in Urgent ahead of a run of billing files', () => {
		const billing = Array.from({ length: 12 }, (_, index) =>
			file(`apps/api/src/modules/billing/step-${index}.service.ts`, 80),
		)
		const migration = 'packages/db/migrations/0029_access_history.sql'

		expect(heuristicPriorities([...billing, file(migration, 3)])[0]?.path).toBe(migration)
	})

	it('orders by priority, then role rank, risky paths and change size, with reasons only above medium', () => {
		const entries = heuristicPriorities([
			file('apps/web/src/components/header.tsx', 30),
			file('apps/api/src/modules/billing/refund.service.ts', 5),
			file('packages/db/migrations/0005_refunds.sql', 3),
			file('apps/api/src/modules/billing/charge.service.ts', 50),
		])

		expect(entries.map((entry) => entry.path)).toEqual([
			'packages/db/migrations/0005_refunds.sql',
			'apps/api/src/modules/billing/charge.service.ts',
			'apps/api/src/modules/billing/refund.service.ts',
			'apps/web/src/components/header.tsx',
		])
		expect(entries.map((entry) => Boolean(entry.reason))).toEqual([true, true, true, false])
	})
})
