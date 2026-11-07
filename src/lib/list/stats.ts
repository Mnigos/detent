import { parseUnifiedDiff } from '../diff/parse-diff'
import {
	type CodeLines,
	codeLines,
	EXCLUDED_LABELS,
	type ExcludedKind,
	type LineCounts,
} from './code-lines'

export interface DiffStats extends CodeLines {
	additions: number
	deletions: number
	files: number
}

export function diffStats(diff: string): DiffStats {
	const files = parseUnifiedDiff(diff)

	return {
		additions: files.reduce((sum, file) => sum + file.additions, 0),
		deletions: files.reduce((sum, file) => sum + file.deletions, 0),
		files: files.length,
		...codeLines(files),
	}
}

// A thin space groups thousands without reading as a list separator next to "·".
export const formatCount = (count: number) => count.toLocaleString('en-US').replaceAll(',', ' ')

export const formatFiles = (files: number) =>
	`${formatCount(files)} ${files === 1 ? 'file' : 'files'}`

/** The code part is left out when nothing was excluded. */
export const hasExcludedLines = (stats: DiffStats) =>
	stats.code.additions !== stats.additions || stats.code.deletions !== stats.deletions

const formatChange = ({ additions, deletions }: LineCounts) =>
	[additions > 0 && `+${formatCount(additions)}`, deletions > 0 && `−${formatCount(deletions)}`]
		.filter(Boolean)
		.join(' ')

/** The title of the code part: what was left out of the code counts, kind by kind. */
export function codeTooltip({ excluded }: Pick<DiffStats, 'excluded'>): string {
	const parts = (Object.keys(EXCLUDED_LABELS) as ExcludedKind[]).flatMap((kind) => {
		const counts = excluded[kind]

		return counts ? `${EXCLUDED_LABELS[kind]} ${formatChange(counts)}` : []
	})

	return `Excluded: ${parts.join(', ')}.\nComment lines are detected approximately.`
}
