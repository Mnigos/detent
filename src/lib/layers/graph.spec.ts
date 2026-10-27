import { describe, expect, it } from 'vitest'
import { loadFixture } from '../../test/load-fixture'
import { type DiffFile, parseUnifiedDiff } from '../diff/parse-diff'
import { buildCochangeEdges, buildEdges, buildMethodEdges, sharedIdentifiers } from './graph'

const tessera165 = buildEdges(parseUnifiedDiff(loadFixture('tessera-165')))
const tanstack8170 = buildEdges(parseUnifiedDiff(loadFixture('tanstack-router-8170')))

const dependsOn = (edges: ReturnType<typeof buildEdges>, from: string, to: string) =>
	edges.some((edge) => edge.from === from && edge.to === to)

describe('buildEdges', () => {
	it('links calls to a new generic method when the class and import are unchanged', () => {
		const files = parseUnifiedDiff(loadFixture('provider-lock'))
		expect(buildMethodEdges(files)).toEqual([
			{ from: 'src/renew.handler.ts', to: 'src/entitlement.repository.ts', kind: 'identifier' },
		])
	})
	it('resolves an aliased import against the renamed file it points at', () => {
		expect(
			dependsOn(
				tessera165,
				'apps/web/src/modules/github-import/components/github-import-source-selector.tsx',
				'apps/web/src/shared/components/search-input.tsx',
			),
		).toBe(true)
	})

	it('resolves relative imports', () => {
		expect(
			dependsOn(
				tessera165,
				'apps/web/src/modules/github-import/components/github-import-source-selector.tsx',
				'apps/web/src/modules/github-import/components/github-import-load-status.tsx',
			),
		).toBe(true)
		expect(
			dependsOn(
				tanstack8170,
				'packages/solid-start/src/createSolidStartHandler.ts',
				'packages/solid-start/src/server-functions-handler.ts',
			),
		).toBe(true)
	})

	it('links the api and the web app to the contract that declares the identifiers they added', () => {
		const contract = 'packages/contracts/src/github-import.contract.ts'

		for (const dependent of [
			'apps/api/src/modules/github-import/application/github-import.service.ts',
			'apps/api/src/modules/github-import/infrastructure/github-octokit.client.ts',
			'apps/web/src/modules/github-import/hooks/use-github-import-repositories.query.ts',
		])
			expect(tessera165.find((edge) => edge.from === dependent && edge.to === contract)).toEqual({
				from: dependent,
				to: contract,
				kind: 'identifier',
			})
	})

	// Both files only add named specifiers inside imports whose `from` line is unchanged context.
	it('creates no edge when neither file adds a line naming the other', () => {
		expect(
			dependsOn(
				tessera165,
				'apps/api/src/modules/github-import/application/github-import.service.ts',
				'apps/api/src/modules/github-import/infrastructure/github-octokit.client.ts',
			),
		).toBe(false)
	})

	it('resolves an import whose specifier list spans several lines', () => {
		const edges = buildEdges(
			parseUnifiedDiff(
				[
					'diff --git a/apps/web/src/page.tsx b/apps/web/src/page.tsx',
					'--- a/apps/web/src/page.tsx',
					'+++ b/apps/web/src/page.tsx',
					'@@ -0,0 +1,3 @@',
					'+import {',
					'+\tsomethingLong,',
					"+} from './widgets/card'",
					'diff --git a/apps/web/src/widgets/card.tsx b/apps/web/src/widgets/card.tsx',
					'--- a/apps/web/src/widgets/card.tsx',
					'+++ b/apps/web/src/widgets/card.tsx',
					'@@ -0,0 +1,1 @@',
					'+const internal = 1',
				].join('\n'),
			),
		)

		expect(edges).toEqual([
			{ from: 'apps/web/src/page.tsx', to: 'apps/web/src/widgets/card.tsx', kind: 'import' },
		])
	})

	it('does not resolve an npm scope to a changed file with the same tail', () => {
		const edges = buildEdges(
			parseUnifiedDiff(
				[
					'diff --git a/apps/web/src/page.tsx b/apps/web/src/page.tsx',
					'--- a/apps/web/src/page.tsx',
					'+++ b/apps/web/src/page.tsx',
					'@@ -0,0 +1,1 @@',
					"+import { Link } from '@tanstack/solid-router'",
					'diff --git a/packages/solid-router.ts b/packages/solid-router.ts',
					'--- a/packages/solid-router.ts',
					'+++ b/packages/solid-router.ts',
					'@@ -0,0 +1,1 @@',
					'+const unrelated = 1',
				].join('\n'),
			),
		)

		expect(edges).toEqual([])
	})

	it('survives an export brace on a line that is not JavaScript', () => {
		const edges = buildEdges(
			parseUnifiedDiff(
				[
					'diff --git a/scripts/release.sh b/scripts/release.sh',
					'--- a/scripts/release.sh',
					'+++ b/scripts/release.sh',
					'@@ -0,0 +1,2 @@',
					'+export {abcd(}',
					'+echo done',
				].join('\n'),
			),
		)

		expect(edges).toEqual([])
	})

	it('never points a file at itself and never repeats a pair', () => {
		for (const edges of [tessera165, tanstack8170]) {
			expect(edges.every((edge) => edge.from !== edge.to)).toBe(true)
			expect(new Set(edges.map((edge) => `${edge.from} ${edge.to}`)).size).toBe(edges.length)
		}
	})

	it('ignores short identifiers, stop-list names and ambiguous specifiers', () => {
		const edges = buildEdges(
			parseUnifiedDiff(
				[
					'diff --git a/src/a.ts b/src/a.ts',
					'--- a/src/a.ts',
					'+++ b/src/a.ts',
					'@@ -0,0 +1,3 @@',
					'+export const Id = 1',
					'+export interface Props { id: number }',
					'+export const parseLayer = (input: string) => input',
					'diff --git a/src/b.ts b/src/b.ts',
					'--- a/src/b.ts',
					'+++ b/src/b.ts',
					'@@ -0,0 +1,4 @@',
					"+import { helper } from '../helper'",
					'+const used: Props = { id: Id }',
					'+export const layer = parseLayer("x")',
					'diff --git a/one/helper.ts b/one/helper.ts',
					'--- a/one/helper.ts',
					'+++ b/one/helper.ts',
					'@@ -0,0 +1,1 @@',
					'+export const valueOne = 1',
					'diff --git a/two/helper.ts b/two/helper.ts',
					'--- a/two/helper.ts',
					'+++ b/two/helper.ts',
					'@@ -0,0 +1,1 @@',
					'+export const valueTwo = 2',
				].join('\n'),
			),
		)

		expect(edges).toEqual([{ from: 'src/b.ts', to: 'src/a.ts', kind: 'identifier' }])
	})
})

describe('sharedIdentifiers and buildCochangeEdges', () => {
	const file = (path: string, added: string[], removed: string[] = []): DiffFile => ({
		path,
		status: 'modified',
		isBinary: false,
		additions: added.length,
		deletions: removed.length,
		hunks: [
			{
				oldStart: 1,
				oldLines: 1,
				newStart: 1,
				newLines: 1,
				header: '',
				addedLines: added,
				removedLines: removed,
			},
		],
	})

	it('ties files that add or remove the same compound identifier, rarest first', () => {
		const files = [
			file('src/types/bridge.ts', ['  rows_skipped?: number']),
			file('src/stores/importStore.ts', ['  rowsSkipped: status.rows_skipped ?? 0']),
			file('src/pages/ImportPage.tsx', ['  const skipped = store.rows_skipped', '  filter()']),
			file('src/pages/ImportPage.test.tsx', ['  expect(rows_skipped).toBe(2)']),
			file('src/other.ts', ['  const status = filter(items)']),
		]

		expect(sharedIdentifiers(files).get('src/stores/importStore.ts')).toEqual(['rows_skipped'])
		expect(sharedIdentifiers(files).has('src/pages/ImportPage.test.tsx')).toBe(false)
		expect(sharedIdentifiers(files).has('src/other.ts')).toBe(false)
		expect(buildCochangeEdges(files)).toEqual([
			{ from: 'src/types/bridge.ts', to: 'src/stores/importStore.ts', kind: 'cochange' },
			{ from: 'src/types/bridge.ts', to: 'src/pages/ImportPage.tsx', kind: 'cochange' },
			{ from: 'src/stores/importStore.ts', to: 'src/pages/ImportPage.tsx', kind: 'cochange' },
		])
	})

	it('links a removed identifier to the files that dropped it too', () => {
		const files = [
			file('src/stores/approvalStore.ts', ["  'cancelled'"], ["  'cancelled' | 'timed_out'"]),
			file(
				'src/utils/approvalLabel.ts',
				["  if (decision === 'denied')"],
				["  if (decision === 'denied' || decision === 'timed_out')"],
			),
		]

		expect(buildCochangeEdges(files)).toEqual([
			{ from: 'src/stores/approvalStore.ts', to: 'src/utils/approvalLabel.ts', kind: 'cochange' },
		])
	})

	it('ignores single words, hook names, comments and identifiers shared too widely', () => {
		const many = Array.from({ length: 7 }, (_, index) =>
			file(`src/widget-${index}.tsx`, [
				'  const [open, setOpen] = useState(false)',
				'  everywhereShared()',
			]),
		)
		const files = [
			...many,
			file('src/a.ts', ['  // onlyInComment', '  filter()']),
			file('src/b.ts', ['  /* onlyInComment */', '  filter()']),
		]

		expect(buildCochangeEdges(files)).toEqual([])
		expect(sharedIdentifiers(files).size).toBe(0)
	})

	it('counts string literals, where union members and event names live', () => {
		const files = [
			file('src/a.ts', ["  emit('approval_expired')"]),
			file('src/b.ts', ["  type Reason = 'approval_expired'"]),
		]

		expect(buildCochangeEdges(files)).toHaveLength(1)
	})

	it('links through an identifier a file shows nowhere in its own signal list', () => {
		const rare = Array.from({ length: 5 }, (_, index) => `rareWord${index}`)
		const files = [
			file('src/a.ts', ['  sharedWord()']),
			file('src/b.ts', ['  sharedWord()', ...rare.map((word) => `  ${word}()`)]),
			file('src/c.ts', ['  sharedWord()']),
			file(
				'src/d.ts',
				rare.map((word) => `  ${word}()`),
			),
		]
		const edges = buildCochangeEdges(files)

		expect(sharedIdentifiers(files).get('src/b.ts')).not.toContain('sharedWord')
		expect(
			edges.filter((edge) => edge.kind === 'cochange').map((edge) => [edge.from, edge.to]),
		).toEqual([
			['src/b.ts', 'src/d.ts'],
			['src/a.ts', 'src/b.ts'],
			['src/a.ts', 'src/c.ts'],
			['src/b.ts', 'src/c.ts'],
		])
	})
})

it('does not infer a method dependency from an unrelated receiver or non-code text', () => {
	const fixture = loadFixture('provider-lock')
	for (const expression of [
		'this.user.withProviderReferenceLock({',
		'"this.entitlementRepository.withProviderReferenceLock({"',
		'/* this.entitlementRepository.withProviderReferenceLock({ */',
		'// this.entitlementRepository.withProviderReferenceLock({',
	]) {
		const files = parseUnifiedDiff(
			fixture.replace('this.entitlementRepository.withProviderReferenceLock({', expression),
		)
		expect(buildMethodEdges(files)).toEqual([])
	}
	const common = parseUnifiedDiff(
		fixture
			.replaceAll('withProviderReferenceLock', 'save')
			.replace('this.entitlementRepository.save({', 'this.user.save({'),
	)
	expect(buildMethodEdges(common)).toEqual([])
})
