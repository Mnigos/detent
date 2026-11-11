import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PullRequestLocation } from '../pull-request-url'
import { requestPullRequestDiff } from './fetch-diff'
import {
	forgetPageDiff,
	PAGE_DIFF_REUSE_MILLISECONDS,
	recentPageDiff,
	requestPageDiff,
} from './page-diff'

vi.mock('./fetch-diff', () => ({ requestPullRequestDiff: vi.fn() }))

const location: PullRequestLocation = { owner: 'O', repo: 'r', number: 1, tab: 'files' }

beforeEach(() => {
	forgetPageDiff()
	vi.mocked(requestPullRequestDiff).mockReset()
})

describe('page diff', () => {
	it('offers the diff while it loads and for a minute after, to the same pull request only', async () => {
		vi.mocked(requestPullRequestDiff).mockResolvedValue('diff')
		const promise = requestPageDiff(location)

		expect(recentPageDiff({ owner: 'o', repo: 'r', number: 1 })).toBe(promise)
		expect(recentPageDiff({ owner: 'o', repo: 'r', number: 2 })).toBeUndefined()
		await promise
		await Promise.resolve()
		expect(recentPageDiff(location)).toBe(promise)
		expect(recentPageDiff(location, Date.now() + PAGE_DIFF_REUSE_MILLISECONDS)).toBeUndefined()
	})

	it('forgets a download that failed', async () => {
		vi.mocked(requestPullRequestDiff).mockRejectedValue(new Error('404'))
		await requestPageDiff(location).catch(() => undefined)
		await Promise.resolve()

		expect(recentPageDiff(location)).toBeUndefined()
	})
})
