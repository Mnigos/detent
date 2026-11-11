import type { ConflictState } from './conflicts'
import { type DiffStats, formatCount, formatFiles } from './stats'

export const STATS_ATTRIBUTE = 'data-detent-diff-stats'
export const CONFLICTS_ATTRIBUTE = 'data-detent-conflicts'
export const CONFLICTS_TITLE = 'This branch has conflicts with the base branch'
export const REBASE_BLOCKED_TITLE =
	'This branch can be merged, but not rebased onto its base without conflicts'

export type ConflictMarker = Extract<ConflictState, 'conflicts' | 'rebase-blocked'>

// A merge conflict is red like GitHub's own; a blocked rebase only stops one merge method, so it takes the
// attention tone GitHub gives a branch that needs a rebase.
const MARKERS: Record<ConflictMarker, { text: string; title: string; className: string }> = {
	conflicts: { text: 'Conflicts', title: CONFLICTS_TITLE, className: 'fgColor-danger' },
	'rebase-blocked': {
		text: "Can't rebase",
		title: REBASE_BLOCKED_TITLE,
		className: 'fgColor-attention',
	},
}

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
	/** A draft is not ready to merge, so its conflicts are not asked for. */
	isDraft: boolean
	/** The row's <li>. */
	item: Element
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

const isDraftRow = (row: Element) =>
	Boolean(row.querySelector('svg.octicon-git-pull-request-draft'))

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

		rows.push({
			owner,
			repo,
			number: Number(number),
			isOpen: isOpenRow(item),
			isDraft: isDraftRow(item),
			item,
			meta,
		})
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
	const text = `${key}:${stats.additions}:${stats.deletions}:${stats.files}`
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
	if (existing) existing.replaceWith(element)
	else meta.append(element)
	settle(meta)
}

/** Marks a row whose branch conflicts with its base, or cannot be rebased onto it; a clean one has no marker. */
export function renderConflicts(meta: HTMLElement, state: ConflictMarker): void {
	const existing = meta.querySelector<HTMLElement>(`:scope > [${CONFLICTS_ATTRIBUTE}]`)
	if (existing?.getAttribute(CONFLICTS_ATTRIBUTE) === state) {
		settle(meta)
		return
	}

	const { text, title, className } = MARKERS[state]
	const element = document.createElement('span')
	element.setAttribute(CONFLICTS_ATTRIBUTE, state)
	element.title = title
	element.style.cssText = 'display:inline-flex;gap:4px;margin-left:4px;white-space:nowrap'
	element.append(span('·'), span(text, className))
	element.firstElementChild?.setAttribute('aria-hidden', 'true')
	if (existing) existing.replaceWith(element)
	else meta.append(element)
	settle(meta)
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
