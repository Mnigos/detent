import type { GroupingEntry } from './grouping'
import { directoryOf, sharedPrefixLength } from './layer-budget'

export const UNASSIGNED_NAME = 'Unassigned changes'
const UNASSIGNED_SUMMARY = 'These files were not assigned to a review step.'
// Two shared directory segments, such as `apps/api`, is the least that says "same area".
const CLOSE_ENOUGH = 2

export const hasUnassigned = (groups: GroupingEntry[] | undefined) =>
	groups?.some((group) => group.name === UNASSIGNED_NAME) ?? false

/**
 * Puts every file the model left out, or parked under "Unassigned changes", into the group whose
 * files share the longest directory prefix with it. Only files nothing is close to stay unassigned.
 */
export function placeLeftovers(groups: GroupingEntry[], paths: string[]): GroupingEntry[] {
	const named = groups
		.filter((group) => group.name !== UNASSIGNED_NAME)
		.map((group) => ({ ...group, files: [...group.files] }))
	const placed = new Set(named.flatMap((group) => group.files))
	const leftovers = paths.filter((path) => !placed.has(path))
	const unassigned: string[] = []
	for (const path of leftovers) {
		const closest = named
			.map((group) => ({
				group,
				shared: Math.max(
					0,
					...group.files.map((file) => sharedPrefixLength(directoryOf(file), directoryOf(path))),
				),
			}))
			.sort((left, right) => right.shared - left.shared)[0]
		if (closest && closest.shared >= CLOSE_ENOUGH) closest.group.files.push(path)
		else unassigned.push(path)
	}

	return unassigned.length > 0
		? [...named, { name: UNASSIGNED_NAME, summary: UNASSIGNED_SUMMARY, files: unassigned }]
		: named
}
