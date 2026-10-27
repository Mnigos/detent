// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { findPullRows, parsePullsListUrl, renderStats, STATS_ATTRIBUTE } from './rows'

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
})

describe('renderStats', () => {
	it('appends one stats element and updates it in place', () => {
		const meta = findPullRows()[0]?.meta as HTMLElement
		renderStats(meta, 'TanStack/router/8612', { additions: 1240, deletions: 318, files: 97 })
		renderStats(meta, 'TanStack/router/8612', { additions: 1240, deletions: 318, files: 97 })

		expect(meta.querySelectorAll(`[${STATS_ATTRIBUTE}]`)).toHaveLength(1)
		expect(meta.lastElementChild?.textContent).toBe('·+1 240−318·97 files')
		expect(meta.querySelector('.fgColor-success')?.textContent).toBe('+1 240')
		expect(meta.querySelector('.fgColor-danger')?.textContent).toBe('−318')

		renderStats(meta, 'TanStack/router/8612', { additions: 1, deletions: 0, files: 1 })
		expect(meta.querySelectorAll(`[${STATS_ATTRIBUTE}]`)).toHaveLength(1)
		expect(meta.lastElementChild?.textContent).toBe('·+1−0·1 file')
	})

	it('moves the stats behind content GitHub appends later', () => {
		const meta = findPullRows()[0]?.meta as HTMLElement
		const stats = { additions: 1, deletions: 1, files: 1 }
		renderStats(meta, 'TanStack/router/8612', stats)
		meta.append(document.createElement('span'))
		renderStats(meta, 'TanStack/router/8612', stats)

		expect(meta.lastElementChild?.hasAttribute(STATS_ATTRIBUTE)).toBe(true)
	})
})
