import { HEADS_TTL_MILLISECONDS } from '../list/heads'
import { codePart } from '../list/rows'
import { type DiffStats, hasExcludedLines } from '../list/stats'
import { FILE_PART, LINES_SUMMARY } from '../panel/large-pull-request'
import { type PullRequestLocation, pullRequestScope } from '../pull-request-url'

export const HEADER_CODE_ATTRIBUTE = 'data-detent-header-code'

// The region a header diffstat belongs to: the React page header, or the classic tab bar. It holds the pull request's
// tab links, which tie the numbers to the pull request in the URL.
const HEADER_REGION = '[data-component="PageHeader"], .tabnav, header'
const SHA = /^[0-9a-f]{40}$/
const COLOR_CLASS = /^(fgColor|color-fg)-/
const MAX_DEPTH = 8

const pullPath = ({ owner, repo, number }: PullRequestLocation) =>
	`/${owner}/${repo}/pull/${number}`.toLowerCase()

const linkPath = (link: Element) => {
	try {
		return new URL(link.getAttribute('href') ?? '', 'https://github.com').pathname.toLowerCase()
	} catch {
		return ''
	}
}

// A header left on screen from the previous pull request after a soft navigation links that pull request's tabs, so
// it gets no marker.
function belongsTo(element: Element, location: PullRequestLocation) {
	const base = pullPath(location)
	const links = element.closest(HEADER_REGION)?.querySelectorAll('a[href*="/pull/"]') ?? []

	return [...links].some((link) => {
		const path = linkPath(link)

		return path === base || path.startsWith(`${base}/`)
	})
}

/**
 * GitHub's deletion count in the pull request header, which the code lines follow. The React header (Conversation,
 * Commits, Checks) puts `span.fgColor-danger` next to an `.sr-only` "Lines changed: N additions & M deletions"; the
 * classic Files changed page has `#diffstat > .color-fg-danger`. File headers on the Changes page state their own
 * lines changed and are skipped.
 */
export function findHeaderDeletions(
	location: PullRequestLocation,
	root: ParentNode = document,
): HTMLElement[] {
	const found: HTMLElement[] = []
	for (const diffstat of root.querySelectorAll('#diffstat')) {
		const deletions = diffstat.querySelector<HTMLElement>(':scope > .color-fg-danger')
		if (deletions && belongsTo(diffstat, location)) found.push(deletions)
	}
	for (const summary of root.querySelectorAll('.sr-only')) {
		if (!LINES_SUMMARY.test(summary.textContent ?? '') || summary.closest(FILE_PART)) continue

		const deletions = [...(summary.parentElement?.children ?? [])].find((child) =>
			child.matches('.fgColor-danger'),
		)
		if (deletions instanceof HTMLElement && belongsTo(summary, location)) found.push(deletions)
	}

	return found
}

const signature = (key: string, stats: DiffStats) =>
	`${key}:${stats.code.additions}:${stats.code.deletions}:${JSON.stringify(stats.excluded)}`

/**
 * Puts `(+c −e)` right after GitHub's totals, or leaves the one already there, and removes any other. Nothing is shown
 * without stats, or when nothing was excluded. Unchanged markup is not touched, so a mutation observer calling this
 * settles.
 */
export function renderHeaderCode(
	location: PullRequestLocation,
	key: string,
	stats: DiffStats | undefined,
	root: ParentNode = document,
): void {
	const keep = new Set<Element>()
	if (stats && hasExcludedLines(stats)) {
		const value = signature(key, stats)
		for (const deletions of findHeaderDeletions(location, root)) {
			const next = deletions.nextElementSibling
			if (next?.getAttribute(HEADER_CODE_ATTRIBUTE) === value) {
				keep.add(next)
				continue
			}

			// The totals' own typography (f6 text-bold in the React header), without their colour.
			const typography = [...deletions.classList].filter((name) => !COLOR_CLASS.test(name))
			const element = codePart(stats, typography.join(' '))
			element.setAttribute(HEADER_CODE_ATTRIBUTE, value)
			// The classic diffstat spaces its spans with text; the React one is a flex row with a gap.
			if (deletions.parentElement?.id === 'diffstat') element.style.marginLeft = '4px'
			deletions.after(element)
			keep.add(element)
		}
	}
	for (const element of root.querySelectorAll(`[${HEADER_CODE_ATTRIBUTE}]`))
		if (!keep.has(element)) element.remove()
}

export function clearHeaderCode(root: ParentNode = document): void {
	for (const element of root.querySelectorAll(`[${HEADER_CODE_ATTRIBUTE}]`)) element.remove()
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null

function findHead(value: unknown, number: number, depth = 0): string | undefined {
	if (depth > MAX_DEPTH || !isRecord(value)) return undefined
	if (value.number === number && typeof value.headSha === 'string' && SHA.test(value.headSha))
		return value.headSha

	for (const child of Object.values(value)) {
		const head = findHead(child, number, depth + 1)
		if (head) return head
	}

	return undefined
}

/** The URL the document was loaded at: embedded page data describes that page, not one reached by soft navigation. */
const documentUrl = () =>
	(performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined)
		?.name ?? window.location.href

/**
 * The pull request's head commit as the page states it, or undefined. The React pages embed it as `headSha` next to
 * the pull request's `number`; that data is as old as the document, so it is trusted only for a document loaded at
 * this pull request within the last ten minutes. The classic Files changed page names it as `end_commit_oid` in its
 * partial URLs, unless a commit range is shown.
 */
export function readHeadSha(
	location: PullRequestLocation,
	{
		root = document as ParentNode,
		url = window.location.href,
		loadedUrl = documentUrl(),
		loadedAt = performance.timeOrigin,
		now = Date.now(),
	} = {},
): string | undefined {
	const base = pullPath(location)
	if (location.tab === 'files' && new URL(url).pathname.toLowerCase() === `${base}/files`)
		for (const element of root.querySelectorAll('[data-url*="end_commit_oid="]')) {
			const target = new URL(element.getAttribute('data-url') ?? '', 'https://github.com')
			const head = target.searchParams.get('end_commit_oid') ?? ''
			if (target.pathname.toLowerCase().startsWith(`${base}/`) && SHA.test(head)) return head
		}

	let loaded: PullRequestLocation | undefined
	try {
		const { pathname } = new URL(loadedUrl)
		const [, owner, repo, number] = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/.exec(pathname) ?? []
		if (owner && repo && number) loaded = { owner, repo, number: Number(number), tab: location.tab }
	} catch {
		return undefined
	}
	if (!loaded || pullRequestScope(loaded) !== pullRequestScope(location)) return undefined
	if (now - loadedAt >= HEADS_TTL_MILLISECONDS) return undefined

	for (const script of root.querySelectorAll('script[data-target$=".embeddedData"]')) {
		try {
			const head = findHead(JSON.parse(script.textContent ?? ''), location.number)
			if (head) return head
		} catch {}
	}

	return undefined
}
