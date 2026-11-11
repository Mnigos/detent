// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { RateLimitError, RequestPausedError } from '../rate-limit'
import {
	FETCH_LIST_HEADS_MESSAGE,
	fetchListHeads,
	headKey,
	parseListHeads,
	readEmbeddedHeads,
	requestListHeads,
} from './heads'

const SHA_A = '965dfa96d4d5a6348571be4c8b4a34407cae94a3'
const SHA_B = 'aa5544c64aba9d87166863f4c6996e98266f5e8c'

// Hand-written in the shape of the list route's payload (`payload.repoPullsDashboardContentRoute.results[]`).
const listData = () => ({
	payload: {
		repoPullsDashboardContentRoute: {
			results: [
				{
					number: 8916,
					headSha: SHA_A,
					createdAt: '2026-11-09T10:00:00Z',
					updatedAt: '2026-11-10T18:50:00Z',
					displayState: 'REPO_PULL_REQUEST_DISPLAY_STATE_OPEN',
					id: 1,
					repoNameWithOwner: 'TanStack/router',
					commitHeadShaChannel: 'channel',
				},
				{
					number: 8877,
					headSha: SHA_B,
					updatedAt: '2026-11-04T22:08:18Z',
					displayState: 'REPO_PULL_REQUEST_DISPLAY_STATE_DRAFT',
					repoNameWithOwner: 'TanStack/router',
				},
				{ number: 1, headSha: 'not-a-sha', repoNameWithOwner: 'TanStack/router' },
				{ number: '2', headSha: SHA_A, repoNameWithOwner: 'TanStack/router' },
				{ number: 3, headSha: SHA_A },
			],
			currentPage: 1,
		},
	},
	title: 'Pull requests',
})

afterEach(() => {
	document.body.innerHTML = ''
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe('parseListHeads', () => {
	it('maps each pull request to its head commit and update time, and skips malformed ones', () => {
		const heads = parseListHeads(listData(), 42)

		expect([...heads]).toEqual([
			['tanstack/router/8916', { headSha: SHA_A, updatedAt: '2026-11-10T18:50:00Z', at: 42 }],
			['tanstack/router/8877', { headSha: SHA_B, updatedAt: '2026-11-04T22:08:18Z', at: 42 }],
		])
	})

	it('finds the results wherever the route nests them', () => {
		const heads = parseListHeads({ payload: { anotherRoute: { page: listData().payload } } })

		expect(heads.get(headKey({ owner: 'TanStack', repo: 'router', number: 8916 }))?.headSha).toBe(
			SHA_A,
		)
	})

	it('reads nothing from data without pull requests', () => {
		expect(parseListHeads(undefined).size).toBe(0)
		expect(parseListHeads({ payload: { results: [] } }).size).toBe(0)
	})

	it('keys rows case-insensitively, as GitHub treats owner and repository names', () => {
		expect(headKey({ owner: 'TanStack', repo: 'Router', number: 1 })).toBe('tanstack/router/1')
	})
})

describe('readEmbeddedHeads', () => {
	it('reads the data GitHub embedded in the page, dated to when the document loaded', () => {
		const script = document.createElement('script')
		script.type = 'application/json'
		script.dataset.target = 'react-app.embeddedData'
		script.textContent = JSON.stringify(listData())
		document.body.append(script)

		const heads = readEmbeddedHeads()
		expect(heads.get('tanstack/router/8916')).toEqual({
			headSha: SHA_A,
			updatedAt: '2026-11-10T18:50:00Z',
			at: Math.round(performance.timeOrigin),
		})
	})

	it('reads nothing without the script or from one that is not JSON', () => {
		expect(readEmbeddedHeads().size).toBe(0)
		const script = document.createElement('script')
		script.type = 'application/json'
		script.dataset.target = 'react-app.embeddedData'
		script.textContent = '{'
		document.body.append(script)
		expect(readEmbeddedHeads().size).toBe(0)
	})
})

describe('fetchListHeads', () => {
	it("asks for the list URL as JSON, the way GitHub's client navigates", async () => {
		const send = vi.fn(async () => Response.json(listData()))
		const heads = await fetchListHeads('https://github.com/TanStack/router/pulls?page=2', send)

		expect(heads.get('tanstack/router/8877')?.headSha).toBe(SHA_B)
		expect(send).toHaveBeenCalledWith('https://github.com/TanStack/router/pulls?page=2', {
			credentials: 'include',
			headers: {
				Accept: 'application/json',
				'X-Requested-With': 'XMLHttpRequest',
				'GitHub-Verified-Fetch': 'true',
			},
		})
	})

	it('reports a rate limit as one, and any other refusal with its status', async () => {
		await expect(
			fetchListHeads(
				'https://github.com/o/r/pulls',
				async () => new Response('', { status: 429, headers: { 'Retry-After': '30' } }),
			),
		).rejects.toEqual(new RateLimitError(30_000))
		await expect(
			fetchListHeads('https://github.com/o/r/pulls', async () => new Response('', { status: 404 })),
		).rejects.toMatchObject({ status: 404 })
	})
})

describe('requestListHeads', () => {
	it('asks the service worker and rebuilds the map', async () => {
		const sendMessage = vi
			.spyOn(fakeBrowser.runtime, 'sendMessage')
			.mockResolvedValue({ heads: [['o/r/1', { headSha: SHA_A, at: 1 }]] } as never)

		await expect(requestListHeads('https://github.com/o/r/pulls')).resolves.toEqual(
			new Map([['o/r/1', { headSha: SHA_A, at: 1 }]]),
		)
		expect(sendMessage).toHaveBeenCalledWith({
			type: FETCH_LIST_HEADS_MESSAGE,
			url: 'https://github.com/o/r/pulls',
		})
	})

	it('rethrows a pause or a rate limit, and anything else as a failed request', async () => {
		const sendMessage = vi.spyOn(fakeBrowser.runtime, 'sendMessage')
		sendMessage.mockResolvedValueOnce({ status: 0, isPaused: true } as never)
		await expect(requestListHeads('u')).rejects.toBeInstanceOf(RequestPausedError)
		sendMessage.mockResolvedValueOnce({
			status: 429,
			isRateLimited: true,
			retryAfterMilliseconds: 5000,
		} as never)
		await expect(requestListHeads('u')).rejects.toEqual(new RateLimitError(5000))
		sendMessage.mockResolvedValueOnce(undefined as never)
		await expect(requestListHeads('u')).rejects.toBeInstanceOf(TypeError)
	})
})
