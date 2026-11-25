import { describe, expect, it } from 'vitest'
import { loadFixture } from '../../test/load-fixture'
import { type DiffFile, parseUnifiedDiff } from '../diff/parse-diff'
import { buildSkeleton, type Skeleton } from './build-skeleton'
import { buildCochangeEdges, buildEdges } from './graph'
import { applyLabels } from './label-schema'

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
	it('collects generated files in a trailing Generated layer and homeless docs in Docs changes', () => {
		const { layers } = tanstack8170.skeleton
		const last = layers.at(-1)
		const docs = layers.at(-2)

		expect(last?.fallbackName).toBe('Generated')
		expect(last?.isTrailing).toBe(true)
		expect(last?.files.map((file) => file.path)).toEqual([
			'e2e/solid-start/server-functions/src/routeTree.gen.ts',
			'pnpm-lock.yaml',
		])
		expect(docs?.fallbackName).toBe('Docs changes')
		expect(docs?.isTrailing).toBe(false)
		expect(docs?.files.map((file) => file.path)).toEqual(['.changeset/solid-functions-flight.md'])
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
			['Docs changes', 1],
			['Generated', 2],
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
		// The changeset would take a reserved Docs slot and squeeze the code layers this test compares.
		const files = parseUnifiedDiff(
			['tessera-165', 'tessera-166', 'tanstack-router-8170'].map(loadFixture).join(''),
		).filter((file) => !file.path.startsWith('.changeset/'))
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

	describe('config and docs no code layer claims', () => {
		// The shape of ludus-engine/LudusPlatform#1001: workflow gates and the workflows that call them.
		const workflowGates = [
			'scripts/security/workflowGates.mjs',
			'scripts/security/workflowGates.test.mjs',
			'.github/workflows/ludus-components.yml',
			'.github/workflows/ludus-instrumentation.yml',
			'.github/workflows/ludus-web.yml',
		]
		const shapeOf = ({ layers }: Skeleton) =>
			layers.map((layer) => [
				layer.fallbackName,
				layer.isTrailing,
				layer.files.map((file) => file.path),
			])

		it('gives workflows next to unrelated code their own Config changes layer', () => {
			expect(shapeOf(buildSkeleton(workflowGates.map(added), []))).toEqual([
				[
					'scripts · security',
					false,
					['scripts/security/workflowGates.mjs', 'scripts/security/workflowGates.test.mjs'],
				],
				[
					'Config changes',
					false,
					[
						'.github/workflows/ludus-components.yml',
						'.github/workflows/ludus-instrumentation.yml',
						'.github/workflows/ludus-web.yml',
					],
				],
			])
		})

		it('still attaches config and docs that share two path segments with a code layer', () => {
			const skeleton = buildSkeleton(
				[
					'apps/api/src/server.ts',
					'apps/api/package.json',
					'apps/api/README.md',
					'apps/web/src/app.tsx',
					'apps/web/vite.config.ts',
				].map(added),
				[],
			)

			expect(shapeOf(skeleton)).toEqual([
				['api', false, ['apps/api/src/server.ts', 'apps/api/README.md', 'apps/api/package.json']],
				['web', false, ['apps/web/src/app.tsx', 'apps/web/vite.config.ts']],
			])
		})

		it('orders the role layers Tests, Docs, Config, Generated and only Generated trails', () => {
			const skeleton = buildSkeleton(
				[
					'bun.lock',
					'README.md',
					'.github/workflows/ci.yml',
					'src/lib/parse.ts',
					'src/lib/__snapshots__/parse.spec.ts.snap',
					'tests/smoke.spec.ts',
				].map(added),
				[],
			)

			expect(shapeOf(skeleton)).toEqual([
				['Other changes', false, ['src/lib/parse.ts']],
				['Tests', false, ['tests/smoke.spec.ts']],
				['Docs changes', false, ['README.md']],
				['Config changes', false, ['.github/workflows/ci.yml']],
				['Generated', true, ['bun.lock', 'src/lib/__snapshots__/parse.spec.ts.snap']],
			])
		})

		it('reserves budget slots for the Docs and Config layers', () => {
			const code = ['alpha', 'beta', 'gamma', 'delta'].map((name) => `${name}/index.ts`)
			const { layers, maxLayers } = buildSkeleton(
				[...code, 'README.md', '.github/workflows/ci.yml'].map(added),
				[],
			)

			expect(maxLayers).toBe(3)
			expect(layers.filter((layer) => !layer.isTrailing)).toHaveLength(3)
			expect(layers.map((layer) => layer.fallbackName).slice(-2)).toEqual([
				'Docs changes',
				'Config changes',
			])
		})

		it('keeps one code layer when the role layers alone fill the budget', () => {
			const paths = [
				'packages/db/migrations/0001_init.sql',
				'src/lib/parse.ts',
				'tests/smoke.spec.ts',
				'README.md',
				'.github/workflows/ci.yml',
			]
			const { layers } = buildSkeleton(paths.map(added), [])

			expect(layers.map((layer) => layer.fallbackName)).toEqual([
				'Database migrations',
				'Other changes',
				'Tests',
				'Docs changes',
				'Config changes',
			])
			expect(layers.flatMap((layer) => layer.files.map((file) => file.path)).sort()).toEqual(
				[...paths].sort(),
			)
		})

		it('lets labels cached against the old Generated layer land on Config changes without loss', () => {
			const skeleton = buildSkeleton(workflowGates.map(added), [])
			const config = skeleton.layers.find((layer) => layer.fallbackName === 'Config changes')
			const stale = { path: '.github/workflows/ludus-web.yml', toLayerId: 'deadbeef' }
			// The old trailing layer held exactly the workflows, so its id is the Config layer's id now.
			const labeled = applyLabels(skeleton, [
				{
					id: config?.id ?? '',
					name: 'Gate workflows on security checks',
					summary: 'Check each workflow calls the gate.',
					moveFiles: [stale],
					mergeIds: ['deadbeef'],
				},
				{ id: 'cafebabe', name: 'Gone', summary: 'A layer that no longer exists.' },
			])

			expect(labeled.map((layer) => [layer.name, layer.isTrailing, layer.files.length])).toEqual([
				['scripts · security', false, 2],
				['Gate workflows on security checks', false, 3],
			])
		})
	})
})
