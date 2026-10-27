import type { FolderNode } from './folders'

const GROUP_STYLE = 'list-style:none;padding:0;margin:0'
export const ROW_TEXT_STYLE =
	'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'

export const container = (row: HTMLLIElement) =>
	row.querySelector<HTMLElement>('[style*="--level"]') ?? (row.firstElementChild as HTMLElement)

export function setLevel(row: HTMLLIElement, level: number, levelLine: HTMLElement | undefined) {
	row.setAttribute('aria-level', String(level))
	const box = container(row)
	box.style.setProperty('--level', String(level))
	const lines = [...box.querySelectorAll('[class*="level-line"]')]
	const spacer = lines[0]?.parentElement ?? box.querySelector('[style*="spacer"] > div')
	for (const line of lines) line.remove()
	if (levelLine && spacer)
		for (let count = 1; count < level; count += 1) spacer.append(levelLine.cloneNode(true))
}

export function group(label: string, rows: readonly HTMLLIElement[]): HTMLUListElement {
	const list = document.createElement('ul')
	list.setAttribute('role', 'group')
	list.setAttribute('aria-label', label)
	list.style.cssText = GROUP_STYLE
	list.append(...rows)

	return list
}

/** An always-open folder row in GitHub's directory markup; clicking it selects nothing. */
export function folderRow(
	template: HTMLLIElement,
	levelLine: HTMLElement | undefined,
	node: FolderNode,
	level: number,
	children: readonly HTMLLIElement[],
): HTMLLIElement {
	const row = template.cloneNode(true) as HTMLLIElement
	setLevel(row, level, levelLine)
	row.setAttribute('aria-expanded', 'true')
	row.setAttribute('aria-selected', 'false')
	row.setAttribute('aria-label', node.label)
	row.dataset.folder = node.path
	const text = row.querySelector<HTMLElement>('[class*="content-text"]')
	if (text) {
		text.style.cssText = ROW_TEXT_STYLE
		text.title = node.path
		const name = document.createElement('span')
		name.textContent = node.label
		text.replaceChildren(name)
	}
	row.append(group(node.label, children))

	return row
}
