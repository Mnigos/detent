/** GitHub asked to slow down; `retryAfterMilliseconds` is how long, when it said. */
export interface RateLimit {
	retryAfterMilliseconds?: number
}

/** A request GitHub rate-limited: not an answer about the pull request, so nothing is cached for it. */
export class RateLimitError extends Error {
	constructor(readonly retryAfterMilliseconds?: number) {
		super('GitHub rate-limited the request')
		this.name = 'RateLimitError'
	}
}

const RATE_LIMIT_MESSAGE = /rate limit/i

/** Retry-After as delay seconds or an HTTP date, else the reset time of an exhausted rate limit. */
export function retryAfterOf(headers: Headers, now = Date.now()): number | undefined {
	const retryAfter = headers.get('retry-after')?.trim()
	if (retryAfter) {
		if (/^\d+$/.test(retryAfter)) return Number(retryAfter) * 1000
		const at = Date.parse(retryAfter)
		if (!Number.isNaN(at)) return Math.max(0, at - now)
	}
	const reset = Number(headers.get('x-ratelimit-reset'))
	if (headers.get('x-ratelimit-remaining') === '0' && reset > 0)
		return Math.max(0, reset * 1000 - now)

	return undefined
}

/**
 * A 429, or a 403 GitHub marks as a rate limit: with Retry-After, an exhausted quota or its "rate limit" message.
 * Any other answer resolves to undefined. The body is read from a clone, so the caller can still read it.
 */
export async function readRateLimit(
	response: Response,
	now = Date.now(),
): Promise<RateLimit | undefined> {
	const { status, headers } = response
	if (status !== 429 && status !== 403) return undefined
	if (
		status === 403 &&
		!headers.has('retry-after') &&
		headers.get('x-ratelimit-remaining') !== '0' &&
		!RATE_LIMIT_MESSAGE.test(
			await response
				.clone()
				.text()
				.catch(() => ''),
		)
	)
		return undefined

	const retryAfterMilliseconds = retryAfterOf(headers, now)

	return retryAfterMilliseconds === undefined ? {} : { retryAfterMilliseconds }
}
