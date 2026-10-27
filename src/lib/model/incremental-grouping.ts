import { fileIds } from '../layers/file-ids'
import type { GroupingEntry } from '../layers/grouping'
import { directoryOf, sharedPrefixLength } from '../layers/layer-budget'
import type { AnalysisSnapshot } from './analysis-cache'
import type { LabelLayersRequest } from './label-layers'

export function prepareGroupingUpdate(
	previous: AnalysisSnapshot,
	request: LabelLayersRequest,
	repairPaths: string[] = [],
	budget = 6000,
	intent?: string,
) {
	const groups = previous.response.grouping ?? []
	const before = new Map(previous.files.map((file) => [file.path, file.digest]))
	const current = new Set(request.files.map((file) => file.path))
	const changed = new Set([
		...repairPaths,
		...request.files
			.filter((file) => before.get(file.path) !== file.digest)
			.map((file) => file.path),
	])
	const removed = new Set(
		previous.files.filter((file) => !current.has(file.path)).map((file) => file.path),
	)
	const affected = new Set<number>()
	for (const [index, group] of groups.entries())
		if (group.files.some((path) => changed.has(path) || removed.has(path))) affected.add(index)
	for (const path of changed) {
		if (before.has(path)) continue
		const closest = groups
			.map((group, index) => ({
				index,
				shared: Math.max(
					0,
					...group.files.map((file) => sharedPrefixLength(directoryOf(file), directoryOf(path))),
				),
			}))
			.sort((left, right) => right.shared - left.shared)[0]
		if (closest && closest.shared >= 2) affected.add(closest.index)
	}
	if (affected.size === 0 && changed.size > 0 && groups.length >= request.maxLayers)
		affected.add(groups.length - 1)
	const paths = new Set([
		...groups.flatMap((group, index) =>
			affected.has(index) ? group.files.filter((path) => current.has(path)) : [],
		),
		...changed,
	])
	const fileLines = request.groupingInput.split('\n').filter((line) => line.startsWith('- '))
	const ids = fileIds(request.groupingInput)
	const reference = (path: string) => ids.get(path) ?? path
	const details = fileLines.filter((line) =>
		[...paths].some((path) => line.startsWith(`- ${path} [`)),
	)
	const dependencies = new Set(
		details.flatMap((line) => line.split(' needs ')[1]?.split(' :: ')[0]?.match(/@\d+/g) ?? []),
	)
	const outside = [...ids]
		.filter(([path, id]) => !paths.has(path) && dependencies.has(id))
		.map(([path, id]) => `${id} ${path}`)
	// The block ends at the first blank line; without the m flag, $ is the end of the whole input.
	const guidance = /(?:^|\n)(Review guidance from the author[^\n]*\n[\s\S]*?)(?=\n\n|$)/.exec(
		request.groupingInput,
	)?.[1]
	const context = [
		'Update the existing review analysis, do not regroup the whole pull request.',
		...(guidance ? [guidance] : []),
		...(intent ? [intent] : []),
		'Answer with @numbers, never paths. In each step, focus lists the files that deserve a careful read (new logic, contracts, migrations, auth, error handling); leave mechanical edits, renames and generated files out of focus. Preserve meaningful existing names and reading order. Replace directory/package labels and inaccurate titles with specific behavior descriptions; split mixed contracts/consumer groups. Group across packages by purpose, not directories. Every group needs an action title and an explanatory summary. Read new dependencies before callers, definitions before implementations and tests. Return only listed files, each once, in affected layers. @numbers identify paths; needs lists dependencies. Other layers are preserved locally.',
		`Previous analysis: ${JSON.stringify(groups.filter((_, index) => affected.has(index)).map((group) => ({ name: group.name, files: group.files.filter((path) => current.has(path)).map(reference) })))}`,
		`Changed files: ${JSON.stringify([...changed].map(reference))}. Removed files: ${JSON.stringify([...removed])}.`,
		`Return at most ${Math.max(1, request.maxLayers - (groups.length - affected.size))} layers.`,
		...(outside.length > 0
			? [`Dependencies outside this update (do not return): ${outside.join('; ')}`]
			: []),
	].join('\n\n')
	const withSignals = `${context}\n\n${details.join('\n')}`
	const instruction =
		withSignals.length <= budget
			? withSignals
			: `${context}\n\n${details.map((line) => line.split(' :: ')[0]).join('\n')}`

	function merge(updates: GroupingEntry[]): GroupingEntry[] {
		const placed = new Set<string>()
		const updated = updates
			.map((group) => ({
				...group,
				files: group.files.filter((path) => {
					if (!paths.has(path) || placed.has(path)) return false
					placed.add(path)
					return true
				}),
			}))
			.filter((group) => group.files.length > 0)
		for (const path of paths) {
			if (placed.has(path)) continue
			const old = groups.find((group) => group.files.includes(path))
			const target = old
				? updated.find(
						(group) =>
							group.name === old.name || group.files.some((file) => old.files.includes(file)),
					)
				: updated.find((group) => group.name === 'Unassigned changes')
			if (target) target.files.push(path)
			else
				updated.push({
					name: old?.name ?? 'Unassigned changes',
					summary: old?.summary ?? 'These files were not assigned to a review step.',
					files: [path],
				})
		}
		const slots = new Map<number, GroupingEntry[]>()
		for (const group of updated) {
			const matching =
				[...affected].find((index) => groups[index]?.name === group.name) ??
				[...affected].find((index) =>
					groups[index]?.files.some((path) => group.files.includes(path)),
				) ??
				(affected.size > 0 ? Math.min(...affected) : groups.length)
			slots.set(matching, [...(slots.get(matching) ?? []), group])
		}
		const result = groups.flatMap((group, index) =>
			affected.has(index)
				? (slots.get(index) ?? [])
				: [{ ...group, files: group.files.filter((path) => current.has(path)) }],
		)
		result.push(...(slots.get(groups.length) ?? []))
		return result.filter((group) => group.files.length > 0)
	}

	return { input: instruction, paths, changed, removed, merge }
}
