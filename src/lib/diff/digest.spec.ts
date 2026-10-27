import { describe, expect, it } from 'vitest'
import { digestText } from './digest'

describe('digestText', () => {
	it('returns the lowercase hex SHA-256 of the text', async () => {
		await expect(digestText('detent for GitHub')).resolves.toBe(
			'b6ed54d87ed7e0ab65d4b696b076f1ac2ecb80f5a936597c2cbf8d6f1f53e110',
		)
	})

	it('returns the same digest for the same text and a different one otherwise', async () => {
		const [first, second, other] = await Promise.all([
			digestText('diff --git a/a b/a'),
			digestText('diff --git a/a b/a'),
			digestText('diff --git a/b b/b'),
		])

		expect(first).toBe(second)
		expect(first).not.toBe(other)
	})
})
