import type { Edge } from './graph'
import type { LabeledLayer } from './label-schema'
import { attachTests } from './test-subject'

function order(paths: string[], edges: Edge[]): string[] {
	const known = new Set(paths)
	const dependencies = new Map(paths.map((path) => [path, new Set<string>()]))
	for (const { from, to } of edges)
		if (known.has(from) && known.has(to) && from !== to) dependencies.get(from)?.add(to)
	function reaches(start: string, target: string): boolean {
		const pending = [start]
		const visited = new Set<string>()
		while (pending.length > 0) {
			const path = pending.pop()
			if (path === target) return true
			if (!path || visited.has(path)) continue
			visited.add(path)
			pending.push(...(dependencies.get(path) ?? []))
		}
		return false
	}
	const acyclic = new Map(
		paths.map((path) => [
			path,
			[...(dependencies.get(path) ?? [])].filter((dependency) => !reaches(dependency, path)),
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
