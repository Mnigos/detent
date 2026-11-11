import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSigner, idClaims, type Signer } from '../../test/id-tokens'
import { vaultStore } from '../../test/memory-vault'
import { type Account, JWKS_URL, REDIRECT_URI, TOKEN_URL } from './account'
import { forgetSigningKeys } from './id-token'
import { challengeOf } from './pkce'
import {
	beginSignIn,
	completeSignIn,
	PENDING_LIFETIME_MILLISECONDS,
	type Pending,
	parseCallback,
} from './sign-in'

vi.mock('./vault', () => import('../../test/memory-vault'))

let signer: Signer
let tokenAnswer: () => Promise<Response>
const PLAN_SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'

beforeAll(async () => {
	signer = await createSigner()
})
beforeEach(() => {
	vaultStore.clear()
	forgetSigningKeys()
	tokenAnswer = async () => Response.json({ error: 'invalid_grant' }, { status: 400 })
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) =>
			url === JWKS_URL
				? Response.json(signer.jwks)
				: url === TOKEN_URL
					? tokenAnswer()
					: new Response(null, { status: 404 }),
		),
	)
})
afterEach(() => vi.unstubAllGlobals())

const pending = () => vaultStore.get('pending') as Pending
const account = () => vaultStore.get('account') as Account | undefined
const callback = (query: Record<string, string>) =>
	`${REDIRECT_URI}?${new URLSearchParams(query).toString()}`
const tokenRequest = () => {
	const call = vi.mocked(fetch).mock.calls.find(([url]) => url === TOKEN_URL)
	return Object.fromEntries(new URLSearchParams(String(call?.[1]?.body)))
}
const answerTokens = (overrides: Record<string, unknown> = {}) => {
	const nonce = pending().nonce
	tokenAnswer = async () =>
		Response.json({
			access_token: 'access-1',
			refresh_token: 'refresh-1',
			id_token: await signer.sign(idClaims({ nonce })),
			token_type: 'Bearer',
			expires_in: 3600,
			scope: PLAN_SCOPES,
			...overrides,
		})
}

describe('beginSignIn', () => {
	it('registers a new client with PKCE S256, fresh state and nonce, and a stable host ID', async () => {
		const url = new URL(await beginSignIn())
		const query = Object.fromEntries(url.searchParams)
		const saved = pending()

		expect(`${url.origin}${url.pathname}`).toBe('https://auth.openai.com/api/accounts/authorize')
		expect(query).toEqual({
			client_id: 'dynamic_agent_client',
			agent_name_hint: 'detent for GitHub',
			ext_agent_host_id: expect.stringMatching(/^urn:uuid:[0-9a-f-]{36}$/),
			response_type: 'code',
			redirect_uri: 'http://127.0.0.1:47801/auth/callback',
			scope: PLAN_SCOPES,
			resource: 'https://api.openai.com/v1',
			state: saved.state,
			nonce: saved.nonce,
			code_challenge_method: 'S256',
			code_challenge: await challengeOf(saved.verifier),
		})
		expect(saved).toMatchObject({ clientId: 'dynamic_agent_client', isRegistration: true })
		expect(new Set([saved.state, saved.nonce, saved.verifier]).size).toBe(3)

		const again = new URL(await beginSignIn()).searchParams
		expect(again.get('ext_agent_host_id')).toBe(query.ext_agent_host_id)
		expect(again.get('state')).not.toBe(query.state)
	})

	it('reauthorizes a saved registration with its hints and without the name hint', async () => {
		vaultStore.set('account', {
			clientId: 'oaiapp_issued',
			email: 'reviewer@example.com',
			tokens: { idToken: 'old-id-token' },
		})
		const query = new URL(await beginSignIn()).searchParams

		expect(query.get('client_id')).toBe('oaiapp_issued')
		expect(query.get('id_token_hint')).toBe('old-id-token')
		expect(query.get('login_hint')).toBe('reviewer@example.com')
		expect(query.has('agent_name_hint')).toBe(false)
		expect(query.has('prompt')).toBe(false)
		expect(pending()).toMatchObject({ clientId: 'oaiapp_issued', isRegistration: false })
	})

	it('asks for consent again after plan usage was declined', async () => {
		vaultStore.set('account', { clientId: 'oaiapp_issued', needsConsent: true })
		expect(new URL(await beginSignIn()).searchParams.get('prompt')).toBe('consent')
	})
})

describe('parseCallback', () => {
	const attempt: Pending = {
		state: 'state-1',
		nonce: 'nonce-1',
		verifier: 'verifier-1',
		clientId: 'dynamic_agent_client',
		isRegistration: true,
		startedAt: 1_000,
	}
	const parse = (
		query: Record<string, string>,
		against: Pending | undefined = attempt,
		now = 2_000,
	) => parseCallback(new URL(callback(query)), against, now)

	it('keeps the issued client ID of a new registration', () => {
		expect(parse({ code: 'c', state: 'state-1', client_id: 'oaiapp_issued' })).toEqual({
			kind: 'code',
			code: 'c',
			clientId: 'oaiapp_issued',
		})
	})

	it.each([
		['no client ID', { code: 'c', state: 'state-1' }],
		[
			'the registration entry point as client ID',
			{ code: 'c', state: 'state-1', client_id: 'dynamic_agent_client' },
		],
	])('treats a registration with %s as incomplete', (_name, query) => {
		expect(parse(query)).toEqual({
			kind: 'error',
			message: 'ChatGPT registration did not finish. Try again.',
			consumed: true,
		})
	})

	it('keeps the pending client ID on a reauthorization without one, and rejects another', () => {
		const returning = { ...attempt, clientId: 'oaiapp_issued', isRegistration: false }
		expect(parse({ code: 'c', state: 'state-1' }, returning)).toMatchObject({
			kind: 'code',
			clientId: 'oaiapp_issued',
		})
		expect(
			parse({ code: 'c', state: 'state-1', client_id: 'oaiapp_other' }, returning),
		).toMatchObject({ kind: 'error', consumed: true })
	})

	it('ignores a reply to another attempt without ending this one', () => {
		expect(parse({ code: 'c', state: 'forged', client_id: 'oaiapp_x' })).toMatchObject({
			kind: 'error',
			consumed: false,
		})
	})

	it('refuses a reply without an attempt or after it expired', () => {
		expect(parse({ code: 'c', state: 'state-1' }, undefined)).toMatchObject({ kind: 'error' })
		expect(
			parse({ code: 'c', state: 'state-1' }, attempt, 1_000 + PENDING_LIFETIME_MILLISECONDS + 1),
		).toMatchObject({ kind: 'error', consumed: true })
	})

	it('stops on an OAuth error before looking for a code', () => {
		expect(parse({ error: 'access_denied', state: 'state-1' })).toEqual({
			kind: 'error',
			message: 'ChatGPT sign-in was cancelled.',
			consumed: true,
		})
		expect(parse({ state: 'state-1' })).toMatchObject({
			message: 'ChatGPT sign-in returned no code.',
		})
	})
})

describe('completeSignIn', () => {
	it('exchanges the code with the issued client ID and saves the verified account', async () => {
		await beginSignIn()
		const { state, verifier } = pending()
		answerTokens()

		await expect(
			completeSignIn(callback({ code: 'code-1', state, client_id: 'oaiapp_issued' })),
		).resolves.toEqual({ ok: true, email: 'reviewer@example.com' })
		expect(tokenRequest()).toEqual({
			grant_type: 'authorization_code',
			client_id: 'oaiapp_issued',
			code: 'code-1',
			code_verifier: verifier,
			redirect_uri: REDIRECT_URI,
			resource: 'https://api.openai.com/v1',
		})
		expect(account()).toMatchObject({
			clientId: 'oaiapp_issued',
			subject: 'user-subject',
			email: 'reviewer@example.com',
			tokens: { accessToken: 'access-1', refreshToken: 'refresh-1' },
		})
		expect(vaultStore.has('pending')).toBe(false)
		expect(vaultStore.has('notice')).toBe(false)
	})

	it('cannot be replayed: the attempt is consumed by its first callback', async () => {
		await beginSignIn()
		const { state } = pending()
		answerTokens()
		const url = callback({ code: 'code-1', state, client_id: 'oaiapp_issued' })
		await completeSignIn(url)

		await expect(completeSignIn(url)).resolves.toMatchObject({ ok: false })
	})

	it('redeems a code once even when two copies of the callback arrive together', async () => {
		await beginSignIn()
		const { state } = pending()
		answerTokens()
		const url = callback({ code: 'code-1', state, client_id: 'oaiapp_issued' })
		const results = await Promise.all([completeSignIn(url), completeSignIn(url)])

		expect(results.filter((result) => result.ok)).toHaveLength(1)
		expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === TOKEN_URL)).toHaveLength(1)
	})

	it('keeps the issued client ID when the code is not accepted, and says so', async () => {
		await beginSignIn()
		const { state } = pending()

		await expect(
			completeSignIn(callback({ code: 'fake', state, client_id: 'oaiapp_issued' })),
		).resolves.toEqual({
			ok: false,
			message: 'ChatGPT sign-in code was not accepted (invalid_grant). Try again.',
		})
		expect(account()).toEqual({ clientId: 'oaiapp_issued' })
		expect(vaultStore.get('notice')).toContain('invalid_grant')
		expect(new URL(await beginSignIn()).searchParams.get('client_id')).toBe('oaiapp_issued')
	})

	it('saves no tokens when the ID token nonce belongs to another attempt', async () => {
		await beginSignIn()
		const { state } = pending()
		answerTokens({ id_token: await signer.sign(idClaims({ nonce: 'other' })) })

		await expect(
			completeSignIn(callback({ code: 'c', state, client_id: 'oaiapp_issued' })),
		).resolves.toMatchObject({ ok: false })
		expect(account()?.tokens).toBeUndefined()
	})

	it('keeps the sign-in but no tokens when plan usage was not granted', async () => {
		await beginSignIn()
		const { state } = pending()
		answerTokens({ scope: 'openid profile email offline_access' })

		await expect(
			completeSignIn(callback({ code: 'c', state, client_id: 'oaiapp_issued' })),
		).resolves.toMatchObject({ ok: false, message: expect.stringContaining('not allowed') })
		expect(account()).toMatchObject({ clientId: 'oaiapp_issued', needsConsent: true })
		expect(account()?.tokens).toBeUndefined()
	})

	it('drops a registration that answers for a different account', async () => {
		vaultStore.set('account', { clientId: 'oaiapp_issued', subject: 'first-subject' })
		await beginSignIn()
		const { state } = pending()
		answerTokens()

		await expect(completeSignIn(callback({ code: 'c', state }))).resolves.toMatchObject({
			ok: false,
		})
		expect(account()).toBeUndefined()
	})
})
