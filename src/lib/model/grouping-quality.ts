import type { GroupingEntry } from '../layers/grouping'
import { applyLabels } from '../layers/label-schema'
import { classifyRole } from '../layers/roles'
import type { AnalysisSnapshot } from './analysis-cache'
import type { LabelLayersRequest } from './label-layers'

const GENERIC_NAME =
	/^(?:(?:web|api|other|shared|docs|config) changes(?:\s*·.*)?|unassigned changes|review added changes)$/i
const CONTRACT_NAME = /^(?:define|declare|establish)\b.*\b(?:contracts?|types?|schemas?)\b/i

export function groupingRepairPaths(
	groups: GroupingEntry[],
	request: LabelLayersRequest,
): string[] {
	const known = new Set(request.files.map((file) => file.path))
	const placed = new Set<string>()
	const repair = new Set<string>()
	const directories = new Set(
		request.files.flatMap((file) =>
			file.path
				.split('/')
				.slice(0, -1)
				.map((part) => part.toLowerCase()),
		),
	)
	for (const group of groups) {
		const words = group.name
			.toLowerCase()
			.split(/[\s·/]+/)
			.filter(Boolean)
		const generic =
			words.length === 0 ||
			GENERIC_NAME.test(group.name) ||
			words.every((word) => directories.has(word))
		const mixedContracts =
			CONTRACT_NAME.test(group.name) &&
			group.files.some((path) => ['ui', 'server'].includes(classifyRole(path)))
		if (generic || !group.summary.trim() || mixedContracts)
			for (const path of group.files) if (known.has(path)) repair.add(path)
		for (const path of group.files) {
			if (placed.has(path)) repair.add(path)
			if (known.has(path)) placed.add(path)
		}
	}
	for (const path of known) if (!placed.has(path)) repair.add(path)
	return [...repair]
}

export function groupingSnapshot(
	snapshot: AnalysisSnapshot | undefined,
	request: LabelLayersRequest,
): AnalysisSnapshot | undefined {
	if (!snapshot || snapshot.response.grouping || !request.skeleton) return snapshot
	const grouping = applyLabels(request.skeleton, snapshot.response.layers)
		.filter((layer) => !layer.isTrailing)
		.map((layer) => ({
			name: layer.name,
			summary: layer.summary,
			files: layer.files.map((file) => file.path),
		}))
	return { ...snapshot, response: { ...snapshot.response, grouping } }
}
