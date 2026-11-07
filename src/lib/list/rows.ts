import { codeTooltip, type DiffStats, formatCount, formatFiles, hasExcludedLines } from './stats'

export const STATS_ATTRIBUTE = 'data-detent-diff-stats'
export const CONFLICTS_ATTRIBUTE = 'data-detent-conflicts'
export const CONFLICTS_TITLE = 'This branch has conflicts with the base branch'

export interface PullsListLocation {
	owner: string
	repo: string
}

export interface PullRow {
	owner: string
	repo: string
	number: number
	/** Open or draft; a closed or merged pull request cannot gain conflicts. */
	isOpen: boolean
	/** The row's meta line: "#1277 · author opened … · checks". */
	meta: HTMLElement
}

const PULLS_PATH = /^\/([^/]+)\/([^/]+)\/pulls\/?$/
const PULL_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)$/

export function parsePullsListUrl(url: string): PullsListLocation | undefined {
	try {
		const parsed = new URL(url)
		if (parsed.hostname !== 'github.com') return undefined
		const [, owner, repo] = PULLS_PATH.exec(parsed.pathname) ?? []

		return owner && repo ? { owner, repo } : undefined
	} catch {
		return undefined
	}
}

// The React list hashes its class names per build; the title link, the timestamp's test id and the
// row's <li> are what stays put. The description module class is the fallback for a row without a
// timestamp.
function metaLine(row: Element): HTMLElement | null {
	const timestamp = row.querySelector('[data-testid="timestamp-container"]')
	if (timestamp?.parentElement) return timestamp.parentElement

	return row.querySelector<HTMLElement>('[class*="Description-module__container"]')
}

// The leading state icon: git-pull-request (open), -draft, -closed, or git-merge.
const isOpenRow = (row: Element) =>
	Boolean(row.querySelector('svg.octicon-git-pull-request, svg.octicon-git-pull-request-draft'))

export function findPullRows(root: ParentNode = document): PullRow[] {
	const rows: PullRow[] = []
	for (const link of root.querySelectorAll<HTMLAnchorElement>('li a[href*="/pull/"]')) {
		let pathname: string
		try {
			pathname = new URL(link.href, 'https://github.com').pathname
		} catch {
			continue
		}
		const [, owner, repo, number] = PULL_PATH.exec(pathname) ?? []
		const item = link.closest('li') as Element
		const meta = owner && repo && number ? metaLine(item) : null
		if (!meta || !owner || !repo || rows.some((pull) => pull.meta === meta)) continue

		rows.push({ owner, repo, number: Number(number), isOpen: isOpenRow(item), meta })
	}

	return rows
}

const span = (text: string, className = '') => {
	const element = document.createElement('span')
	element.textContent = text
	if (className) element.className = className

	return element
}

// detent's elements trail the meta line in this order, behind the checks badge GitHub adds once it
// loads, so every row reads alike.
const TRAILING = [STATS_ATTRIBUTE, CONFLICTS_ATTRIBUTE]

function settle(meta: HTMLElement) {
	const trailing = TRAILING.flatMap(
		(attribute) => meta.querySelector<HTMLElement>(`:scope > [${attribute}]`) ?? [],
	)
	const tail = [...meta.children].slice(-trailing.length)
	if (trailing.some((element, index) => tail[index] !== element)) meta.append(...trailing)
}

/** Puts the stats at the end of the meta line, or updates the ones already there. */
export function renderStats(meta: HTMLElement, key: string, stats: DiffStats): void {
	const text = `${key}:${stats.additions}:${stats.deletions}:${stats.files}:${stats.code.additions}:${stats.code.deletions}:${JSON.stringify(stats.excluded)}`
	const existing = meta.querySelector<HTMLElement>(`:scope > [${STATS_ATTRIBUTE}]`)
	if (existing?.dataset.detentDiffStats === text) {
		settle(meta)
		return
	}

	const element = document.createElement('span')
	element.setAttribute(STATS_ATTRIBUTE, text)
	element.style.cssText = 'display:inline-flex;gap:4px;margin-left:4px;white-space:nowrap'
	element.append(
		span('·'),
		span(`+${formatCount(stats.additions)}`, 'fgColor-success'),
		span(`−${formatCount(stats.deletions)}`, 'fgColor-danger'),
		span('·'),
		span(formatFiles(stats.files)),
	)
	element.firstElementChild?.setAttribute('aria-hidden', 'true')
	element.children[3]?.setAttribute('aria-hidden', 'true')
	if (hasExcludedLines(stats)) element.append(...codePart(stats))
	if (existing) existing.replaceWith(element)
	else meta.append(element)
	settle(meta)
}

/** Marks a row whose branch conflicts with its base; there is no marker for a clean one. */
export function renderConflicts(meta: HTMLElement): void {
	const existing = meta.querySelector<HTMLElement>(`:scope > [${CONFLICTS_ATTRIBUTE}]`)
	if (existing) {
		settle(meta)
		return
	}

	const element = document.createElement('span')
	element.setAttribute(CONFLICTS_ATTRIBUTE, '')
	element.title = CONFLICTS_TITLE
	element.style.cssText = 'display:inline-flex;gap:4px;margin-left:4px;white-space:nowrap'
	element.append(span('·'), span('Conflicts', 'fgColor-danger'))
	element.firstElementChild?.setAttribute('aria-hidden', 'true')
	meta.append(element)
	settle(meta)
}

// What the pull request changes in code, next to the totals; its title says what was left out.
function codePart(stats: DiffStats): HTMLElement[] {
	const code = span('')
	code.title = codeTooltip(stats)
	code.style.cssText = 'display:inline-flex;gap:4px;font-weight:600'
	code.append(
		span('code'),
		span(`+${formatCount(stats.code.additions)}`, 'fgColor-success'),
		span(`−${formatCount(stats.code.deletions)}`, 'fgColor-danger'),
	)
	const separator = span('·')
	separator.setAttribute('aria-hidden', 'true')

	return [separator, code]
}

export function clearStats(meta: HTMLElement): void {
	meta.querySelector(`:scope > [${STATS_ATTRIBUTE}]`)?.remove()
}

export function clearConflicts(meta: HTMLElement): void {
	meta.querySelector(`:scope > [${CONFLICTS_ATTRIBUTE}]`)?.remove()
}

export function clearAllStats(root: ParentNode = document): void {
	for (const element of root.querySelectorAll(`[${STATS_ATTRIBUTE}], [${CONFLICTS_ATTRIBUTE}]`))
		element.remove()
}
