import { type DiffStats, formatCount, formatFiles } from './stats'

export const STATS_ATTRIBUTE = 'data-detent-diff-stats'

export interface PullsListLocation {
	owner: string
	repo: string
}

export interface PullRow {
	owner: string
	repo: string
	number: number
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
		const meta = owner && repo && number ? metaLine(link.closest('li') as Element) : null
		if (!meta || !owner || !repo || rows.some((row) => row.meta === meta)) continue

		rows.push({ owner, repo, number: Number(number), meta })
	}

	return rows
}

const span = (text: string, className = '') => {
	const element = document.createElement('span')
	element.textContent = text
	if (className) element.className = className

	return element
}

/** Puts the stats at the end of the meta line, or updates the ones already there. */
export function renderStats(meta: HTMLElement, key: string, stats: DiffStats): void {
	const text = `${key}:${stats.additions}:${stats.deletions}:${stats.files}`
	const existing = meta.querySelector<HTMLElement>(`:scope > [${STATS_ATTRIBUTE}]`)
	// GitHub adds the checks badge once it loads; the stats move behind it so every row reads alike.
	if (existing?.dataset.detentDiffStats === text) {
		if (existing !== meta.lastElementChild) meta.append(existing)
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
}

export function clearStats(meta: HTMLElement): void {
	meta.querySelector(`:scope > [${STATS_ATTRIBUTE}]`)?.remove()
}

export function clearAllStats(root: ParentNode = document): void {
	for (const element of root.querySelectorAll(`[${STATS_ATTRIBUTE}]`)) element.remove()
}
