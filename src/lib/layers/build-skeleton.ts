import type { DiffFile } from '../diff/parse-diff'
import type { Edge } from './graph'
import {
	commonDirectory,
	type Draft,
	directoryOf,
	layerBudget,
	mergeToBudget,
	sharedPrefixLength,
} from './layer-budget'
import { nameDrafts } from './layer-names'
import { classifyRole, type FileRole, ROLE_LAYER_NAMES, ROLE_RANK } from './roles'

export interface SkeletonLayer {
	id: string
	fallbackName: string
	files: { path: string; role: FileRole }[]
	rank: number
	isTrailing: boolean
}

export interface Skeleton {
	layers: SkeletonLayer[]
	edges: Edge[]
	maxLayers: number
}

const ATTACHED_AFTERWARDS: FileRole[] = ['test', 'docs', 'config', 'migration', 'generated']
const MAX_COMPONENT_FILES = 12

export function layerId(paths: string[]): string {
	let hash = 0x811c9dc5
	for (const character of [...paths].sort().join('\n'))
		hash = Math.imul(hash ^ character.charCodeAt(0), 0x01000193)

	return (hash >>> 0).toString(16).padStart(8, '0')
}

const closestLayer = (drafts: Draft[], path: string) => {
	const directory = directoryOf(path)
	let best: { draft: Draft; shared: number } | undefined
	for (const draft of drafts)
		for (const candidate of draft.core) {
			const shared = sharedPrefixLength(directory, directoryOf(candidate))
			if (shared > (best?.shared ?? 0)) best = { draft, shared }
		}

	return best
}

const testOwner = (drafts: Draft[], path: string) => {
	const tested = path.replace(/\.(spec|test)\./, '.').replace('/__tests__/', '/')

	return drafts.find((draft) => draft.core.includes(tested)) ?? closestLayer(drafts, path)?.draft
}

export function buildSkeleton(files: DiffFile[], edges: Edge[], cochange: Edge[] = []): Skeleton {
	const roles = new Map(files.map((file) => [file.path, classifyRole(file.path)]))
	const roleOf = (path: string) => roles.get(path) ?? 'other'
	const paths = files.map((file) => file.path)
	const grouped = paths.filter((path) => !ATTACHED_AFTERWARDS.includes(roleOf(path)))
	const migrations = paths.filter((path) => roleOf(path) === 'migration')
	const maxLayers = layerBudget(paths.filter((p) => roleOf(p) !== 'generated').length)

	const parents = new Map(grouped.map((path) => [path, path]))
	const sizes = new Map(grouped.map((path) => [path, 1]))
	const find = (path: string): string => {
		let root = path
		for (;;) {
			const parent = parents.get(root)
			if (parent === undefined || parent === root) break

			root = parent
		}
		parents.set(path, root)

		return root
	}
	const union = (from: string, to: string, limit: number) => {
		if (!parents.has(from) || !parents.has(to)) return
		const [left, right] = [find(from), find(to)]
		const size = (sizes.get(left) ?? 1) + (sizes.get(right) ?? 1)
		if (left === right || size > limit) return

		parents.set(left, right)
		sizes.set(right, size)
	}
	for (const edge of edges) union(edge.from, edge.to, Number.POSITIVE_INFINITY)
	// Shared identifiers join files of one behavior; a file serving two behaviors must not chain them all.
	for (const edge of cochange) union(edge.from, edge.to, MAX_COMPONENT_FILES)

	const components = new Map<string, string[]>()
	for (const path of grouped)
		components.set(find(path), [...(components.get(find(path)) ?? []), path])

	const groups: string[][] = []
	const oversized = [...components.values()]
	while (oversized.length > 0) {
		const component = oversized.pop() as string[]
		const depth = commonDirectory(component).length
		const branches = new Map<string, string[]>()
		for (const path of component) {
			const branch = directoryOf(path)[depth] ?? ''
			branches.set(branch, [...(branches.get(branch) ?? []), path])
		}
		if (component.length <= MAX_COMPONENT_FILES || branches.size < 2) {
			groups.push(component)
			continue
		}
		oversized.push(...branches.values())
	}

	const drafts: Draft[] = groups.map((core) => ({
		core: [...core].sort(),
		attached: [],
		rank: Math.min(...core.map((path) => ROLE_RANK[roleOf(path)])),
	}))
	const layerOfPath = new Map(
		drafts.flatMap((draft) => draft.core.map((path) => [path, draft] as const)),
	)
	const blockers = new Map(drafts.map((draft) => [draft, new Set<Draft>()]))
	for (const edge of edges) {
		const from = layerOfPath.get(edge.from)
		const to = layerOfPath.get(edge.to)
		if (from && to && from !== to) blockers.get(from)?.add(to)
	}

	const ordered: Draft[] = []
	const remaining = new Set(drafts)
	while (remaining.size > 0) {
		const ready = [...remaining].filter(
			(draft) => ![...(blockers.get(draft) ?? [])].some((blocker) => remaining.has(blocker)),
		)
		const [next] = (ready.length > 0 ? ready : [...remaining]).sort(
			(left, right) =>
				left.rank - right.rank || (left.core[0] ?? '').localeCompare(right.core[0] ?? ''),
		)
		if (!next) break

		ordered.push(next)
		remaining.delete(next)
	}

	// Migrations and tests no layer claims make their own layers, which the merge must count against the budget.
	const testPaths = paths.filter((path) => roleOf(path) === 'test')
	const reserved =
		(testPaths.some((path) => !testOwner(ordered, path)) ? 1 : 0) + (migrations.length > 0 ? 1 : 0)
	const leading: Draft[] =
		migrations.length > 0
			? [
					{
						core: migrations,
						attached: [],
						rank: ROLE_RANK.migration,
						name: ROLE_LAYER_NAMES.migration,
					},
				]
			: []
	// Merging follows imports and directories only: shared identifiers would pull every behavior into one layer.
	const merged = nameDrafts([...leading, ...mergeToBudget(ordered, edges, maxLayers - reserved)])

	const tests: Draft = { core: [], attached: [], rank: ROLE_RANK.test, name: ROLE_LAYER_NAMES.test }
	const trailing: Draft = {
		core: [],
		attached: [],
		rank: ROLE_RANK.generated,
		name: ROLE_LAYER_NAMES.generated,
	}
	for (const path of paths) {
		const role = roleOf(path)
		if (!ATTACHED_AFTERWARDS.includes(role) || role === 'migration') continue
		if (role === 'test') {
			const owner = testOwner(merged, path) ?? tests
			owner.attached.push(path)
			continue
		}
		const closest = closestLayer(merged, path)
		const target = role === 'generated' || !closest || closest.shared < 2 ? trailing : closest.draft
		target.attached.push(path)
	}

	const layers = [...merged, tests, trailing]
		.filter((draft) => draft.core.length + draft.attached.length > 0)
		.map((draft) => {
			const sorted = [...draft.core, ...draft.attached].sort(
				(left, right) =>
					ROLE_RANK[roleOf(left)] - ROLE_RANK[roleOf(right)] || left.localeCompare(right),
			)

			return {
				id: layerId(sorted),
				fallbackName: draft.name ?? ROLE_LAYER_NAMES.other,
				files: sorted.map((path) => ({ path, role: roleOf(path) })),
				rank: draft.rank,
				isTrailing: draft === trailing,
			}
		})

	return { layers, edges, maxLayers }
}
