import { describe, expect, it } from 'vitest'
import type { Skeleton } from './build-skeleton'
import { applyGrouping, GROUPING_SCHEMA, parseGroupingResponse } from './grouping'

const CONTRACT = 'packages/contracts/import.contract.ts'
const SCHEMA = 'packages/contracts/import.schema.ts'
const SERVICE = 'apps/api/src/import.service.ts'
const SPEC = 'apps/api/src/import.service.spec.ts'
const PAGE = 'apps/web/src/import.tsx'
const LOCK = 'bun.lock'

const skeleton: Skeleton = {
	edges: [],
	maxLayers: 3,
	layers: [
		{
			id: 'aaa',
			fallbackName: 'contracts',
			rank: 1,
			isTrailing: false,
			files: [
				{ path: CONTRACT, role: 'contract' },
				{ path: SCHEMA, role: 'contract' },
			],
		},
		{
			id: 'bbb',
			fallbackName: 'api',
			rank: 2,
			isTrailing: false,
			files: [
				{ path: SERVICE, role: 'server' },
				{ path: SPEC, role: 'test' },
			],
		},
		{
			id: 'ccc',
			fallbackName: 'web',
			rank: 3,
			isTrailing: false,
			files: [{ path: PAGE, role: 'ui' }],
		},
		{
			id: 'ddd',
			fallbackName: 'Generated',
			rank: 7,
			isTrailing: true,
			files: [{ path: LOCK, role: 'generated' }],
		},
	],
}

const entry = (name: string, ...files: string[]) => ({ name, summary: `${name}.`, files })

const pathsOf = (layers: { files: { path: string }[] }[] | undefined) =>
	layers?.map((layer) => layer.files.map((file) => file.path))

describe('GROUPING_SCHEMA', () => {
	it('requires every field and forbids extra ones at both levels', () => {
		const layer = GROUPING_SCHEMA.properties.layers.items

		expect(GROUPING_SCHEMA.required).toEqual(['layers'])
		expect(GROUPING_SCHEMA.additionalProperties).toBe(false)
		expect(layer.required).toEqual(['name', 'summary', 'files', 'focus'])
		expect(layer.additionalProperties).toBe(false)
		expect(layer.properties.files).toEqual({ type: 'array', items: { type: 'string' } })
	})
})

describe('parseGroupingResponse', () => {
	it('accepts the shape the schema asks for and drops non-string files', () => {
		const text = JSON.stringify({
			layers: [{ name: 'Add the contract', summary: 'Read it.', files: [CONTRACT, 4, null] }],
		})

		expect(parseGroupingResponse(text)).toEqual([
			{ name: 'Add the contract', summary: 'Read it.', files: [CONTRACT] },
		])
	})

	it('keeps the focus list of a step', () => {
		const text = JSON.stringify({
			layers: [{ name: 'S', summary: 'R.', files: [CONTRACT, SCHEMA], focus: [CONTRACT, 7] }],
		})

		expect(parseGroupingResponse(text)?.[0]?.focus).toEqual([CONTRACT])
	})

	it('answers nothing for broken json, missing fields or an empty list', () => {
		expect(parseGroupingResponse('nope')).toBeUndefined()
		expect(parseGroupingResponse(JSON.stringify({ layers: [{ name: 'x' }] }))).toBeUndefined()
		expect(parseGroupingResponse(JSON.stringify({ layers: [] }))).toBeUndefined()
	})
})

describe('applyGrouping', () => {
	it('builds model layers in the given order and appends the generated files as the trailing layer', () => {
		const layers = applyGrouping(skeleton, [
			entry('Change the contract', SCHEMA, CONTRACT),
			entry('Wire the service and page', PAGE, SPEC, SERVICE),
		])

		expect(
			layers?.map((layer) => [layer.name, layer.summary, layer.source, layer.isTrailing]),
		).toEqual([
			['Change the contract', 'Change the contract.', 'model', false],
			['Wire the service and page', 'Wire the service and page.', 'model', false],
			['Generated', '', 'fallback', true],
		])
		expect(pathsOf(layers)).toEqual([[SCHEMA, CONTRACT], [PAGE, SERVICE, SPEC], [LOCK]])
		expect(layers?.every((layer) => /^[0-9a-f]{8}$/.test(layer.id))).toBe(true)
	})

	it('marks the files a step focuses on', () => {
		const layers = applyGrouping(skeleton, [
			{ ...entry('All', CONTRACT, SCHEMA, SERVICE, SPEC, PAGE), focus: [SERVICE, 'nowhere.ts'] },
		])

		expect(layers?.[0]?.files.map((file) => [file.path, file.isFocus ?? false])).toEqual([
			[CONTRACT, false],
			[SCHEMA, false],
			[SERVICE, true],
			[SPEC, false],
			[PAGE, false],
		])
	})

	it('drops unknown paths and keeps a file listed twice in its first layer', () => {
		const layers = applyGrouping(skeleton, [
			entry('First', CONTRACT, 'apps/api/src/missing.ts', SERVICE),
			entry('Second', SERVICE, SCHEMA, PAGE, SPEC),
		])

		expect(pathsOf(layers)).toEqual([[CONTRACT, SERVICE, SPEC], [SCHEMA, PAGE], [LOCK]])
	})

	it('keeps omitted files separate only when no group is close by directory', () => {
		const layers = applyGrouping(skeleton, [entry('Service', SERVICE), entry('Page', PAGE)])

		expect(pathsOf(layers)).toEqual([[SERVICE, SPEC], [PAGE], [CONTRACT, SCHEMA], [LOCK]])
	})

	it('moves a test the model put elsewhere into the group of the file it tests', () => {
		const layers = applyGrouping(skeleton, [
			entry('Service', SERVICE, CONTRACT, SCHEMA),
			entry('Tests and page', SPEC, PAGE),
		])

		expect(pathsOf(layers)).toEqual([[SERVICE, SPEC, CONTRACT, SCHEMA], [PAGE], [LOCK]])
	})

	it('drops a group left with nothing after its only test moved away', () => {
		const layers = applyGrouping(skeleton, [
			entry('Service', SERVICE, CONTRACT, SCHEMA, PAGE),
			entry('Tests', SPEC),
		])

		expect(layers?.map((layer) => layer.name)).toEqual(['Service', 'Generated'])
	})

	it('adopts an omitted test into the group of the file it tests, right after it', () => {
		const layers = applyGrouping(skeleton, [
			entry('Contract', CONTRACT),
			entry('Service and page', SERVICE, PAGE),
		])

		expect(pathsOf(layers)).toEqual([[CONTRACT, SCHEMA], [SERVICE, SPEC, PAGE], [LOCK]])
	})

	it('removes layers left empty', () => {
		const layers = applyGrouping(skeleton, [
			entry('Ghost', 'nowhere.ts'),
			entry('All', CONTRACT, SCHEMA, SERVICE, SPEC, PAGE),
		])

		expect(layers?.map((layer) => layer.name)).toEqual(['All', 'Generated'])
	})

	it('preserves coherent groups even when the model exceeds the suggested budget', () => {
		const layers = applyGrouping({ ...skeleton, maxLayers: 2 }, [
			entry('Contract', CONTRACT, SCHEMA),
			entry('Service', SERVICE, SPEC),
			entry('Page', PAGE),
		])

		expect(layers?.map((layer) => layer.name)).toEqual(['Contract', 'Service', 'Page', 'Generated'])
		expect(pathsOf(layers)).toEqual([[CONTRACT, SCHEMA], [SERVICE, SPEC], [PAGE], [LOCK]])
	})

	it('keeps generated files in the trailing layer whatever the model says', () => {
		const layers = applyGrouping(skeleton, [
			entry('Everything', LOCK, CONTRACT, SCHEMA, SERVICE, SPEC, PAGE),
		])

		expect(pathsOf(layers)).toEqual([[CONTRACT, SCHEMA, SERVICE, SPEC, PAGE], [LOCK]])
	})

	it.each(['command', 'query'])(
		'preserves definition, handler and tests per %s after shared contracts',
		(kind) => {
			const operations = ['create-order', 'cancel-order'].flatMap((name) => [
				`apps/api/application/${name}.${kind}.ts`,
				`apps/api/application/${name}.handler.ts`,
				`apps/api/application/${name}.handler.spec.ts`,
			])
			const input: Skeleton = {
				...skeleton,
				layers: [
					{
						id: 'contracts',
						fallbackName: 'Contracts',
						rank: 1,
						isTrailing: false,
						files: [
							{ path: CONTRACT, role: 'contract' },
							{ path: SCHEMA, role: 'contract' },
						],
					},
					{
						id: 'operations',
						fallbackName: 'Operations',
						rank: 2,
						isTrailing: false,
						files: operations.map((path) => ({
							path,
							role: path.includes('.spec.') ? 'test' : 'server',
						})),
					},
				],
			}
			expect(
				pathsOf(
					applyGrouping(input, [
						entry('Shared contracts', CONTRACT, SCHEMA),
						entry('Order operations', ...operations),
					]),
				),
			).toEqual([[CONTRACT, SCHEMA], operations])
		},
	)

	it('names a blank layer after its files', () => {
		const layers = applyGrouping(skeleton, [
			entry('  ', CONTRACT, SCHEMA),
			entry('Rest', SERVICE, SPEC, PAGE),
		])

		expect(layers?.[0]?.name).toBe('contracts')
	})

	it('answers nothing when no known file remains so the skeleton takes over', () => {
		expect(applyGrouping(skeleton, [])).toBeUndefined()
		expect(
			applyGrouping(skeleton, [entry('Ghost', 'nowhere.ts'), entry('Lock', LOCK)]),
		).toBeUndefined()
	})
})
