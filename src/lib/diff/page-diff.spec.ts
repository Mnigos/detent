import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readHeadSha } from '../header/header-dom'
import type { PullRequestLocation } from '../pull-request-url'
import { requestPullRequestDiff } from './fetch-diff'
import {
	forgetPageDiff,
	PAGE_DIFF_REUSE_MILLISECONDS,
	recentPageDiff,
	requestPageDiff,
} from './page-diff'

vi.mock('./fetch-diff', () => ({ requestPullRequestDiff: vi.fn() }))
vi.mock('../header/header-dom', () => ({ readHeadSha: vi.fn() }))

const location: PullRequestLocation = { owner: 'O', repo: 'r', number: 1, tab: 'files' }

beforeEach(() => {
	forgetPageDiff()
	vi.mocked(requestPullRequestDiff).mockReset()
	vi.mocked(readHeadSha).mockReset()
})

describe('page diff', () => {
	it('offers the diff while it loads and for a minute after, to the same pull request only', async () => {
		vi.mocked(requestPullRequestDiff).mockResolvedValue('diff')
		const promise = requestPageDiff(location)

		expect(recentPageDiff({ owner: 'o', repo: 'r', number: 1 }, undefined)).toBe(promise)
		expect(recentPageDiff({ owner: 'o', repo: 'r', number: 2 }, undefined)).toBeUndefined()
		await promise
		await Promise.resolve()
		expect(recentPageDiff(location, undefined)).toBe(promise)
		expect(
			recentPageDiff(location, undefined, Date.now() + PAGE_DIFF_REUSE_MILLISECONDS),
		).toBeUndefined()
	})

	it('is not offered for another head commit than the page showed when it was asked for', async () => {
		vi.mocked(readHeadSha).mockReturnValue('a'.repeat(40))
		vi.mocked(requestPullRequestDiff).mockResolvedValue('diff')
		const promise = requestPageDiff(location)

		expect(recentPageDiff(location, 'a'.repeat(40))).toBe(promise)
		expect(recentPageDiff(location, 'b'.repeat(40))).toBeUndefined()
		expect(recentPageDiff(location, undefined)).toBeUndefined()
	})

	it('forgets a download that failed', async () => {
		vi.mocked(requestPullRequestDiff).mockRejectedValue(new Error('404'))
		await requestPageDiff(location).catch(() => undefined)
		await Promise.resolve()

		expect(recentPageDiff(location, undefined)).toBeUndefined()
	})
})
