import { describe, expect, it } from 'vitest'
import type { AnalysisSnapshot } from './analysis-cache'
import { prepareGroupingUpdate } from './incremental-grouping'
import { LABEL_LAYERS_MESSAGE, type LabelLayersRequest } from './label-layers'

const PREVIOUS: AnalysisSnapshot = {
	digest: 'a',
	files: [
		{ path: 'src/api/lock.ts', digest: 'a' },
		{ path: 'src/web/page.tsx', digest: 'a' },
	],
	response: {
		layers: [],
		source: 'model',
		labeler: 'openrouter',
		grouping: [
			{ name: 'Lock', summary: 'First.', files: ['src/api/lock.ts'] },
			{ name: 'UI', summary: 'Last.', files: ['src/web/page.tsx'] },
		],
	},
}
const REQUEST: LabelLayersRequest = {
	type: LABEL_LAYERS_MESSAGE,
	scope: 'owner/repo/1',
	digest: 'b',
	maxLayers: 3,
	files: PREVIOUS.files,
	groupingInput:
		'Read dependencies first.\n- src/api/lock.ts [server] @1\n- src/web/page.tsx [ui] @2',
}

describe('incremental grouping', () => {
	it('updates nearby additions without sending unrelated file details', () => {
		const update = prepareGroupingUpdate(PREVIOUS, {
			...REQUEST,
			files: [...PREVIOUS.files, { path: 'src/api/helper.ts', digest: 'new' }],
		})
		expect([...update.paths]).toEqual(['src/api/lock.ts', 'src/api/helper.ts'])
		expect(update.input).not.toContain('- src/web/page.tsx [ui]')
		expect(
			update.merge([
				{
					name: 'Lock',
					summary: 'New helper first.',
					files: ['src/api/helper.ts', 'src/api/lock.ts'],
				},
			]),
		).toEqual([
			{
				name: 'Lock',
				summary: 'New helper first.',
				files: ['src/api/helper.ts', 'src/api/lock.ts'],
			},
			PREVIOUS.response.grouping?.[1],
		])
	})

	it('repeats the author review guidance in the update prompt', () => {
		const update = prepareGroupingUpdate(PREVIOUS, {
			...REQUEST,
			files: [...PREVIOUS.files, { path: 'src/api/helper.ts', digest: 'new' }],
			groupingInput: `Pull request: T\n\nReview guidance from the author, follow it:\nStart with the schema.\nThen the handler.\n\n${REQUEST.groupingInput}`,
		})
		expect(update.input).toContain(
			'Review guidance from the author, follow it:\nStart with the schema.\nThen the handler.',
		)
	})

	it('drops a removed layer locally and preserves the remaining one exactly', () => {
		const update = prepareGroupingUpdate(PREVIOUS, {
			...REQUEST,
			files: PREVIOUS.files.filter((file) => file.path.endsWith('.tsx')),
		})
		expect(update.paths.size).toBe(0)
		expect(update.merge([])).toEqual([PREVIOUS.response.grouping?.[1]])
	})

	it('does not accept duplicates, unknown files or edits to unaffected layers', () => {
		const update = prepareGroupingUpdate(PREVIOUS, {
			...REQUEST,
			files: [{ path: 'src/api/lock.ts', digest: 'new' }, ...PREVIOUS.files.slice(1)],
		})
		expect(
			update.merge([
				{
					name: 'Lock',
					summary: 'Changed.',
					files: ['src/api/lock.ts', 'src/api/lock.ts', 'unknown', 'src/web/page.tsx'],
				},
			]),
		).toEqual([
			{ name: 'Lock', summary: 'Changed.', files: ['src/api/lock.ts'] },
			PREVIOUS.response.grouping?.[1],
		])
	})

	it('preserves group meanings and omitted prior files even beyond the suggested budget', () => {
		const files = [
			...PREVIOUS.files,
			{ path: 'src/api/one.ts', digest: 'one' },
			{ path: 'src/api/two.ts', digest: 'two' },
		]
		const update = prepareGroupingUpdate(PREVIOUS, { ...REQUEST, maxLayers: 2, files })
		const result = update.merge([
			{ name: 'One', summary: '', files: ['src/api/one.ts'] },
			{ name: 'Two', summary: '', files: ['src/api/two.ts'] },
		])
		expect(result).toHaveLength(4)
		expect(result.at(-1)).toEqual(PREVIOUS.response.grouping?.[1])
		expect(result.flatMap((group) => group.files).sort()).toEqual(
			files.map((file) => file.path).sort(),
		)
	})
})

it('preserves separate affected groups and their slots on empty or partial responses', () => {
	const groups = ['a', 'b', 'c'].map((name) => ({ name, summary: name, files: [name] }))
	const previous = {
		...PREVIOUS,
		files: groups.map((group) => ({ path: group.name, digest: 'old' })),
		response: { ...PREVIOUS.response, grouping: groups },
	}
	const update = prepareGroupingUpdate(previous, {
		...REQUEST,
		files: previous.files.map((file) => ({ ...file, digest: file.path === 'b' ? 'old' : 'new' })),
	})
	expect(update.merge([])).toEqual(groups)
	expect(update.merge(groups.slice(0, 1))).toEqual(groups)
})

it('keeps a large incremental prompt within the normal budget without dropping paths', () => {
	const files = Array.from({ length: 50 }, (_, index) => ({
		path: `src/billing/infrastructure/repositories/provider-${index}.repository.ts`,
		digest: 'new',
	}))
	const previous = {
		...PREVIOUS,
		files: files.map((file) => ({ ...file, digest: 'old' })),
		response: {
			...PREVIOUS.response,
			grouping: [{ name: 'Billing', summary: '', files: files.map((file) => file.path) }],
		},
	}
	const update = prepareGroupingUpdate(previous, {
		...REQUEST,
		files,
		groupingInput: files
			.map(
				(file, index) =>
					`- ${file.path} [server] +5/-2 @${index + 1} :: withProviderReferenceLock | Provider`,
			)
			.join('\n'),
	})
	expect(update.input.length).toBeLessThanOrEqual(6000)
	for (const file of files) expect(update.input).toContain(file.path)
})
