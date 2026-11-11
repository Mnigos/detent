// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
	classicHeader,
	embeddedData,
	fileHeader,
	reactHeader,
} from '@/src/test/pull-request-header'
import { CODE_TOOLTIP_HEADING, type DiffStats, formatCount } from '../list/stats'
import type { PullRequestLocation } from '../pull-request-url'
import {
	clearHeaderCode,
	findHeaderDeletions,
	HEADER_CODE_ATTRIBUTE,
	readHeadSha,
	renderHeaderCode,
} from './header-dom'

const location: PullRequestLocation = { owner: 'o', repo: 'r', number: 1, tab: 'conversation' }
const KEY = 'o/r/1'
const SHA = 'c'.repeat(40)

const stats = (code = { additions: 1202, deletions: 31 }): DiffStats => ({
	additions: 1719,
	deletions: 46,
	files: 12,
	code,
	excluded:
		code.additions === 1719 && code.deletions === 46
			? {}
			: { tests: { additions: 517, deletions: 15 } },
})

const markers = () => [...document.querySelectorAll<HTMLElement>(`[${HEADER_CODE_ATTRIBUTE}]`)]

beforeEach(() => {
	document.body.innerHTML = ''
})

describe('findHeaderDeletions', () => {
	it("finds the React header's deletions and the classic diffstat's, but not a file header's", () => {
		document.body.innerHTML = reactHeader() + classicHeader() + fileHeader()

		expect(findHeaderDeletions(location).map((element) => element.textContent?.trim())).toEqual([
			'−5,344',
			'-5,344',
		])
	})

	it('skips a header whose tabs belong to another pull request', () => {
		document.body.innerHTML = reactHeader('/o/r/pull/2') + classicHeader('/o/r/pull/2')

		expect(findHeaderDeletions(location)).toEqual([])
	})

	it('finds nothing on a page without a header diffstat', () => {
		document.body.innerHTML = '<main><span class="fgColor-danger">-3</span></main>'

		expect(findHeaderDeletions(location)).toEqual([])
	})
})

describe('renderHeaderCode', () => {
	it('puts (+c −e) right after the totals, dimmed, in their typography, with the list tooltip', () => {
		document.body.innerHTML = reactHeader()
		renderHeaderCode(location, KEY, stats())

		const [marker] = markers()
		expect(markers()).toHaveLength(1)
		expect(marker?.previousElementSibling?.textContent).toBe('-5,344')
		expect(marker?.textContent).toBe(`(+${formatCount(1202)}−31)`)
		expect(marker?.className).toBe('f6 text-bold')
		expect(marker?.style.opacity).toBe('0.7')
		expect(marker?.querySelector('.fgColor-success')?.textContent).toBe(`+${formatCount(1202)}`)
		expect(marker?.querySelector('.fgColor-danger')?.textContent).toBe('−31')
		expect(marker?.title).toBe(
			`${CODE_TOOLTIP_HEADING}\nExcluded: tests +517 −15.\nComment lines are detected approximately.`,
		)
	})

	it('spaces itself inside the classic diffstat and keeps its colour classes out of the selectors there', () => {
		document.body.innerHTML = classicHeader()
		renderHeaderCode({ ...location, tab: 'files' }, KEY, stats())

		const [marker] = markers()
		expect(marker?.previousElementSibling?.className).toBe('color-fg-danger')
		expect(marker?.style.marginLeft).toBe('4px')
		expect(document.querySelectorAll('#diffstat .color-fg-success')).toHaveLength(1)
	})

	it('is omitted when the code lines equal the totals', () => {
		document.body.innerHTML = reactHeader()
		renderHeaderCode(location, KEY, stats())
		renderHeaderCode(location, KEY, stats({ additions: 1719, deletions: 46 }))

		expect(markers()).toEqual([])
	})

	it('is omitted without stats', () => {
		document.body.innerHTML = reactHeader()
		renderHeaderCode(location, KEY, undefined)

		expect(markers()).toEqual([])
	})

	it('leaves the marker in place on a repeated render, so an observer settles', () => {
		document.body.innerHTML = reactHeader()
		renderHeaderCode(location, KEY, stats())
		const [first] = markers()
		renderHeaderCode(location, KEY, stats())
		renderHeaderCode(location, KEY, stats())

		expect(markers()).toEqual([first])
	})

	it('puts exactly one marker back after React re-renders the header', () => {
		document.body.innerHTML = reactHeader()
		renderHeaderCode(location, KEY, stats())
		const header = document.querySelector('header') as HTMLElement
		header.outerHTML = reactHeader()
		renderHeaderCode(location, KEY, stats())

		expect(markers()).toHaveLength(1)
		expect(markers()[0]?.isConnected).toBe(true)
	})

	it('replaces a marker whose counts changed, and drops a stray one away from the totals', () => {
		document.body.innerHTML = reactHeader()
		renderHeaderCode(location, KEY, stats())
		document.body.append(markers()[0]?.cloneNode(true) as Node)
		renderHeaderCode(location, KEY, stats({ additions: 5, deletions: 2 }))

		expect(markers().map((marker) => marker.textContent)).toEqual(['(+5−2)'])
	})

	it('clears every marker', () => {
		document.body.innerHTML = reactHeader() + classicHeader()
		renderHeaderCode(location, KEY, stats())
		expect(markers()).toHaveLength(2)
		clearHeaderCode()

		expect(markers()).toEqual([])
	})
})

describe('readHeadSha', () => {
	const now = 1_000_000_000

	it('reads the embedded head commit of a document loaded at this pull request', () => {
		document.body.innerHTML = embeddedData(1, SHA)

		expect(
			readHeadSha(location, {
				url: 'https://github.com/o/r/pull/1',
				loadedUrl: 'https://github.com/o/r/pull/1/commits',
				loadedAt: now - 1000,
				now,
			}),
		).toBe(SHA)
	})

	it('ignores embedded data of another pull request, or older than ten minutes', () => {
		document.body.innerHTML = embeddedData(1, SHA)
		const read = (loadedUrl: string, loadedAt: number) =>
			readHeadSha(location, { url: 'https://github.com/o/r/pull/1', loadedUrl, loadedAt, now })

		expect(read('https://github.com/o/r/pulls', now - 1000)).toBeUndefined()
		expect(read('https://github.com/o/r/pull/2', now - 1000)).toBeUndefined()
		expect(read('https://github.com/o/r/pull/1', now - 10 * 60 * 1000)).toBeUndefined()
		document.body.innerHTML = embeddedData(2, SHA)
		expect(read('https://github.com/o/r/pull/1', now - 1000)).toBeUndefined()
	})

	it("reads the classic Files changed page's end commit, but not on a commit range", () => {
		document.body.innerHTML = classicHeader('/o/r/pull/1', SHA)
		const files = { ...location, tab: 'files' as const }
		const options = { loadedUrl: 'https://github.com/o/r/pulls', loadedAt: now, now }

		expect(readHeadSha(files, { ...options, url: 'https://github.com/o/r/pull/1/files' })).toBe(SHA)
		expect(
			readHeadSha(files, { ...options, url: 'https://github.com/o/r/pull/1/files/abc..def' }),
		).toBeUndefined()
		document.body.innerHTML = classicHeader('/o/r/pull/2', SHA)
		expect(
			readHeadSha(files, { ...options, url: 'https://github.com/o/r/pull/1/files' }),
		).toBeUndefined()
	})
})
