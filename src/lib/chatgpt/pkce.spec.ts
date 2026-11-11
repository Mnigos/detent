import { describe, expect, it } from 'vitest'
import { base64url, challengeOf, fromBase64url, randomToken } from './pkce'

describe('PKCE', () => {
	// Expected value from Python: base64.urlsafe_b64encode(sha256(verifier)).rstrip('=').
	it('derives the S256 challenge: unpadded base64url SHA-256 of the verifier', async () => {
		await expect(challengeOf('dBjftJeZ4CVP-mJ92K9iP3VwP7r56vZFXlCxx6FY0kM')).resolves.toBe(
			'XBMmERKshLPOP3K-rRVsn8bFtKxgxtGhRf8I8_AywWs',
		)
	})

	it('makes fresh, unpadded base64url values of 32 random bytes', () => {
		const values = new Set(Array.from({ length: 50 }, randomToken))
		expect(values.size).toBe(50)
		for (const value of values) expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/)
	})

	it('round-trips bytes through base64url', () => {
		const bytes = new Uint8Array([0, 251, 255, 62, 63, 128])
		expect(fromBase64url(base64url(bytes))).toEqual(bytes)
	})
})
