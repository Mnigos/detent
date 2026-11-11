// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
	CONFLICTS_ATTRIBUTE,
	CONFLICTS_TITLE,
	clearAllStats,
	clearConflicts,
	clearUnresolved,
	findPullRows,
	parsePullsListUrl,
	REBASE_BLOCKED_TITLE,
	renderConflicts,
	renderStats,
	renderUnresolved,
	STATS_ATTRIBUTE,
	UNRESOLVED_ATTRIBUTE,
	UNRESOLVED_TITLE,
} from './rows'
import { CODE_TOOLTIP_HEADING, type DiffStats } from './stats'

// Totals whose code counts match, so the row has no code part.
const plain = (additions: number, deletions: number, files: number): DiffStats => ({
	additions,
	deletions,
	files,
	code: { additions, deletions },
	excluded: {},
})

const FIXTURE = readFileSync(resolve(process.cwd(), 'fixtures/github-pulls-list.html'), 'utf8')

beforeEach(() => {
	document.documentElement.innerHTML = FIXTURE
})

describe('parsePullsListUrl', () => {
	it('matches a repository pull request list with or without a query', () => {
		expect(parsePullsListUrl('https://github.com/vercel/next.js/pulls')).toEqual({
			owner: 'vercel',
			repo: 'next.js',
		})
		expect(parsePullsListUrl('https://github.com/o/r/pulls?q=is%3Apr+is%3Aclosed')).toBeDefined()
	})

	it('ignores other pages', () => {
		expect(parsePullsListUrl('https://github.com/pulls')).toBeUndefined()
		expect(parsePullsListUrl('https://github.com/o/r/pull/1')).toBeUndefined()
		expect(parsePullsListUrl('https://example.com/o/r/pulls')).toBeUndefined()
	})
})

describe('findPullRows', () => {
	it('finds the row of the fixture with its meta line', () => {
		const rows = findPullRows()

		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ owner: 'TanStack', repo: 'router', number: 8612 })
		expect(rows[0]?.meta.textContent).toContain('#8612')
	})

	it('reads open and draft rows as open, closed and merged ones as not', () => {
		const icon = document.querySelector('svg.octicon') as SVGElement
		expect(findPullRows()[0]?.isOpen).toBe(true)

		for (const [name, isOpen] of [
			['octicon-git-pull-request', true],
			['octicon-git-pull-request-closed', false],
			['octicon-git-merge', false],
		] as const) {
			icon.setAttribute('class', `octicon ${name}`)
			expect(findPullRows()[0]?.isOpen).toBe(isOpen)
		}
	})

	it('marks only a draft row as a draft, and keeps its <li>', () => {
		const icon = document.querySelector('svg.octicon') as SVGElement
		icon.setAttribute('class', 'octicon octicon-git-pull-request')
		expect(findPullRows()[0]?.isDraft).toBe(false)
		expect(findPullRows()[0]?.item).toBe(document.querySelector('li'))

		icon.setAttribute('class', 'octicon octicon-git-pull-request-draft')
		expect(findPullRows()[0]).toMatchObject({ isOpen: true, isDraft: true })
	})
})

describe('renderStats', () => {
	it('appends one stats element and updates it in place', () => {
		const meta = findPullRows()[0]?.meta as HTMLElement
		renderStats(meta, 'TanStack/router/8612', plain(1240, 318, 97))
		renderStats(meta, 'TanStack/router/8612', plain(1240, 318, 97))

		expect(meta.querySelectorAll(`[${STATS_ATTRIBUTE}]`)).toHaveLength(1)
		expect(meta.lastElementChild?.textContent).toBe('·+1 240−318·97 files')
		expect(meta.querySelector('.fgColor-success')?.textContent).toBe('+1 240')
		expect(meta.querySelector('.fgColor-danger')?.textContent).toBe('−318')

		renderStats(meta, 'TanStack/router/8612', plain(1, 0, 1))
		expect(meta.querySelectorAll(`[${STATS_ATTRIBUTE}]`)).toHaveLength(1)
		expect(meta.lastElementChild?.textContent).toBe('·+1−0·1 file')
	})

	it('moves the stats behind content GitHub appends later', () => {
		const meta = findPullRows()[0]?.meta as HTMLElement
		const stats = plain(1, 1, 1)
		renderStats(meta, 'TanStack/router/8612', stats)
		meta.append(document.createElement('span'))
		renderStats(meta, 'TanStack/router/8612', stats)

		expect(meta.lastElementChild?.hasAttribute(STATS_ATTRIBUTE)).toBe(true)
	})

	it('adds the code counts with what was left out in their title when they differ', () => {
		const meta = findPullRows()[0]?.meta as HTMLElement
		renderStats(meta, 'TanStack/router/8612', {
			...plain(1717, 67, 30),
			code: { additions: 312, deletions: 41 },
			excluded: {
				tests: { additions: 1380, deletions: 10 },
				blank: { additions: 25, deletions: 16 },
			},
		})

		const element = meta.lastElementChild as HTMLElement
		expect(element.textContent).toBe('·+1 717−67(+312−41)·30 files')
		const code = element.querySelector('[title]') as HTMLElement
		expect(code.textContent).toBe('(+312−41)')
		expect(code.title).toBe(
			`${CODE_TOOLTIP_HEADING}\n` +
				'Excluded: tests +1 380 −10, blank and comment lines +25 −16.\n' +
				'Comment lines are detected approximately.',
		)
		expect(code.querySelector('.fgColor-success')?.textContent).toBe('+312')
		expect(code.querySelector('.fgColor-danger')?.textContent).toBe('−41')
		expect(code.style.opacity).toBe('0.7')
		expect(code.previousElementSibling?.textContent).toBe('−67')
		expect(code.nextElementSibling?.getAttribute('aria-hidden')).toBe('true')

		renderStats(meta, 'TanStack/router/8612', plain(1717, 67, 30))
		expect(meta.lastElementChild?.textContent).toBe('·+1 717−67·30 files')
		expect(meta.querySelector(`[${STATS_ATTRIBUTE}] [title]`)).toBeNull()
	})

	it('shows zero code counts for a pull request without code', () => {
		const meta = findPullRows()[0]?.meta as HTMLElement
		const stats = {
			...plain(40, 2, 3),
			code: { additions: 0, deletions: 0 },
			excluded: { docs: { additions: 40, deletions: 2 } },
		}
		renderStats(meta, 'TanStack/router/8612', stats)
		const element = meta.lastElementChild as HTMLElement
		renderStats(meta, 'TanStack/router/8612', stats)

		expect(meta.lastElementChild).toBe(element)
		expect(element.textContent).toBe('·+40−2(+0−0)·3 files')
	})

	it('updates the title when only what was left out changes', () => {
		const meta = findPullRows()[0]?.meta as HTMLElement
		const stats = { ...plain(20, 0, 2), code: { additions: 10, deletions: 0 } }
		renderStats(meta, 'TanStack/router/8612', {
			...stats,
			excluded: { tests: { additions: 10, deletions: 0 } },
		})
		renderStats(meta, 'TanStack/router/8612', {
			...stats,
			excluded: { docs: { additions: 10, deletions: 0 } },
		})

		expect(meta.querySelector(`[${STATS_ATTRIBUTE}] [title]`)?.getAttribute('title')).toMatch(
			/\nExcluded: docs \+10\./,
		)
	})
})

describe('renderConflicts', () => {
	const meta = () => findPullRows()[0]?.meta as HTMLElement
	const stats = plain(1, 1, 1)

	it('appends one red marker with the conflict explained in its title', () => {
		renderConflicts(meta(), 'conflicts')
		renderConflicts(meta(), 'conflicts')

		const markers = meta().querySelectorAll<HTMLElement>(`[${CONFLICTS_ATTRIBUTE}]`)
		expect(markers).toHaveLength(1)
		expect(markers[0]?.title).toBe(CONFLICTS_TITLE)
		expect(markers[0]?.textContent).toBe('·Conflicts')
		expect(markers[0]?.querySelector('.fgColor-danger')?.textContent).toBe('Conflicts')
	})

	it('marks a blocked rebase in the attention tone, and swaps one marker for the other', () => {
		renderConflicts(meta(), 'rebase-blocked')
		renderConflicts(meta(), 'rebase-blocked')

		let markers = meta().querySelectorAll<HTMLElement>(`[${CONFLICTS_ATTRIBUTE}]`)
		expect(markers).toHaveLength(1)
		expect(markers[0]?.getAttribute(CONFLICTS_ATTRIBUTE)).toBe('rebase-blocked')
		expect(markers[0]?.title).toBe(REBASE_BLOCKED_TITLE)
		expect(markers[0]?.textContent).toBe("·Can't rebase")
		expect(markers[0]?.querySelector('.fgColor-attention')?.textContent).toBe("Can't rebase")
		expect(markers[0]?.querySelector('.fgColor-danger')).toBeNull()

		renderConflicts(meta(), 'conflicts')
		markers = meta().querySelectorAll<HTMLElement>(`[${CONFLICTS_ATTRIBUTE}]`)
		expect(markers).toHaveLength(1)
		expect(markers[0]?.getAttribute(CONFLICTS_ATTRIBUTE)).toBe('conflicts')
		expect(markers[0]?.title).toBe(CONFLICTS_TITLE)
		expect(markers[0]?.textContent).toBe('·Conflicts')
		expect(meta().lastElementChild).toBe(markers[0])
	})

	it('keeps the stats before the marker and both behind content GitHub appends later', () => {
		renderConflicts(meta(), 'conflicts')
		renderStats(meta(), 'TanStack/router/8612', stats)
		expect(meta().lastElementChild?.hasAttribute(CONFLICTS_ATTRIBUTE)).toBe(true)
		expect(meta().lastElementChild?.previousElementSibling?.hasAttribute(STATS_ATTRIBUTE)).toBe(
			true,
		)

		const badge = document.createElement('span')
		meta().append(badge)
		renderStats(meta(), 'TanStack/router/8612', stats)
		renderConflicts(meta(), 'conflicts')
		expect([...meta().children].slice(-3)).toEqual([
			badge,
			meta().querySelector(`[${STATS_ATTRIBUTE}]`),
			meta().querySelector(`[${CONFLICTS_ATTRIBUTE}]`),
		])
	})

	it('settles: a second pass over a placed row changes nothing', () => {
		renderStats(meta(), 'TanStack/router/8612', stats)
		renderConflicts(meta(), 'conflicts')
		const before = meta().innerHTML
		const observer = new MutationObserver(() => undefined)
		observer.observe(meta(), { childList: true, subtree: true })
		renderStats(meta(), 'TanStack/router/8612', stats)
		renderConflicts(meta(), 'conflicts')

		expect(observer.takeRecords()).toHaveLength(0)
		expect(meta().innerHTML).toBe(before)
		observer.disconnect()
	})

	it('is removed by clearConflicts and clearAllStats', () => {
		renderConflicts(meta(), 'conflicts')
		clearConflicts(meta())
		expect(meta().querySelector(`[${CONFLICTS_ATTRIBUTE}]`)).toBeNull()

		renderConflicts(meta(), 'conflicts')
		renderStats(meta(), 'TanStack/router/8612', stats)
		clearAllStats()
		expect(document.querySelector(`[${CONFLICTS_ATTRIBUTE}], [${STATS_ATTRIBUTE}]`)).toBeNull()
	})
})

describe('renderUnresolved', () => {
	const meta = () => findPullRows()[0]?.meta as HTMLElement

	it('appends one marker in the attention tone with what to do in its title', () => {
		renderUnresolved(meta())
		renderUnresolved(meta())

		const markers = meta().querySelectorAll<HTMLElement>(`[${UNRESOLVED_ATTRIBUTE}]`)
		expect(markers).toHaveLength(1)
		expect(markers[0]?.title).toBe(UNRESOLVED_TITLE)
		expect(markers[0]?.textContent).toBe('·Unresolved comments')
		expect(markers[0]?.querySelector('.fgColor-attention')?.textContent).toBe('Unresolved comments')
	})

	it('trails the stats and the conflict marker, behind content GitHub appends later', () => {
		renderUnresolved(meta())
		renderConflicts(meta(), 'conflicts')
		renderStats(meta(), 'TanStack/router/8612', plain(1, 1, 1))
		const badge = document.createElement('span')
		meta().append(badge)
		renderConflicts(meta(), 'conflicts')

		expect([...meta().children].slice(-4)).toEqual([
			badge,
			meta().querySelector(`[${STATS_ATTRIBUTE}]`),
			meta().querySelector(`[${CONFLICTS_ATTRIBUTE}]`),
			meta().querySelector(`[${UNRESOLVED_ATTRIBUTE}]`),
		])
	})

	it('is removed by clearUnresolved and clearAllStats, and leaves the conflict marker alone', () => {
		renderConflicts(meta(), 'rebase-blocked')
		renderUnresolved(meta())
		clearUnresolved(meta())
		expect(meta().querySelector(`[${UNRESOLVED_ATTRIBUTE}]`)).toBeNull()
		expect(meta().querySelector(`[${CONFLICTS_ATTRIBUTE}]`)).not.toBeNull()

		renderUnresolved(meta())
		clearAllStats()
		expect(meta().querySelector(`[${UNRESOLVED_ATTRIBUTE}]`)).toBeNull()
		expect(meta().querySelector(`[${CONFLICTS_ATTRIBUTE}]`)).toBeNull()
	})
})
