import { afterEach, describe, expect, it, vi } from 'vitest'
import { browser } from 'wxt/browser'
import { RequestPausedError } from '../rate-limit'
import {
	FETCH_DIFF_MESSAGE,
	fetchPullRequestDiff,
	PullRequestDiffError,
	requestPullRequestDiff,
} from './fetch-diff'

vi.mock('wxt/browser', () => ({
	browser: {
		runtime: { sendMessage: vi.fn() },
		storage: { local: { get: vi.fn(async () => ({})) } },
	},
}))

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

	it('does not retry a rate limit and reports it with Retry-After', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '120' } }))
		vi.stubGlobal('fetch', fetchMock)

		const error = await fetchPullRequestDiff(location).catch((error: unknown) => error)
		expect(error).toBeInstanceOf(PullRequestDiffError)
		expect(error).toMatchObject({ status: 429, rateLimit: { retryAfterMilliseconds: 120_000 } })
		expect(fetchMock).toHaveBeenCalledOnce()

		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })))
		await expect(fetchPullRequestDiff(location)).rejects.toMatchObject({ rateLimit: undefined })
	})

	it('reports a retry the list queue held back for a pause as paused, with the last status', async () => {
		vi.useFakeTimers()
		const send = vi
			.fn<(url: string, init?: RequestInit) => Promise<Response>>()
			.mockResolvedValueOnce(new Response('', { status: 503 }))
			.mockRejectedValueOnce(new RequestPausedError())
		const fetchMock = vi.fn()
		vi.stubGlobal('fetch', fetchMock)
		const failed = fetchPullRequestDiff(location, send)
		const rejection = expect(failed).rejects.toMatchObject({
			status: 503,
			rateLimit: undefined,
			isPaused: true,
		})
		await vi.advanceTimersByTimeAsync(2000)
		await rejection
		expect(send).toHaveBeenCalledTimes(2)
		expect(fetchMock).not.toHaveBeenCalled()
		vi.useRealTimers()
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

	it('marks a list request and rethrows a retry the pause held back', async () => {
		vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
			status: 503,
			isPaused: true,
		} as never)

		await expect(requestPullRequestDiff(location, { isList: true })).rejects.toMatchObject({
			status: 503,
			isPaused: true,
		})
		expect(browser.runtime.sendMessage).toHaveBeenLastCalledWith({
			type: FETCH_DIFF_MESSAGE,
			...location,
			isList: true,
		})
	})

	it('rethrows the rate limit the service worker reports', async () => {
		vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
			status: 429,
			rateLimit: { retryAfterMilliseconds: 30_000 },
		} as never)

		await expect(requestPullRequestDiff(location)).rejects.toMatchObject({
			status: 429,
			rateLimit: { retryAfterMilliseconds: 30_000 },
		})
	})

	it('treats a missing reply as an unknown failure', async () => {
		vi.mocked(browser.runtime.sendMessage).mockResolvedValue(undefined as never)

		await expect(requestPullRequestDiff(location)).rejects.toMatchObject({ status: 0 })
	})
})
