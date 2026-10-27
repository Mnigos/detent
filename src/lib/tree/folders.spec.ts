import { describe, expect, it } from 'vitest'
import { buildFolderTree, type TreeNode } from './folders'

const entries = (...paths: string[]) => paths.map((path, index) => ({ path, index }))

// A compact picture of a tree: folders as `label/` with their children, files as `name#index`.
const outline = (nodes: readonly TreeNode[]): unknown[] =>
	nodes.map((node) =>
		node.kind === 'file'
			? `${node.name}#${node.index}`
			: { [`${node.label}/`]: outline(node.children) },
	)

describe('buildFolderTree', () => {
	it('returns nothing for no files', () => {
		expect(buildFolderTree([])).toEqual([])
	})

	it('keeps root files as plain file nodes', () => {
		expect(buildFolderTree(entries('bun.lock', 'README.md'))).toEqual([
			{ kind: 'file', name: 'bun.lock', path: 'bun.lock', index: 0 },
			{ kind: 'file', name: 'README.md', path: 'README.md', index: 1 },
		])
	})

	it('compresses a chain of single-child folders into one node with the joined label', () => {
		const [folder] = buildFolderTree(entries('apps/api/src/config/env.ts'))

		expect(folder).toEqual({
			kind: 'folder',
			label: 'apps/api/src/config',
			path: 'apps/api/src/config',
			children: [{ kind: 'file', name: 'env.ts', path: 'apps/api/src/config/env.ts', index: 0 }],
		})
	})

	it('groups files of the same folder and splits the chain where folders branch', () => {
		const tree = buildFolderTree(
			entries(
				'packages/instrumentation/lib/analytics/posthog/capture/events.ts',
				'packages/instrumentation/lib/config.test.ts',
				'packages/instrumentation/lib/analytics/posthog/capture/client.ts',
				'packages/instrumentation/lib/analytics/posthog/index.ts',
			),
		)

		expect(outline(tree)).toEqual([
			{
				'packages/instrumentation/lib/': [
					{
						'analytics/posthog/': [{ 'capture/': ['events.ts#0', 'client.ts#2'] }, 'index.ts#3'],
					},
					'config.test.ts#1',
				],
			},
		])
		const [root] = tree
		const [analytics] = root?.kind === 'folder' ? root.children : []
		expect(analytics?.kind === 'folder' && analytics.path).toBe(
			'packages/instrumentation/lib/analytics/posthog',
		)
	})

	it('does not fold a folder that also holds files', () => {
		expect(outline(buildFolderTree(entries('src/a.ts', 'src/lib/b.ts')))).toEqual([
			{ 'src/': [{ 'lib/': ['b.ts#1'] }, 'a.ts#0'] },
		])
	})

	it('puts folders first, sorted by name, and keeps the given file order', () => {
		expect(outline(buildFolderTree(entries('z.ts', 'web/x.ts', 'a.ts', 'api/y.ts')))).toEqual([
			{ 'api/': ['y.ts#3'] },
			{ 'web/': ['x.ts#1'] },
			'z.ts#0',
			'a.ts#2',
		])
	})

	it('carries the indices it was given, not positions in the input', () => {
		const tree = buildFolderTree([
			{ path: 'src/b.ts', index: 4 },
			{ path: 'src/a.ts', index: 7 },
		])

		expect(outline(tree)).toEqual([{ 'src/': ['b.ts#4', 'a.ts#7'] }])
	})
})
