import type { GroupingEntry } from './grouping'

const FILE_LINE = /^- (\S+) \[.*?\].*? (@\d+)/

/** The @number of every file line of a grouping prompt, keyed by path. */
export function fileIds(groupingInput: string): Map<string, string> {
	return new Map(
		groupingInput.split('\n').flatMap((line) => {
			const match = FILE_LINE.exec(line)
			return match?.[1] && match[2] ? [[match[1], match[2]] as const] : []
		}),
	)
}

/** Turns "@12" answers back into paths; paths and unknown numbers pass through untouched. */
export function resolveFileIds(groups: GroupingEntry[], ids: Map<string, string>): GroupingEntry[] {
	const paths = new Map([...ids].map(([path, id]) => [id, path]))

	const resolve = (file: string) => paths.get(file.trim()) ?? file

	return groups.map((group) => ({
		...group,
		files: group.files.map(resolve),
		...(group.focus ? { focus: group.focus.map(resolve) } : {}),
	}))
}
