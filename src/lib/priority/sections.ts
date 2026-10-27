import type { PanelFile, PanelLayer } from '../panel/store'
import {
	PRIORITIES,
	PRIORITY_NAMES,
	type Priority,
	type PriorityEntry,
	URGENT_LIMIT,
} from './schema'

export const PRIORITY_SECTION_PREFIX = 'priority:'
/** Low holds what a glance settles; it starts folded so the short list is what the reviewer sees. */
export const COLLAPSED_PRIORITY_SECTIONS = [`${PRIORITY_SECTION_PREFIX}low`]

/**
 * The Urgent, High, Medium and Low sections of a pull request's files, in the ranked order. Files the
 * ranking skipped take their fallback priority after the ranked ones; Urgent keeps its first
 * `URGENT_LIMIT` files and the rest lead High in the same order. Empty sections are left out.
 */
export function buildPrioritySections(
	files: readonly PanelFile[],
	ranked: readonly PriorityEntry[],
	fallback: readonly PriorityEntry[] = [],
): PanelLayer[] {
	const known = new Map(files.map((file) => [file.path, file]))
	const buckets = new Map<Priority, PanelFile[]>(PRIORITIES.map((priority) => [priority, []]))
	const placed = new Set<string>()

	function place({ path, priority, reason }: PriorityEntry) {
		const file = known.get(path)
		if (!file || placed.has(path)) return

		placed.add(path)
		const { isFocus: _isFocus, reason: _reason, ...rest } = file
		buckets.get(priority)?.push(reason ? { ...rest, reason } : rest)
	}

	for (const entry of ranked) place(entry)
	for (const entry of fallback) place(entry)
	for (const file of files) place({ path: file.path, priority: 'medium' })

	const urgent = buckets.get('urgent') ?? []
	buckets.set('urgent', urgent.slice(0, URGENT_LIMIT))
	buckets.set('high', [...urgent.slice(URGENT_LIMIT), ...(buckets.get('high') ?? [])])

	return PRIORITIES.flatMap((priority) => {
		const sectionFiles = buckets.get(priority) ?? []

		return sectionFiles.length > 0
			? {
					id: `${PRIORITY_SECTION_PREFIX}${priority}`,
					name: PRIORITY_NAMES[priority],
					summary: '',
					files: sectionFiles,
					isTrailing: false,
					isCollapsible: true,
				}
			: []
	})
}
