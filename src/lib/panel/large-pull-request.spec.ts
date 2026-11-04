// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { browser } from 'wxt/browser'
import type { PullRequestLocation } from '../pull-request-url'
import {
	hasGroupingConsent,
	isLargePullRequest,
	LARGE_PULL_REQUEST,
	largePullRequestGate,
	largePullRequestText,
	readPullRequestSize,
	saveGroupingConsent,
	waitForPullRequestSize,
} from './large-pull-request'

const SESSION_GET = vi.hoisted(() => vi.fn<() => Promise<Record<string, unknown>>>())

vi.mock('wxt/browser', () => ({
	browser: { storage: { session: { get: SESSION_GET, set: vi.fn() } } },
}))

const fixture = (name: string) => readFileSync(resolve(process.cwd(), `fixtures/${name}`), 'utf8')
const CLASSIC: PullRequestLocation = {
	owner: 'TanStack',
	repo: 'router',
	number: 8658,
	tab: 'files',
}
const CHANGES: PullRequestLocation = { owner: 'example', repo: 'shop', number: 7, tab: 'changes' }

beforeEach(() => {
	vi.resetAllMocks()
	SESSION_GET.mockResolvedValue({})
	vi.mocked(browser.storage.session.set).mockResolvedValue(undefined)
	document.body.innerHTML = ''
})
afterEach(() => {
	vi.useRealTimers()
})

describe('readPullRequestSize', () => {
	it('reads the file counter and the diffstat of the classic Files changed page', () => {
		document.body.innerHTML = fixture('github-files-header.html')

		expect(readPullRequestSize(CLASSIC)).toEqual({ files: 570, lines: 5792 + 5344 })
	})

	it('ignores a counter that belongs to another pull request', () => {
		document.body.innerHTML = fixture('github-files-header.html')

		expect(readPullRequestSize({ ...CLASSIC, number: 1 })).toBeUndefined()
	})

	it('reads the file total from the viewed progress of the Changes page, not from file headers', () => {
		document.body.innerHTML = fixture('github-changes-tree.html')

		expect(readPullRequestSize(CHANGES)).toEqual({ files: 39 })
	})

	it('reads a counter on a /changes tab link and the pull request level lines summary', () => {
		document.body.innerHTML = `
			<nav><a href="/example/shop/pull/7/changes">Files changed <span data-component="counter">1.2k</span></a></nav>
			<span class="sr-only">Lines changed: 12,000 additions &amp; 4,000 deletions</span>
			<div data-diff-header-wrapper><span class="sr-only">Lines changed: 5 additions &amp; 0 deletions</span></div>`

		expect(readPullRequestSize(CHANGES)).toEqual({ files: 1200, lines: 16_000 })
	})

	it('has no size before the page shows one', () => {
		expect(readPullRequestSize(CLASSIC)).toBeUndefined()
	})
})

describe('isLargePullRequest', () => {
	it.each([
		[{ files: LARGE_PULL_REQUEST.files }, false],
		[{ files: LARGE_PULL_REQUEST.files + 1 }, true],
		[{ files: 2, lines: LARGE_PULL_REQUEST.lines }, false],
		[{ files: 2, lines: LARGE_PULL_REQUEST.lines + 1 }, true],
		[undefined, true],
	])('treats %j as large: %s', (size, expected) => {
		expect(isLargePullRequest(size)).toBe(expected)
	})
})

describe('largePullRequestText', () => {
	it('names the limit the pull request is over', () => {
		expect(largePullRequestText({ files: 570, lines: 11_136 })).toBe(
			'Large pull request (570 files). Group with detent',
		)
		expect(largePullRequestText({ files: 3, lines: 25_000 })).toBe(
			'Large pull request (25,000 lines). Group with detent',
		)
		expect(largePullRequestText(undefined)).toBe('Group this pull request with detent')
	})
})

describe('waitForPullRequestSize', () => {
	it('returns the size once the page renders it', async () => {
		vi.useFakeTimers()
		const waiting = waitForPullRequestSize(CLASSIC, () => true)
		await vi.advanceTimersByTimeAsync(400)
		document.body.innerHTML = fixture('github-files-header.html')
		await vi.advanceTimersByTimeAsync(200)

		await expect(waiting).resolves.toEqual({ files: 570, lines: 11_136 })
	})

	it('gives up at the deadline or when the reviewer navigates away', async () => {
		vi.useFakeTimers()
		const timedOut = waitForPullRequestSize(CLASSIC, () => true, 1000)
		await vi.advanceTimersByTimeAsync(1200)
		await expect(timedOut).resolves.toBeUndefined()

		let isActive = true
		const abandoned = waitForPullRequestSize(CLASSIC, () => isActive, 60_000)
		isActive = false
		await vi.advanceTimersByTimeAsync(200)
		await expect(abandoned).resolves.toBeUndefined()
	})
})

describe('grouping consent', () => {
	it('remembers the click per pull request in session storage', async () => {
		expect(await hasGroupingConsent(CLASSIC)).toBe(false)

		await saveGroupingConsent(CLASSIC)
		expect(browser.storage.session.set).toHaveBeenCalledWith({ 'large:tanstack/router/8658': true })

		SESSION_GET.mockResolvedValue({ 'large:tanstack/router/8658': true })
		expect(await hasGroupingConsent(CLASSIC)).toBe(true)
	})

	it('treats unreadable session storage as no consent', async () => {
		SESSION_GET.mockRejectedValue(new Error('access denied'))

		expect(await hasGroupingConsent(CLASSIC)).toBe(false)
	})
})

describe('largePullRequestGate', () => {
	it('asks for a click on a large pull request until the reviewer has clicked once', async () => {
		document.body.innerHTML = fixture('github-files-header.html')
		expect(await largePullRequestGate(CLASSIC, () => true)).toBe(
			'Large pull request (570 files). Group with detent',
		)

		SESSION_GET.mockResolvedValue({ 'large:tanstack/router/8658': true })
		expect(await largePullRequestGate(CLASSIC, () => true)).toBeUndefined()
	})

	it('lets a small pull request start at once', async () => {
		document.body.innerHTML = fixture('github-changes-tree.html')

		expect(await largePullRequestGate(CHANGES, () => true)).toBeUndefined()
	})
})
