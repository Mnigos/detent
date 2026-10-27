export interface DiffHunk {
	oldStart: number
	oldLines: number
	newStart: number
	newLines: number
	header: string
	addedLines: string[]
	removedLines: string[]
	/** The hunk body as git printed it, context included, for a model that reads the diff itself. */
	lines?: string[]
}

export interface DiffFile {
	path: string
	oldPath?: string
	status: 'added' | 'modified' | 'deleted' | 'renamed'
	isBinary: boolean
	additions: number
	deletions: number
	hunks: DiffHunk[]
}

// Paths containing spaces are out of scope: the `diff --git` header is split on whitespace.
const FILE_HEADER = /^diff --git a\/(\S+) b\/(\S+)$/
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/

export function parseUnifiedDiff(text: string): DiffFile[] {
	const files: DiffFile[] = []
	let file: DiffFile | undefined
	let hunk: DiffHunk | undefined

	for (const line of text.split('\n')) {
		const fileHeader = FILE_HEADER.exec(line)
		if (fileHeader) {
			const [, oldPath = '', newPath = ''] = fileHeader
			file = {
				path: newPath,
				status: 'modified',
				isBinary: false,
				additions: 0,
				deletions: 0,
				hunks: [],
			}
			if (oldPath !== newPath) file.oldPath = oldPath
			hunk = undefined
			files.push(file)
			continue
		}
		if (!file) continue

		const hunkHeader = HUNK_HEADER.exec(line)
		if (hunkHeader) {
			const [, oldStart = '0', oldLines, newStart = '0', newLines, header = ''] = hunkHeader
			hunk = {
				oldStart: Number(oldStart),
				oldLines: oldLines === undefined ? 1 : Number(oldLines),
				newStart: Number(newStart),
				newLines: newLines === undefined ? 1 : Number(newLines),
				header,
				addedLines: [],
				removedLines: [],
				lines: [],
			}
			file.hunks.push(hunk)
			continue
		}

		if (hunk) {
			if (line.startsWith('\\')) continue
			hunk.lines?.push(line)
			if (line.startsWith('+')) {
				hunk.addedLines.push(line.slice(1))
				file.additions += 1
			} else if (line.startsWith('-')) {
				hunk.removedLines.push(line.slice(1))
				file.deletions += 1
			}
			continue
		}

		if (line.startsWith('new file mode')) file.status = 'added'
		else if (line.startsWith('deleted file mode')) file.status = 'deleted'
		else if (line.startsWith('rename from ')) {
			file.status = 'renamed'
			file.oldPath = line.slice('rename from '.length)
		} else if (line.startsWith('rename to ')) {
			file.status = 'renamed'
			file.path = line.slice('rename to '.length)
		} else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
			file.isBinary = true
		} else if (line === '--- /dev/null') file.status = 'added'
		else if (line === '+++ /dev/null') file.status = 'deleted'
	}

	return files
}
