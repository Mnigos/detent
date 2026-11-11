import { describe, expect, it } from 'vitest'
import { readRateLimit, retryAfterOf } from './rate-limit'

const NOW = Date.parse('2026-11-11T12:00:00Z')

describe('retryAfterOf', () => {
	it('reads Retry-After as seconds or as an HTTP date', () => {
		expect(retryAfterOf(new Headers({ 'Retry-After': '120' }), NOW)).toBe(120_000)
		expect(retryAfterOf(new Headers({ 'Retry-After': 'Wed, 11 Nov 2026 12:00:45 GMT' }), NOW)).toBe(
			45_000,
		)
		expect(retryAfterOf(new Headers({ 'Retry-After': 'Wed, 11 Nov 2026 11:00:00 GMT' }), NOW)).toBe(
			0,
		)
	})

	it('falls back to the reset time of an exhausted rate limit', () => {
		const reset = String((NOW + 30_000) / 1000)
		expect(
			retryAfterOf(new Headers({ 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': reset }), NOW),
		).toBe(30_000)
		expect(
			retryAfterOf(new Headers({ 'X-RateLimit-Remaining': '4', 'X-RateLimit-Reset': reset }), NOW),
		).toBeUndefined()
		expect(retryAfterOf(new Headers({ 'Retry-After': 'soon' }), NOW)).toBeUndefined()
	})
})

describe('readRateLimit', () => {
	it('reads every 429 as a rate limit, with or without Retry-After', async () => {
		await expect(
			readRateLimit(new Response('', { status: 429, headers: { 'Retry-After': '5' } }), NOW),
		).resolves.toEqual({ retryAfterMilliseconds: 5000 })
		await expect(readRateLimit(new Response('', { status: 429 }), NOW)).resolves.toEqual({})
	})

	it('reads a 403 as a rate limit only when GitHub marks it as one', async () => {
		await expect(
			readRateLimit(new Response('', { status: 403, headers: { 'Retry-After': '60' } }), NOW),
		).resolves.toEqual({ retryAfterMilliseconds: 60_000 })
		await expect(
			readRateLimit(new Response('', { status: 403, headers: { 'X-RateLimit-Remaining': '0' } })),
		).resolves.toEqual({})
		const message = new Response('You have exceeded a secondary rate limit.', { status: 403 })
		await expect(readRateLimit(message, NOW)).resolves.toEqual({})
		// The body is read from a clone, so it is still there for the caller.
		await expect(message.text()).resolves.toContain('secondary rate limit')
		await expect(readRateLimit(new Response('Forbidden', { status: 403 }), NOW)).resolves.toBe(
			undefined,
		)
	})

	it('ignores every other status', async () => {
		for (const status of [200, 401, 404, 500, 503])
			await expect(
				readRateLimit(new Response('', { status, headers: { 'Retry-After': '9' } }), NOW),
			).resolves.toBeUndefined()
	})
})
