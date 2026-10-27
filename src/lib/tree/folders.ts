export interface FolderEntry {
	path: string
	/** The file's index in its layer, carried through so a row can report its position. */
	index: number
}

export interface FileNode {
	kind: 'file'
	name: string
	path: string
	index: number
}

export interface FolderNode {
	kind: 'folder'
	/** A chain of single-child folders shows as one row, e.g. `packages/instrumentation/lib`. */
	label: string
	path: string
	children: TreeNode[]
}

export type TreeNode = FileNode | FolderNode

interface Draft {
	folders: Map<string, Draft>
	files: FileNode[]
}

const emptyDraft = (): Draft => ({ folders: new Map(), files: [] })

function settle(draft: Draft, parentPath: string): TreeNode[] {
	const folders = [...draft.folders]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([name, child]): FolderNode => {
			let label = name
			let node = child
			// A folder holding nothing but one folder folds into it, like GitHub's own tree.
			while (node.files.length === 0 && node.folders.size === 1) {
				const [[nextName, next]] = [...node.folders] as [[string, Draft]]
				label = `${label}/${nextName}`
				node = next
			}
			const path = parentPath ? `${parentPath}/${label}` : label

			return { kind: 'folder', label, path, children: settle(node, path) }
		})

	return [...folders, ...draft.files]
}

/**
 * Builds the folder hierarchy of a layer's files: folders first, sorted by name, then the files in
 * the order given, with chains of single-child folders compressed into one node.
 */
export function buildFolderTree(entries: readonly FolderEntry[]): TreeNode[] {
	const root = emptyDraft()
	for (const { path, index } of entries) {
		const segments = path.split('/')
		const name = segments.pop() ?? path
		let draft = root
		for (const segment of segments) {
			let next = draft.folders.get(segment)
			if (!next) {
				next = emptyDraft()
				draft.folders.set(segment, next)
			}
			draft = next
		}
		draft.files.push({ kind: 'file', name, path, index })
	}

	return settle(root, '')
}
