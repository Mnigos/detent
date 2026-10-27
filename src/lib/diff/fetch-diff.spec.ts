import { afterEach, describe, expect, it, vi } from 'vitest'
import { browser } from 'wxt/browser'
import {
	FETCH_DIFF_MESSAGE,
	fetchPullRequestDiff,
	PullRequestDiffError,
	requestPullRequestDiff,
} from './fetch-diff'

vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage: vi.fn() } } }))

const location = { owner: 'TanStack', repo: 'router', number: 8170 }

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('fetchPullRequestDiff', () => {
	it('requests the .diff endpoint with credentials and returns the text', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response('diff --git a/a b/a\n'))
		vi.stubGlobal('fetch', fetchMock)

		await expect(fetchPullRequestDiff(location)).resolves.toBe('diff --git a/a b/a\n')
		expect(fetchMock).toHaveBeenCalledWith('https://github.com/TanStack/router/pull/8170.diff', {
			credentials: 'include',
		})
	})

	it('throws a typed error carrying the status on a failed response', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })))

		await expect(fetchPullRequestDiff(location)).rejects.toThrow(PullRequestDiffError)
		await expect(fetchPullRequestDiff(location)).rejects.toMatchObject({ status: 404 })
	})

	it('retries a 5xx with backoff while GitHub generates a large diff and gives up after six tries', async () => {
		vi.useFakeTimers()
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response('', { status: 503 }))
			.mockResolvedValueOnce(new Response('diff --git a/a b/a\n'))
		vi.stubGlobal('fetch', fetchMock)
		const text = fetchPullRequestDiff(location)
		await vi.advanceTimersByTimeAsync(2000)
		await expect(text).resolves.toBe('diff --git a/a b/a\n')
		expect(fetchMock).toHaveBeenCalledTimes(2)

		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))
		const failed = fetchPullRequestDiff(location)
		const rejection = expect(failed).rejects.toMatchObject({ status: 503 })
		await vi.advanceTimersByTimeAsync(90_000)
		await rejection
		expect(fetch).toHaveBeenCalledTimes(6)
		vi.useRealTimers()
	})
})

describe('requestPullRequestDiff', () => {
	it('asks the service worker for the diff and returns its text', async () => {
		vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
			text: 'diff --git a/a b/a\n',
		} as never)

		await expect(requestPullRequestDiff(location)).resolves.toBe('diff --git a/a b/a\n')
		expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
			type: FETCH_DIFF_MESSAGE,
			...location,
		})
	})

	it('rethrows the status the service worker reports', async () => {
		vi.mocked(browser.runtime.sendMessage).mockResolvedValue({ status: 404 } as never)

		await expect(requestPullRequestDiff(location)).rejects.toMatchObject({ status: 404 })
	})

	it('treats a missing reply as an unknown failure', async () => {
		vi.mocked(browser.runtime.sendMessage).mockResolvedValue(undefined as never)

		await expect(requestPullRequestDiff(location)).rejects.toMatchObject({ status: 0 })
	})
})
