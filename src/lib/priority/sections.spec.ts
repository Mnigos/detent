import { describe, expect, it } from 'vitest'
import type { PanelFile } from '../panel/store'
import type { PriorityEntry } from './schema'
import { buildPrioritySections } from './sections'

const panelFile = (path: string): PanelFile => ({
	path,
	role: 'server',
	additions: 1,
	deletions: 0,
	isFocus: true,
})

const sectionsOf = (layers: ReturnType<typeof buildPrioritySections>) =>
	layers.map((layer) => [layer.name, layer.files.map((file) => file.path)])

describe('buildPrioritySections', () => {
	it.each([10, 11, 24])('handles %i files all marked Urgent in model order', (count) => {
		const paths = Array.from({ length: count }, (_, index) => `file-${count - index}.ts`)
		const ranked: PriorityEntry[] = paths.map((path) => ({
			path,
			priority: 'urgent',
			reason: path,
		}))
		const sections = buildPrioritySections([...paths].reverse().map(panelFile), ranked)
		expect(sectionsOf(sections)).toEqual([
			['Urgent', paths.slice(0, 10)],
			...(count > 10 ? [['High', paths.slice(10)]] : []),
		])
		expect(sections.flatMap((section) => section.files.map((file) => file.reason))).toEqual(paths)
		expect(sections.flatMap((section) => section.files)).toHaveLength(count)
	})

	it('counts only distinct known files toward the Urgent limit', () => {
		const paths = Array.from({ length: 11 }, (_, index) => `${index}.ts`)
		const ranked: PriorityEntry[] = [
			{ path: 'invented.ts', priority: 'urgent' },
			...paths.flatMap((path): PriorityEntry[] => [
				{ path, priority: 'urgent' },
				{ path, priority: 'high' },
			]),
		]
		expect(sectionsOf(buildPrioritySections(paths.map(panelFile), ranked))).toEqual([
			['Urgent', paths.slice(0, 10)],
			['High', [paths[10]]],
		])
	})

	it('leaves Urgent hidden when no model or fallback entry ranks a file Urgent', () => {
		const files = ['a.ts', 'b.ts'].map(panelFile)
		expect(
			sectionsOf(
				buildPrioritySections(files, [
					{ path: 'b.ts', priority: 'high' },
					{ path: 'a.ts', priority: 'low' },
				]),
			),
		).toEqual([
			['High', ['b.ts']],
			['Low', ['a.ts']],
		])
		expect(buildPrioritySections([], [])).toEqual([])
	})

	it('builds collapsible sections in Urgent, High, Medium, Low order and leaves empty ones out', () => {
		const files = ['a.ts', 'b.ts', 'c.ts'].map(panelFile)
		const layers = buildPrioritySections(files, [
			{ path: 'c.ts', priority: 'low' },
			{ path: 'a.ts', priority: 'urgent', reason: 'Charges twice.' },
			{ path: 'b.ts', priority: 'low' },
		])

		expect(sectionsOf(layers)).toEqual([
			['Urgent', ['a.ts']],
			['Low', ['c.ts', 'b.ts']],
		])
		expect(layers.map((layer) => layer.id)).toEqual(['priority:urgent', 'priority:low'])
		expect(layers.every((layer) => layer.isCollapsible && !layer.isTrailing)).toBe(true)
		expect(layers[0]?.files[0]).toEqual({
			path: 'a.ts',
			role: 'server',
			additions: 1,
			deletions: 0,
			reason: 'Charges twice.',
		})
	})

	it('caps Urgent at ten files and leads High with the overflow in the ranked order', () => {
		const paths = Array.from({ length: 13 }, (_, index) => `urgent-${index}.ts`)
		const ranked: PriorityEntry[] = [
			{ path: 'high.ts', priority: 'high' },
			...paths.map((path): PriorityEntry => ({ path, priority: 'urgent' })),
		]
		const layers = buildPrioritySections([...paths, 'high.ts'].map(panelFile), ranked)

		expect(sectionsOf(layers)).toEqual([
			['Urgent', paths.slice(0, 10)],
			['High', [...paths.slice(10), 'high.ts']],
		])
	})

	it('places files the ranking skipped by the fallback, then as Medium, and ignores unknown paths', () => {
		const files = ['ranked.ts', 'skipped.ts', 'unknown-to-both.ts'].map(panelFile)
		const layers = buildPrioritySections(
			files,
			[
				{ path: 'ranked.ts', priority: 'high' },
				{ path: 'invented.ts', priority: 'urgent' },
				{ path: 'ranked.ts', priority: 'low' },
			],
			[
				{ path: 'skipped.ts', priority: 'low' },
				{ path: 'ranked.ts', priority: 'urgent' },
			],
		)

		expect(sectionsOf(layers)).toEqual([
			['High', ['ranked.ts']],
			['Medium', ['unknown-to-both.ts']],
			['Low', ['skipped.ts']],
		])
	})
})
