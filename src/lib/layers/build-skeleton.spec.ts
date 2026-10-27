import { describe, expect, it } from 'vitest'
import { loadFixture } from '../../test/load-fixture'
import { type DiffFile, parseUnifiedDiff } from '../diff/parse-diff'
import { buildSkeleton, type Skeleton } from './build-skeleton'
import { buildCochangeEdges, buildEdges } from './graph'

const added = (path: string): DiffFile => ({
	path,
	status: 'added',
	isBinary: false,
	additions: 1,
	deletions: 0,
	hunks: [],
})

const skeletonOf = (name: string) => {
	const files = parseUnifiedDiff(loadFixture(name))

	return { files, skeleton: buildSkeleton(files, buildEdges(files)) }
}

const tessera165 = skeletonOf('tessera-165')
const tessera166 = skeletonOf('tessera-166')
const tanstack8170 = skeletonOf('tanstack-router-8170')

const layerIndexOf = ({ layers }: Skeleton, path: string) =>
	layers.findIndex((layer) => layer.files.some((file) => file.path === path))

describe('buildSkeleton', () => {
	it('puts the contract layer before every layer holding web files', () => {
		const contract = layerIndexOf(
			tessera165.skeleton,
			'packages/contracts/src/github-import.contract.ts',
		)
		const web = tessera165.skeleton.layers
			.map((layer, index) =>
				layer.files.some((file) => file.path.startsWith('apps/web/')) ? index : -1,
			)
			.filter((index) => index >= 0)

		expect(contract).toBe(0)
		expect(web.length).toBeGreaterThan(0)
		expect(Math.min(...web)).toBeGreaterThan(contract)
	})

	it('attaches a spec to the layer of the file it tests', () => {
		const client = 'apps/api/src/modules/github-import/infrastructure/github-octokit.client.ts'
		const spec = 'apps/api/src/modules/github-import/infrastructure/github-octokit.client.spec.ts'

		expect(layerIndexOf(tessera165.skeleton, spec)).toBe(layerIndexOf(tessera165.skeleton, client))
		expect(layerIndexOf(tessera165.skeleton, client)).toBeGreaterThanOrEqual(0)
	})

	it('attaches a controller spec next to its controller rather than to a Tests layer', () => {
		const controller = 'apps/api/src/modules/github-import/presentation/github-import.controller.ts'
		const spec = 'apps/api/src/modules/github-import/presentation/github-import.controller.spec.ts'

		expect(layerIndexOf(tessera165.skeleton, spec)).toBe(
			layerIndexOf(tessera165.skeleton, controller),
		)
		expect(tessera165.skeleton.layers.map((layer) => layer.fallbackName)).not.toContain('Tests')
	})

	// tessera-165 changes no lockfile and no generated file, so the trailing layer is asserted here.
	it('collects generated files and homeless docs in a trailing Generated layer', () => {
		const { layers } = tanstack8170.skeleton
		const last = layers.at(-1)

		expect(last?.fallbackName).toBe('Generated')
		expect(last?.isTrailing).toBe(true)
		expect(last?.files.map((file) => file.path)).toEqual([
			'.changeset/solid-functions-flight.md',
			'e2e/solid-start/server-functions/src/routeTree.gen.ts',
			'pnpm-lock.yaml',
		])
		expect(
			layers.every(
				(layer) =>
					layer === last || (!layer.isTrailing && layer.files.every((f) => f.role !== 'generated')),
			),
		).toBe(true)
	})

	it('keeps the tanstack pull request within its budget of 7 plus the trailing group', () => {
		const { layers, maxLayers } = tanstack8170.skeleton

		expect(maxLayers).toBe(7)
		expect(layers.filter((layer) => !layer.isTrailing).length).toBeLessThanOrEqual(7)
		expect(layers.map((layer) => [layer.fallbackName, layer.files.length])).toEqual([
			['solid-start', 17],
			['benchmarks', 1],
			['scenarios · server-fn-churn', 3],
			['ssr · scenarios', 9],
			['server-fn-transport · solid', 1],
			['Tests', 2],
			['Generated', 3],
		])
	})

	it('keeps tessera-165 within its budget of 5 with api and web apart', () => {
		const { layers, maxLayers } = tessera165.skeleton

		expect(maxLayers).toBe(5)
		expect(layers.length).toBeLessThanOrEqual(5)
		expect(layers.map((layer) => [layer.fallbackName, layer.files.length])).toEqual([
			['contracts', 1],
			['api · github-import', 5],
			['github-import · presentation', 2],
			['web', 18],
		])
	})

	it('sizes the budget from the reviewable files and reads migrations first', () => {
		const application = 'apps/api/src/modules/billing/application'
		const infrastructure = 'apps/api/src/modules/billing/infrastructure'
		const web = 'apps/web/src/modules/billing'
		const sources = [
			'apps/api/src/env.schema.ts',
			'packages/db/migrations/0012_billing.sql',
			'packages/db/migrations/0013_plans.sql',
			'packages/db/migrations/meta/0012_snapshot.json',
			'packages/db/migrations/meta/0013_snapshot.json',
			...[
				'billing',
				'plans',
				'invoices',
				'checkout',
				'webhooks',
				'subscriptions',
				'refunds',
				'coupons',
			].map((name) => `${application}/${name}.service.ts`),
			...['billing.module', 'billing.constants', 'billing.errors', 'billing.events'].map(
				(name) => `${application}/${name}.ts`,
			),
			`${application}/mappers/plan.mapper.ts`,
			`${application}/mappers/invoice.mapper.ts`,
			`${infrastructure}/billing.repository.ts`,
			`${infrastructure}/plans.repository.ts`,
			`${infrastructure}/stripe.client.ts`,
			`${infrastructure}/stripe.webhook.handler.ts`,
			`${web}/components/plan-card.tsx`,
			`${web}/components/invoice-table.tsx`,
			`${web}/hooks/use-plans.query.ts`,
			`${web}/hooks/use-checkout.mutation.ts`,
			`${web}/routes/billing.route.tsx`,
			`${web}/helpers/format-price.ts`,
		]
		const tests = [
			...['billing', 'plans', 'invoices', 'checkout', 'webhooks'].map(
				(name) => `${application}/${name}.service.spec.ts`,
			),
			`${infrastructure}/billing.repository.spec.ts`,
			`${infrastructure}/stripe.client.spec.ts`,
			`${web}/components/plan-card.spec.tsx`,
			`${web}/hooks/use-plans.query.spec.ts`,
			`${web}/routes/billing.route.spec.tsx`,
		]
		const files = [...sources, ...tests].map(added)
		const edges = [
			{ from: `${application}/billing.service.ts`, to: `${infrastructure}/billing.repository.ts` },
			{ from: `${application}/plans.service.ts`, to: `${infrastructure}/plans.repository.ts` },
			{ from: `${application}/checkout.service.ts`, to: `${infrastructure}/stripe.client.ts` },
			{ from: `${application}/billing.module.ts`, to: `${application}/billing.service.ts` },
			{ from: `${web}/hooks/use-plans.query.ts`, to: 'apps/api/src/env.schema.ts' },
		].map((edge) => ({ ...edge, kind: 'import' as const }))
		const { layers, maxLayers } = buildSkeleton(files, edges)
		const trailing = layers.at(-1)
		const layerOf = (path: string) => layerIndexOf({ layers, edges, maxLayers }, path)

		expect(files).toHaveLength(39)
		expect(files.length - (trailing?.files.length ?? 0)).toBe(37)
		expect(maxLayers).toBe(7)
		expect(layers.map((layer) => layer.fallbackName)).toEqual([
			'Database migrations',
			'API changes',
			'api · billing',
			'application · mappers',
			'web · billing',
			'Generated',
		])
		expect(layers[0]?.files.map((file) => file.path)).toEqual([
			'packages/db/migrations/0012_billing.sql',
			'packages/db/migrations/0013_plans.sql',
		])
		expect(trailing?.fallbackName).toBe('Generated')
		expect(trailing?.files.map((file) => file.path)).toEqual([
			'packages/db/migrations/meta/0012_snapshot.json',
			'packages/db/migrations/meta/0013_snapshot.json',
		])
		expect(layers.filter((layer) => !layer.isTrailing).length).toBeLessThanOrEqual(maxLayers)
		for (const test of tests) expect(layerOf(test)).toBe(layerOf(test.replace('.spec.', '.')))
		expect(layers.flatMap((layer) => layer.files)).toHaveLength(39)
	})

	it.each([tessera165, tessera166, tanstack8170])(
		'places every changed file in exactly one layer',
		({ files, skeleton }) => {
			const paths = skeleton.layers.flatMap((layer) => layer.files.map((file) => file.path))

			expect([...paths].sort()).toEqual(files.map((file) => file.path).sort())
		},
	)

	it('splits a small pull request by directory and names layers after their specific segments', () => {
		expect(
			tessera166.skeleton.layers.map((layer) => [
				layer.fallbackName,
				layer.files.map((file) => file.path),
			]),
		).toEqual([
			[
				'repositories · application',
				[
					'apps/api/src/modules/repositories/application/repositories.service.ts',
					'apps/api/src/modules/repositories/application/repositories.service.spec.ts',
					'apps/api/tests/integration/repositories.integration.spec.ts',
				],
			],
			[
				'repositories · infrastructure',
				[
					'apps/api/src/modules/repositories/infrastructure/repositories.repository.ts',
					'apps/api/src/modules/repositories/infrastructure/repositories.repository.spec.ts',
				],
			],
		])
	})

	it('orders files inside a layer by role rank with tests last', () => {
		for (const { skeleton } of [tessera165, tessera166, tanstack8170])
			for (const layer of skeleton.layers) {
				const tests = layer.files.filter((file) => file.role === 'test')

				expect(layer.files.slice(layer.files.length - tests.length)).toEqual(tests)
			}
	})

	it('gives every layer a stable eight-character id', () => {
		const { skeleton } = tessera165
		const ids = skeleton.layers.map((layer) => layer.id)

		expect(ids.every((id) => /^[0-9a-f]{8}$/.test(id))).toBe(true)
		expect(new Set(ids).size).toBe(ids.length)
		expect(buildSkeleton(tessera165.files, skeleton.edges).layers.map((l) => l.id)).toEqual(ids)
	})

	it('joins files through shared identifiers without chaining two behaviors together', () => {
		const files = parseUnifiedDiff(
			['tessera-165', 'tessera-166', 'tanstack-router-8170'].map(loadFixture).join(''),
		)
		const skeleton = buildSkeleton(files, buildEdges(files), buildCochangeEdges(files))
		const withoutShared = buildSkeleton(files, buildEdges(files))
		const service = 'apps/api/src/modules/repositories/application/repositories.service.ts'
		const repository = 'apps/api/src/modules/repositories/infrastructure/repositories.repository.ts'
		// Shares `ownerLogin` with the repository above but belongs to the import behavior.
		const client = 'apps/api/src/modules/github-import/infrastructure/github-octokit.client.ts'

		expect(layerIndexOf(withoutShared, service)).not.toBe(layerIndexOf(withoutShared, repository))
		expect(layerIndexOf(skeleton, service)).toBe(layerIndexOf(skeleton, repository))
		expect(layerIndexOf(skeleton, client)).not.toBe(layerIndexOf(skeleton, repository))
		expect(skeleton.layers.filter((layer) => !layer.isTrailing).length).toBeGreaterThan(5)
		expect(skeleton.edges.some((edge) => edge.kind === 'cochange')).toBe(false)
	})

	it('returns the edges it was given', () => {
		expect(tessera165.skeleton.edges).toEqual(buildEdges(tessera165.files))
	})
})
