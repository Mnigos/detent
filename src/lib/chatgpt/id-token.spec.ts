import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSigner, idClaims, type Signer } from '../../test/id-tokens'
import { JWKS_URL } from './account'
import { forgetSigningKeys, IdTokenError, verifyIdToken } from './id-token'

let signer: Signer
let jwks: object
const expected = { clientId: 'oaiapp_issued', nonce: 'nonce-1' }

beforeAll(async () => {
	signer = await createSigner()
})
beforeEach(() => {
	forgetSigningKeys()
	jwks = signer.jwks
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) =>
			url === JWKS_URL ? Response.json(jwks) : new Response(null, { status: 404 }),
		),
	)
})
afterEach(() => vi.unstubAllGlobals())

const token = (overrides: Record<string, unknown> = {}, header?: Record<string, unknown>) =>
	signer.sign(idClaims({ nonce: 'nonce-1', ...overrides }), header)

describe('verifyIdToken', () => {
	it('accepts a token signed by the published key and returns the identity', async () => {
		await expect(verifyIdToken(await token(), expected)).resolves.toEqual({
			subject: 'user-subject',
			email: 'reviewer@example.com',
		})
	})

	it('accepts a string audience and an absent nonce check (refresh)', async () => {
		await expect(
			verifyIdToken(await token({ aud: 'oaiapp_issued', nonce: undefined }), {
				clientId: 'oaiapp_issued',
				subject: 'user-subject',
			}),
		).resolves.toMatchObject({ subject: 'user-subject' })
	})

	it.each([
		['another issuer', { iss: 'https://evil.example' }, 'another issuer'],
		['another audience', { aud: ['oaiapp_other'] }, 'another client'],
		['an expired token', { exp: Math.floor(Date.now() / 1000) - 120 }, 'expired'],
		['a missing expiry', { exp: undefined }, 'expired'],
		['a token from the future', { iat: Math.floor(Date.now() / 1000) + 600 }, 'future'],
		['another nonce', { nonce: 'replayed' }, 'nonce'],
		['no subject', { sub: '' }, 'no subject'],
	])('rejects %s', async (_name, overrides, reason) => {
		await expect(verifyIdToken(await token(overrides), expected)).rejects.toThrow(reason)
	})

	it('rejects another account on a returning sign-in', async () => {
		await expect(
			verifyIdToken(await token(), { ...expected, subject: 'someone-else' }),
		).rejects.toThrow('another account')
	})

	it('rejects a token signed by another key under the published key ID', async () => {
		const forger = await createSigner('test-key')
		const forged = await forger.sign(idClaims({ nonce: 'nonce-1' }))
		await expect(verifyIdToken(forged, expected)).rejects.toThrow('signature')
	})

	it('rejects an edited payload', async () => {
		const [header, , signature] = (await token()).split('.')
		const payload = btoa(JSON.stringify(idClaims({ nonce: 'nonce-1', sub: 'admin' })))
			.replaceAll('=', '')
			.replaceAll('+', '-')
			.replaceAll('/', '_')
		await expect(verifyIdToken(`${header}.${payload}.${signature}`, expected)).rejects.toThrow(
			IdTokenError,
		)
	})

	it.each([
		['alg none', { alg: 'none' }],
		['HS256', { alg: 'HS256' }],
	])('rejects %s', async (_name, header) => {
		await expect(verifyIdToken(await token({}, header), expected)).rejects.toThrow('algorithm')
	})

	it('rejects something that is not a JWT', async () => {
		await expect(verifyIdToken('not-a-token', expected)).rejects.toThrow('not a JWT')
	})

	it('fetches the keys again once for an unknown key ID, then caches them', async () => {
		const rotated = await createSigner('rotated-key')
		await verifyIdToken(await token(), expected)
		jwks = rotated.jwks
		const fresh = await rotated.sign(idClaims({ nonce: 'nonce-1' }))
		await expect(verifyIdToken(fresh, expected)).resolves.toMatchObject({ subject: 'user-subject' })
		await verifyIdToken(fresh, expected)
		expect(fetch).toHaveBeenCalledTimes(2)
	})

	it('rejects a key ID that is not published even after reloading', async () => {
		await expect(verifyIdToken(await token({}, { kid: 'unknown' }), expected)).rejects.toThrow(
			'unknown key',
		)
	})
})
