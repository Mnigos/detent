import { browser } from 'wxt/browser'
import { type PullRequestLocation, pullRequestScope } from '../pull-request-url'

/** Above either limit detent waits for a click before it fetches, parses and groups the diff. */
export const LARGE_PULL_REQUEST = { files: 300, lines: 20_000 }

export interface PullRequestSize {
	files: number
	lines?: number
}

const COUNTER = '.Counter, [class*="Counter"], [data-component="counter"]'
const VIEWED_SUMMARY = '[class*="ViewedFileProgress-module__ProgressContainer"] + .sr-only'
const VIEWED_TOTAL = /^\s*\d[\d,]* of (\d[\d,]*) files? viewed\s*$/
const LINES_SUMMARY = /^\s*Lines changed: (\d[\d,]*) additions? & (\d[\d,]*) deletions?\s*$/
// Each file header on the Changes page states its own lines changed; only the pull request's count.
const FILE_PART =
	'[data-diff-header-wrapper], [role="region"][id^="diff-"], [role="tree"], .js-file'
const SIZE_POLL_MILLISECONDS = 200
const SIZE_WAIT_MILLISECONDS = 5000

function parseCount(text: string | null | undefined): number | undefined {
	const match = /(\d[\d,]*(?:\.\d+)?)\s*(k)?/i.exec(text ?? '')
	if (!match?.[1]) return undefined

	return Math.round(Number(match[1].replaceAll(',', '')) * (match[2] ? 1000 : 1))
}

// The tab link names its pull request, so a counter left over from the previous page never counts.
function findFilesTab({ owner, repo, number }: PullRequestLocation, root: ParentNode) {
	const base = `/${owner}/${repo}/pull/${number}`.toLowerCase()
	const tabs = [`${base}/files`, `${base}/changes`]

	return [...root.querySelectorAll<HTMLAnchorElement>('a[href*="/pull/"]')].find((link) => {
		const { pathname } = new URL(link.getAttribute('href') ?? '', 'https://github.com')

		return tabs.includes(pathname.toLowerCase()) && link.querySelector(COUNTER)
	})
}

function readLines(root: ParentNode, tab: Element | undefined) {
	const diffstat = (tab?.closest('.tabnav') ?? root).querySelector('#diffstat')
	if (diffstat) {
		const additions = parseCount(diffstat.querySelector('.color-fg-success')?.textContent)
		const deletions = parseCount(diffstat.querySelector('.color-fg-danger')?.textContent)
		if (additions !== undefined || deletions !== undefined)
			return (additions ?? 0) + (deletions ?? 0)
	}
	for (const element of root.querySelectorAll('.sr-only')) {
		const match = LINES_SUMMARY.exec(element.textContent ?? '')
		if (match && !element.closest(FILE_PART))
			return (parseCount(match[1]) ?? 0) + (parseCount(match[2]) ?? 0)
	}

	return undefined
}

/** The size GitHub already shows on the page; undefined until the page has rendered it. */
export function readPullRequestSize(
	location: PullRequestLocation,
	root: ParentNode = document,
): PullRequestSize | undefined {
	const tab = findFilesTab(location, root)
	const counter = tab?.querySelector(COUNTER)
	const viewed = VIEWED_TOTAL.exec(root.querySelector(VIEWED_SUMMARY)?.textContent ?? '')?.[1]
	const files =
		parseCount(counter?.getAttribute('title') || counter?.textContent) ?? parseCount(viewed)
	if (files === undefined) return undefined

	const lines = readLines(root, tab)

	return lines === undefined ? { files } : { files, lines }
}

// A size the page does not show is treated as large: the click costs less than a frozen page.
export const isLargePullRequest = (size: PullRequestSize | undefined) =>
	!size || size.files > LARGE_PULL_REQUEST.files || (size.lines ?? 0) > LARGE_PULL_REQUEST.lines

export function largePullRequestText(size: PullRequestSize | undefined): string {
	if (!size) return 'Group this pull request with detent'
	if (size.files > LARGE_PULL_REQUEST.files)
		return `Large pull request (${size.files.toLocaleString('en-US')} files). Group with detent`

	return `Large pull request (${(size.lines ?? 0).toLocaleString('en-US')} lines). Group with detent`
}

// The Changes page renders its counters after the script starts; the wait polls instead of
// observing the whole document, and gives up when the reviewer has moved on.
export async function waitForPullRequestSize(
	location: PullRequestLocation,
	isActive: () => boolean,
	timeout = SIZE_WAIT_MILLISECONDS,
): Promise<PullRequestSize | undefined> {
	const deadline = Date.now() + timeout
	let size = readPullRequestSize(location)
	while (!size && isActive() && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, SIZE_POLL_MILLISECONDS))
		size = readPullRequestSize(location)
	}

	return size
}

const consentKey = (location: PullRequestLocation) => `large:${pullRequestScope(location)}`

export async function hasGroupingConsent(location: PullRequestLocation): Promise<boolean> {
	const key = consentKey(location)
	try {
		const stored = await browser.storage.session.get(key)

		return stored[key] === true
	} catch {
		return false
	}
}

export async function saveGroupingConsent(location: PullRequestLocation): Promise<void> {
	await browser.storage.session.set({ [consentKey(location)]: true }).catch(() => undefined)
}

/** The button text when the reviewer must ask for grouping first; undefined when detent may start. */
export async function largePullRequestGate(
	location: PullRequestLocation,
	isActive: () => boolean,
): Promise<string | undefined> {
	if (await hasGroupingConsent(location)) return undefined

	const size = await waitForPullRequestSize(location, isActive)

	return isLargePullRequest(size) ? largePullRequestText(size) : undefined
}
