import { browser } from 'wxt/browser'
import { type ErrorResponse, RateLimitError, readRateLimit, statusOf } from '../rate-limit'
import type { Send } from './request-queue'

export const FETCH_LIST_HEADS_MESSAGE = 'detent:fetch-list-heads'

/** A pull request's head commit as the list page reported it. `at`: when the page data was read (wall clock). */
export interface PullHead {
	headSha: string
	updatedAt?: string
	at: number
}

export type Heads = Map<string, PullHead>

/**
 * How long a head commit read from the list is trusted. Older page data may miss a push since; the list then asks for
 * its data once more rather than for every row's diff.
 */
export const HEADS_TTL_MILLISECONDS = 10 * 60 * 1000

/** The key heads are stored under: the row's `owner/repo/number`, lower-cased as GitHub ignores case there. */
export const headKey = ({ owner, repo, number }: { owner: string; repo: string; number: number }) =>
	`${owner}/${repo}/${number}`.toLowerCase()

const SHA = /^[0-9a-f]{40}$/
const OWNER_REPO = /^[^/\s]+\/[^/\s]+$/
// The list route nests results a few levels deep; the walk stops well before anything larger could hide there.
const MAX_DEPTH = 8

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null

/**
 * Collects every pull request in GitHub's list data: objects with a numeric `number`, a 40-hex `headSha` and a
 * `repoNameWithOwner`, wherever the route nests them (today `payload.repoPullsDashboardContentRoute.results[]`).
 */
export function parseListHeads(data: unknown, at = Date.now()): Heads {
	const heads: Heads = new Map()
	const visit = (value: unknown, depth: number) => {
		if (depth > MAX_DEPTH) return
		if (Array.isArray(value)) {
			for (const item of value) visit(item, depth + 1)
			return
		}
		if (!isRecord(value)) return

		const { number, headSha, repoNameWithOwner, updatedAt } = value
		if (
			typeof number === 'number' &&
			typeof headSha === 'string' &&
			SHA.test(headSha) &&
			typeof repoNameWithOwner === 'string' &&
			OWNER_REPO.test(repoNameWithOwner)
		) {
			const [owner = '', repo = ''] = repoNameWithOwner.split('/')
			heads.set(headKey({ owner, repo, number }), {
				headSha,
				...(typeof updatedAt === 'string' ? { updatedAt } : {}),
				at,
			})
			return
		}
		for (const child of Object.values(value)) visit(child, depth + 1)
	}
	visit(data, 0)

	return heads
}

/**
 * The list data GitHub embeds in the page it served (`<script data-target="react-app.embeddedData">`). It describes
 * the document's first URL and is as old as the document, so its heads carry the time the document started loading.
 */
export function readEmbeddedHeads(root: ParentNode = document): Heads {
	const script = root.querySelector('script[data-target="react-app.embeddedData"]')
	if (!script?.textContent) return new Map()
	try {
		return parseListHeads(JSON.parse(script.textContent), Math.round(performance.timeOrigin))
	} catch {
		return new Map()
	}
}

export interface FetchListHeadsRequest {
	type: typeof FETCH_LIST_HEADS_MESSAGE
	url: string
}

export type FetchListHeadsResponse = { heads: [string, PullHead][] } | ErrorResponse

/**
 * The same list data as JSON, which GitHub's own client asks for when it navigates between filters and pages (the
 * list URL with `Accept: application/json`). One request covers every row of the page.
 */
export async function fetchListHeads(url: string, send: Send = fetch): Promise<Heads> {
	const response = await send(url, {
		credentials: 'include',
		headers: {
			Accept: 'application/json',
			'X-Requested-With': 'XMLHttpRequest',
			'GitHub-Verified-Fetch': 'true',
		},
	})
	const rateLimit = await readRateLimit(response)
	if (rateLimit) throw new RateLimitError(rateLimit.retryAfterMilliseconds)
	if (!response.ok)
		throw Object.assign(new Error(`GitHub returned ${response.status} for the list data`), {
			status: response.status,
		})

	return parseListHeads(await response.json())
}

/** The content script's side: asks the service worker, which sends it through the shared queue. */
export async function requestListHeads(url: string): Promise<Heads> {
	const request: FetchListHeadsRequest = { type: FETCH_LIST_HEADS_MESSAGE, url }
	const response = (await browser.runtime.sendMessage(request)) as
		| FetchListHeadsResponse
		| undefined
	if (response && 'heads' in response) return new Map(response.heads)

	throw new TypeError(`The list data could not be read (${statusOf(response)})`)
}
