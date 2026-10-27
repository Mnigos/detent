import { describe, expect, it } from 'vitest'
import type { Skeleton } from './build-skeleton'
import { applyLabels, LABEL_SCHEMA, parseLabelResponse } from './label-schema'

const skeleton: Skeleton = {
	edges: [],
	maxLayers: 3,
	layers: [
		{
			id: 'aaa',
			fallbackName: 'contracts',
			rank: 0,
			isTrailing: false,
			files: [
				{ path: 'packages/contracts/import.contract.ts', role: 'contract' },
				{ path: 'packages/contracts/import.schema.ts', role: 'contract' },
			],
		},
		{
			id: 'bbb',
			fallbackName: 'web · import',
			rank: 2,
			isTrailing: false,
			files: [{ path: 'apps/web/import.tsx', role: 'ui' }],
		},
		{
			id: 'ccc',
			fallbackName: 'Generated',
			rank: 7,
			isTrailing: true,
			files: [{ path: 'bun.lock', role: 'generated' }],
		},
	],
}

const entry = (
	id: string,
	name: string,
	moveFiles?: { path: string; toLayerId: string }[],
	mergeIds?: string[],
) => ({
	id,
	name,
	summary: `${name} summary`,
	moveFiles,
	mergeIds,
})

const pathsOf = (layers: { files: { path: string }[] }[]) =>
	layers.map((layer) => layer.files.map((file) => file.path))

describe('parseLabelResponse', () => {
	it('accepts the shape the schema asks for', () => {
		const text = JSON.stringify({
			layers: [{ id: 'aaa', name: 'Add the import contract', summary: 'Read the shape first.' }],
		})

		expect(parseLabelResponse(text)).toEqual([
			{
				id: 'aaa',
				name: 'Add the import contract',
				summary: 'Read the shape first.',
				moveFiles: [],
				mergeIds: [],
			},
		])
	})

	it('keeps the string merge ids and drops the rest', () => {
		const text = JSON.stringify({
			layers: [{ id: 'aaa', name: 'Kept', summary: 'Kept.', mergeIds: ['bbb', 4, null] }],
		})

		expect(parseLabelResponse(text)?.[0]?.mergeIds).toEqual(['bbb'])
	})

	it('drops entries and moves with missing or non-string fields', () => {
		const text = JSON.stringify({
			layers: [
				{ id: 'aaa', name: 'Kept', summary: 'Kept.', moveFiles: [{ path: 'a' }, 7] },
				{ id: 'bbb', name: 42, summary: 'Dropped.' },
				null,
			],
		})

		expect(parseLabelResponse(text)).toEqual([
			{ id: 'aaa', name: 'Kept', summary: 'Kept.', moveFiles: [], mergeIds: [] },
		])
	})

	it('returns nothing for invalid json, a missing array or an empty one', () => {
		expect(parseLabelResponse('not json')).toBeUndefined()
		expect(parseLabelResponse('{"layers":"soon"}')).toBeUndefined()
		expect(parseLabelResponse('{"layers":[]}')).toBeUndefined()
	})
})

describe('applyLabels', () => {
	it('keeps the fallback name and no summary without a response', () => {
		expect(applyLabels(skeleton, [])).toEqual([
			{
				id: 'aaa',
				name: 'contracts',
				summary: '',
				files: skeleton.layers[0]?.files,
				source: 'fallback',
				isTrailing: false,
			},
			{
				id: 'bbb',
				name: 'web · import',
				summary: '',
				files: skeleton.layers[1]?.files,
				source: 'fallback',
				isTrailing: false,
			},
			{
				id: 'ccc',
				name: 'Generated',
				summary: '',
				files: skeleton.layers[2]?.files,
				source: 'fallback',
				isTrailing: true,
			},
		])
	})

	it('replaces the name and summary of the layers the model labelled', () => {
		const [first, second] = applyLabels(skeleton, [entry('aaa', 'Add the import contract')])

		expect(first).toMatchObject({ name: 'Add the import contract', source: 'model' })
		expect(first?.summary).toBe('Add the import contract summary')
		expect(second).toMatchObject({ name: 'web · import', summary: '', source: 'fallback' })
	})

	it('ignores labels for ids the skeleton does not have', () => {
		expect(applyLabels(skeleton, [entry('zzz', 'Ghost')]).map((layer) => layer.source)).toEqual([
			'fallback',
			'fallback',
			'fallback',
		])
	})

	it('merges the listed layers into the entry and re-sorts the files by role', () => {
		const layers = applyLabels(skeleton, [entry('bbb', 'Import end to end', [], ['aaa'])])

		expect(layers.map((layer) => layer.id)).toEqual(['bbb', 'ccc'])
		expect(layers[0]).toMatchObject({ name: 'Import end to end', source: 'model' })
		expect(pathsOf(layers)[0]).toEqual([
			'packages/contracts/import.contract.ts',
			'packages/contracts/import.schema.ts',
			'apps/web/import.tsx',
		])
	})

	it('ignores merge ids that are unknown, already consumed, self, or the trailing group', () => {
		const layers = applyLabels(skeleton, [
			entry('aaa', 'Contract', [], ['zzz', 'aaa', 'ccc', 'bbb']),
			entry('bbb', 'Web', [], ['aaa']),
			entry('ccc', 'Generated', [], ['aaa']),
		])

		expect(layers.map((layer) => layer.id)).toEqual(['aaa', 'ccc'])
		expect(pathsOf(layers)).toEqual([
			[
				'packages/contracts/import.contract.ts',
				'packages/contracts/import.schema.ts',
				'apps/web/import.tsx',
			],
			['bun.lock'],
		])
	})

	it('drops a move into a layer that was merged away', () => {
		const layers = applyLabels(skeleton, [
			entry(
				'aaa',
				'Contract',
				[{ path: 'packages/contracts/import.schema.ts', toLayerId: 'bbb' }],
				['bbb'],
			),
		])

		expect(pathsOf(layers)[0]).toHaveLength(3)
	})

	it('moves a file when the path and the target both exist', () => {
		const [first, second] = applyLabels(skeleton, [
			entry('aaa', 'Contract', [{ path: 'packages/contracts/import.schema.ts', toLayerId: 'bbb' }]),
		])

		expect(first?.files.map((file) => file.path)).toEqual(['packages/contracts/import.contract.ts'])
		expect(second?.files.map((file) => file.path)).toEqual([
			'packages/contracts/import.schema.ts',
			'apps/web/import.tsx',
		])
	})

	it('ignores a move of an unknown path, to an unknown layer, or one that empties a layer', () => {
		const paths = (moves: { path: string; toLayerId: string }[]) =>
			applyLabels(skeleton, [entry('aaa', 'Contract', moves)]).map((layer) =>
				layer.files.map((file) => file.path),
			)

		expect(paths([{ path: 'apps/web/missing.ts', toLayerId: 'bbb' }])[1]).toHaveLength(1)
		expect(
			paths([{ path: 'packages/contracts/import.schema.ts', toLayerId: 'zzz' }])[0],
		).toHaveLength(2)
		expect(paths([{ path: 'apps/web/import.tsx', toLayerId: 'aaa' }])[1]).toEqual([
			'apps/web/import.tsx',
		])
	})
})

describe('LABEL_SCHEMA', () => {
	it('constrains the model to ids, names and summaries', () => {
		expect(LABEL_SCHEMA.properties.layers.items.required).toEqual(['id', 'name', 'summary'])
		expect(LABEL_SCHEMA.properties.layers.items.properties.name.maxLength).toBe(48)
		expect(LABEL_SCHEMA.properties.layers.items.properties.summary.maxLength).toBe(160)
		expect(LABEL_SCHEMA.properties.layers.items.properties.mergeIds).toEqual({
			type: 'array',
			items: { type: 'string' },
		})
	})
})
