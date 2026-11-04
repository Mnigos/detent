import type { Edge } from './graph'
import type { LabeledLayer } from './label-schema'
import { attachTests } from './test-subject'

interface ComponentFrame {
	path: string
	pending: Iterator<string>
}

// An edge closes a cycle exactly when both of its ends sit in one strongly connected component.
// One iterative Tarjan pass finds them all; a reachability search per edge took seconds per call
// on a few hundred densely linked files and froze the page.
function componentsOf(paths: string[], dependencies: Map<string, Set<string>>) {
	const index = new Map<string, number>()
	const lowLink = new Map<string, number>()
	const component = new Map<string, number>()
	const stack: string[] = []
	const frames: ComponentFrame[] = []

	function open(path: string) {
		index.set(path, index.size)
		lowLink.set(path, index.size - 1)
		stack.push(path)
		frames.push({ path, pending: (dependencies.get(path) ?? new Set<string>()).values() })
	}

	function lower(path: string, value: number | undefined) {
		if (value !== undefined && value < (lowLink.get(path) ?? value)) lowLink.set(path, value)
	}

	for (const root of paths) {
		if (index.has(root)) continue

		open(root)
		while (frames.length > 0) {
			const frame = frames[frames.length - 1]
			if (!frame) break

			const next = frame.pending.next()
			if (!next.done) {
				if (!index.has(next.value)) open(next.value)
				else if (!component.has(next.value)) lower(frame.path, index.get(next.value))
				continue
			}
			frames.pop()
			const parent = frames[frames.length - 1]
			if (parent) lower(parent.path, lowLink.get(frame.path))
			if (lowLink.get(frame.path) !== index.get(frame.path)) continue

			const id = component.size
			let member: string | undefined
			do {
				member = stack.pop()
				if (member !== undefined) component.set(member, id)
			} while (member !== undefined && member !== frame.path)
		}
	}

	return component
}

function order(paths: string[], edges: Edge[]): string[] {
	const known = new Set(paths)
	const dependencies = new Map(paths.map((path) => [path, new Set<string>()]))
	for (const { from, to } of edges)
		if (known.has(from) && known.has(to) && from !== to) dependencies.get(from)?.add(to)
	const components = componentsOf(paths, dependencies)
	const acyclic = new Map(
		paths.map((path) => [
			path,
			[...(dependencies.get(path) ?? [])].filter(
				(dependency) => components.get(dependency) !== components.get(path),
			),
		]),
	)
	const visited = new Set<string>()
	const result: string[] = []
	function visit(path: string) {
		if (visited.has(path)) return
		visited.add(path)
		for (const dependency of acyclic.get(path) ?? []) visit(dependency)
		result.push(path)
	}
	for (const path of paths) visit(path)
	return result
}

export function orderReviewLayers(layers: LabeledLayer[], edges: Edge[]): LabeledLayer[] {
	const owners = new Map(
		layers.flatMap((layer) => layer.files.map((file) => [file.path, layer.id] as const)),
	)
	const grouped = layers.filter((layer) => !layer.isTrailing)
	const layerEdges = edges.flatMap((edge) => {
		const from = owners.get(edge.from)
		const to = owners.get(edge.to)
		return from && to ? [{ ...edge, from, to }] : []
	})
	const ids = order(
		grouped.map((layer) => layer.id),
		layerEdges,
	)
	const byId = new Map(layers.map((layer) => [layer.id, layer]))
	return [...ids, ...layers.filter((layer) => layer.isTrailing).map((layer) => layer.id)].flatMap(
		(id) => {
			const layer = byId.get(id)
			if (!layer) return []
			const files = new Map(layer.files.map((file) => [file.path, file]))
			return [
				{
					...layer,
					// Dependencies first, then every test pulled up behind the file it tests.
					files: attachTests(
						order(
							layer.files.map((file) => file.path),
							edges,
						),
					).flatMap((path) => files.get(path) ?? []),
				},
			]
		},
	)
}
