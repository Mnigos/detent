import { commonDirectory, type Draft, directoryOf, sharedPrefixLength } from './layer-budget'
import { classifyRole, type FileRole, ROLE_LAYER_NAMES, ROLE_RANK } from './roles'

const GENERIC_SEGMENTS = new Set(['src', 'lib', 'modules', 'app', 'apps', 'packages', 'index'])

const specific = (segments: string[]) =>
	segments.filter((segment) => !GENERIC_SEGMENTS.has(segment))

const mostFrequent = <T>(values: T[], tieBreak: (left: T, right: T) => number) => {
	const counts = new Map<T, number>()
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)

	return [...counts].sort(
		([left, leftCount], [right, rightCount]) => rightCount - leftCount || tieBreak(left, right),
	)[0]?.[0]
}

const dominantRole = (core: string[]): FileRole =>
	mostFrequent(core.map(classifyRole), (left, right) => ROLE_RANK[left] - ROLE_RANK[right]) ??
	'other'

export const baseName = (core: string[]) =>
	specific(commonDirectory(core)).slice(-2).join(' · ') || ROLE_LAYER_NAMES[dominantRole(core)]

// The segment that tells a layer apart: its own directory beyond what it shares with the others, else the
// branch most of its files sit in below the common directory.
function distinguisher(draft: Draft, others: Draft[]): string | undefined {
	const own = commonDirectory(draft.core)
	const shared = others.reduce(
		(depth, other) => Math.min(depth, sharedPrefixLength(own, commonDirectory(other.core))),
		own.length,
	)
	const beyond = specific(own.slice(shared))[0]
	if (beyond) return beyond

	return mostFrequent(
		draft.core
			.map((path) => specific(directoryOf(path).slice(own.length))[0])
			.filter((segment) => segment !== undefined),
		(left, right) => left.localeCompare(right),
	)
}

export function nameDrafts(drafts: Draft[]): Draft[] {
	const named = drafts.map((draft) => ({ ...draft, name: draft.name ?? baseName(draft.core) }))
	for (;;) {
		const clash = named.find(
			(draft, index) => named.findIndex((other) => other.name === draft.name) !== index,
		)
		if (!clash) return named

		const group = named.filter((draft) => draft.name === clash.name)
		for (const draft of group) {
			const segment = distinguisher(
				draft,
				group.filter((other) => other !== draft),
			)
			if (segment) draft.name = `${draft.name} · ${segment}`
		}
		const target = group.find((draft) =>
			group.some((other) => other !== draft && other.name === draft.name),
		)
		if (!target) continue

		const rest = group.filter((draft) => draft !== target && draft.name === target.name)
		target.core = [...target.core, ...rest.flatMap((draft) => draft.core)].sort()
		target.name = baseName(target.core)
		for (const draft of rest) named.splice(named.indexOf(draft), 1)
	}
}
