import { parseUnifiedDiff } from '../diff/parse-diff'

export interface DiffStats {
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
	}
}

// A thin space groups thousands without reading as a list separator next to "·".
export const formatCount = (count: number) => count.toLocaleString('en-US').replaceAll(',', ' ')

export const formatFiles = (files: number) =>
	`${formatCount(files)} ${files === 1 ? 'file' : 'files'}`
