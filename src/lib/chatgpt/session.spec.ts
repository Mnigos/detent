import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSigner, idClaims, type Signer } from '../../test/id-tokens'
import { vaultStore } from '../../test/memory-vault'
import { type Account, JWKS_URL, REVOKE_URL, TOKEN_URL } from './account'
import { forgetSigningKeys } from './id-token'
import { accessToken, invalidateAccessToken, SignInRequired, signOut } from './session'

vi.mock('./vault', () => import('../../test/memory-vault'))

let signer: Signer
let tokenAnswer: () => Promise<Response>
let revokeAnswer: () => Promise<Response>

const ACCOUNT: Account = {
	clientId: 'oaiapp_issued',
	subject: 'user-subject',
	email: 'reviewer@example.com',
	tokens: {
		idToken: 'id-0',
		accessToken: 'access-0',
		refreshToken: 'refresh-0',
		expiresAt: Date.now() + 3_600_000,
		scopes: ['chatgpt.tokens.use.direct'],
		savedAt: '2026-11-11T00:00:00.000Z',
	},
}
const expired = (): Account => ({
	...ACCOUNT,
	tokens: { ...(ACCOUNT.tokens as NonNullable<Account['tokens']>), expiresAt: Date.now() + 60_000 },
})
const account = () => vaultStore.get('account') as Account | undefined
const calls = (url: string) => vi.mocked(fetch).mock.calls.filter(([called]) => called === url)
const form = (url: string, index = 0) =>
	Object.fromEntries(new URLSearchParams(String(calls(url)[index]?.[1]?.body)))

beforeAll(async () => {
	signer = await createSigner()
})
beforeEach(() => {
	vaultStore.clear()
	forgetSigningKeys()
	tokenAnswer = async () =>
		Response.json({
			access_token: 'access-1',
			refresh_token: 'refresh-1',
			id_token: await signer.sign(idClaims()),
			expires_in: 3600,
			scope: 'chatgpt.tokens.use.direct openid',
		})
	revokeAnswer = async () => new Response(null, { status: 200 })
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			if (url === JWKS_URL) return Response.json(signer.jwks)
			if (url === TOKEN_URL) return tokenAnswer()
			if (url === REVOKE_URL) return revokeAnswer()
			return new Response(null, { status: 404 })
		}),
	)
})
afterEach(() => {
	vi.unstubAllGlobals()
	vi.useRealTimers()
})

describe('accessToken', () => {
	it('requires a sign-in without tokens', async () => {
		await expect(accessToken()).rejects.toThrow(SignInRequired)
	})

	it('uses a token that is not close to expiry without asking OpenAI', async () => {
		vaultStore.set('account', ACCOUNT)
		await expect(accessToken()).resolves.toBe('access-0')
		expect(fetch).not.toHaveBeenCalled()
	})

	it('refreshes before expiry with the issued client ID and saves the rotated token', async () => {
		vaultStore.set('account', expired())

		await expect(accessToken()).resolves.toBe('access-1')
		expect(form(TOKEN_URL)).toEqual({
			grant_type: 'refresh_token',
			client_id: 'oaiapp_issued',
			refresh_token: 'refresh-0',
			resource: 'https://api.openai.com/v1',
		})
		expect(account()?.tokens).toMatchObject({ accessToken: 'access-1', refreshToken: 'refresh-1' })
		await expect(accessToken()).resolves.toBe('access-1')
		expect(calls(TOKEN_URL)).toHaveLength(1)
	})

	it('shares one refresh between concurrent callers', async () => {
		vaultStore.set('account', expired())
		const tokens = await Promise.all([accessToken(), accessToken(), accessToken()])

		expect(tokens).toEqual(['access-1', 'access-1', 'access-1'])
		expect(calls(TOKEN_URL)).toHaveLength(1)
	})

	it('ends the session when the refresh token is no longer accepted', async () => {
		vaultStore.set('account', expired())
		tokenAnswer = async () => Response.json({ error: 'refresh_token_reused' }, { status: 400 })

		await expect(accessToken()).rejects.toThrow(SignInRequired)
		expect(account()).toEqual({
			clientId: 'oaiapp_issued',
			subject: 'user-subject',
			email: 'reviewer@example.com',
		})
		expect(vaultStore.get('notice')).toBe('Sign in to ChatGPT again.')
	})

	it('forgets a registration OpenAI no longer knows', async () => {
		vaultStore.set('account', expired())
		tokenAnswer = async () => Response.json({ error: 'invalid_client' }, { status: 401 })

		await expect(accessToken()).rejects.toThrow(SignInRequired)
		expect(account()).toBeUndefined()
	})

	it('keeps the session through a temporary failure', async () => {
		vaultStore.set('account', expired())
		tokenAnswer = async () => new Response('busy', { status: 503 })

		await expect(accessToken()).rejects.not.toThrow(SignInRequired)
		expect(account()?.tokens?.refreshToken).toBe('refresh-0')
	})

	it('ends the session when a refreshed ID token belongs to another account', async () => {
		vaultStore.set('account', expired())
		const other = await signer.sign(idClaims({ sub: 'someone-else' }))
		tokenAnswer = async () =>
			Response.json({ access_token: 'a', refresh_token: 'r', id_token: other, expires_in: 3600 })

		await expect(accessToken()).rejects.toThrow(SignInRequired)
		expect(account()?.tokens).toBeUndefined()
	})

	it('uses a refreshed token while the signing keys cannot be loaded', async () => {
		vaultStore.set('account', expired())
		const fetchMock = vi.mocked(fetch)
		const route = fetchMock.getMockImplementation()
		fetchMock.mockImplementation(async (url, init) =>
			url === JWKS_URL
				? new Response(null, { status: 502 })
				: (route?.(url, init) as Promise<Response>),
		)

		await expect(accessToken()).resolves.toBe('access-1')
		expect(account()?.tokens).toMatchObject({ refreshToken: 'refresh-1', idToken: 'id-0' })
	})

	it('refreshes a token the API refused', async () => {
		vaultStore.set('account', ACCOUNT)
		invalidateAccessToken('access-0')

		await expect(accessToken()).resolves.toBe('access-1')
	})

	it('marks a refused token without touching the stored record, so a sign-out stays signed out', async () => {
		vaultStore.set('account', ACCOUNT)
		const { tokens: _tokens, ...registration } = ACCOUNT
		vaultStore.set('account', registration)
		invalidateAccessToken('access-0')

		expect(account()).toEqual(registration)
		await expect(accessToken()).rejects.toThrow(SignInRequired)
	})

	it('does not bring tokens back when a sign-out lands during the refresh', async () => {
		vaultStore.set('account', expired())
		let answer!: (response: Response) => void
		tokenAnswer = () => new Promise((resolve) => (answer = resolve))
		const pending = accessToken()
		await vi.waitFor(() => expect(answer).toBeDefined())
		const { tokens: _tokens, ...registration } = expired()
		vaultStore.set('account', registration)
		answer(
			Response.json({
				access_token: 'a',
				refresh_token: 'r',
				id_token: await signer.sign(idClaims()),
				expires_in: 3600,
			}),
		)

		await expect(pending).rejects.toThrow(SignInRequired)
		expect(account()?.tokens).toBeUndefined()
	})
})

describe('signOut', () => {
	it('revokes the refresh token, then drops the tokens and keeps the registration', async () => {
		vaultStore.set('account', ACCOUNT)

		await expect(signOut()).resolves.toEqual({ revoked: true })
		expect(form(REVOKE_URL)).toEqual({
			token: 'refresh-0',
			token_type_hint: 'refresh_token',
			client_id: 'oaiapp_issued',
		})
		expect(account()).toEqual({
			clientId: 'oaiapp_issued',
			subject: 'user-subject',
			email: 'reviewer@example.com',
		})
	})

	it('retries a failing revocation, then signs out here and says it was not confirmed', async () => {
		vi.useFakeTimers()
		vaultStore.set('account', ACCOUNT)
		revokeAnswer = async () => new Response(null, { status: 503 })
		const result = signOut()
		await vi.runAllTimersAsync()

		await expect(result).resolves.toEqual({ revoked: false })
		expect(calls(REVOKE_URL)).toHaveLength(3)
		expect(account()?.tokens).toBeUndefined()
		expect(vaultStore.get('notice')).toContain('did not confirm')
	})
})
