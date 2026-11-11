import type { ConflictState } from './conflicts'
import { codeTooltip, type DiffStats, formatCount, formatFiles, hasExcludedLines } from './stats'

export const STATS_ATTRIBUTE = 'data-detent-diff-stats'
export const CONFLICTS_ATTRIBUTE = 'data-detent-conflicts'
export const CONFLICTS_TITLE = 'This branch has conflicts with the base branch'
export const REBASE_BLOCKED_TITLE =
	'This branch can be merged, but not rebased onto its base without conflicts'
export const UNRESOLVED_ATTRIBUTE = 'data-detent-unresolved'
export const UNRESOLVED_TITLE = 'Resolve all comments before this can merge'

export type ConflictMarker = Extract<ConflictState, 'conflicts' | 'rebase-blocked'>

type Marker = { text: string; title: string; className: string }

// A merge conflict is red like GitHub's own; a blocked rebase only stops one merge method, so it takes the
// attention tone GitHub gives a branch that needs a rebase.
const MARKERS: Record<ConflictMarker, Marker> = {
	conflicts: { text: 'Conflicts', title: CONFLICTS_TITLE, className: 'fgColor-danger' },
	'rebase-blocked': {
		text: "Can't rebase",
		title: REBASE_BLOCKED_TITLE,
		className: 'fgColor-attention',
	},
}

// Unresolved conversations are for the author or reviewers to settle, not a broken branch, so the attention tone too.
const UNRESOLVED: Marker = {
	text: 'Unresolved comments',
	title: UNRESOLVED_TITLE,
	className: 'fgColor-attention',
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
const TRAILING = [STATS_ATTRIBUTE, CONFLICTS_ATTRIBUTE, UNRESOLVED_ATTRIBUTE]

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
	const separator = () => {
		const dot = span('·')
		dot.setAttribute('aria-hidden', 'true')

		return dot
	}
	element.append(
		separator(),
		span(`+${formatCount(stats.additions)}`, 'fgColor-success'),
		span(`−${formatCount(stats.deletions)}`, 'fgColor-danger'),
		...(hasExcludedLines(stats) ? [codePart(stats)] : []),
		separator(),
		span(formatFiles(stats.files)),
	)
	if (existing) existing.replaceWith(element)
	else meta.append(element)
	settle(meta)
}

/** Marks a row whose branch conflicts with its base, or cannot be rebased onto it; a clean one has no marker. */
export const renderConflicts = (meta: HTMLElement, state: ConflictMarker) =>
	renderMarker(meta, CONFLICTS_ATTRIBUTE, state, MARKERS[state])

/** Marks a row whose unresolved conversations block the merge, after any conflict marker. */
export const renderUnresolved = (meta: HTMLElement) =>
	renderMarker(meta, UNRESOLVED_ATTRIBUTE, 'required', UNRESOLVED)

function renderMarker(
	meta: HTMLElement,
	attribute: string,
	value: string,
	{ text, title, className }: Marker,
): void {
	const existing = meta.querySelector<HTMLElement>(`:scope > [${attribute}]`)
	if (existing?.getAttribute(attribute) === value) {
		settle(meta)
		return
	}

	const element = document.createElement('span')
	element.setAttribute(attribute, value)
	element.title = title
	element.style.cssText = 'display:inline-flex;gap:4px;margin-left:4px;white-space:nowrap'
	element.append(span('·'), span(text, className))
	element.firstElementChild?.setAttribute('aria-hidden', 'true')
	if (existing) existing.replaceWith(element)
	else meta.append(element)
	settle(meta)
}

/**
 * What the pull request changes in code, in parentheses after the totals and dimmed so the totals lead; its title says
 * what the numbers are and what was left out. `className` takes the typography of the totals it follows.
 */
export function codePart(stats: Pick<DiffStats, 'code' | 'excluded'>, className = ''): HTMLElement {
	const code = span('(', className)
	code.title = codeTooltip(stats)
	code.style.cssText = 'opacity:0.7'
	const deletions = span(`−${formatCount(stats.code.deletions)}`, 'fgColor-danger')
	deletions.style.marginLeft = '4px'
	code.append(span(`+${formatCount(stats.code.additions)}`, 'fgColor-success'), deletions, ')')

	return code
}

export function clearStats(meta: HTMLElement): void {
	meta.querySelector(`:scope > [${STATS_ATTRIBUTE}]`)?.remove()
}

export function clearConflicts(meta: HTMLElement): void {
	meta.querySelector(`:scope > [${CONFLICTS_ATTRIBUTE}]`)?.remove()
}

export function clearUnresolved(meta: HTMLElement): void {
	meta.querySelector(`:scope > [${UNRESOLVED_ATTRIBUTE}]`)?.remove()
}

export function clearAllStats(root: ParentNode = document): void {
	for (const element of root.querySelectorAll(TRAILING.map((name) => `[${name}]`).join(', ')))
		element.remove()
}
