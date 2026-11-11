import {
	AGENT_NAME,
	API_URL,
	AUTHORIZE_URL,
	clearNotice,
	DYNAMIC_CLIENT_ID,
	forgetAccount,
	PLAN_SCOPE,
	postToken,
	REDIRECT_URI,
	readAccount,
	SCOPES,
	saveAccount,
	setNotice,
	TokenEndpointError,
	tokensOf,
} from './account'
import { verifyIdToken } from './id-token'
import { challengeOf, randomToken } from './pkce'
import { vault } from './vault'

const HOST_ID_KEY = 'hostId'
const PENDING_KEY = 'pending'
/** A sign-in tab left open longer than this has to start over. */
export const PENDING_LIFETIME_MILLISECONDS = 15 * 60_000

/** One authorization attempt, kept until its callback arrives. */
export interface Pending {
	state: string
	nonce: string
	verifier: string
	clientId: string
	isRegistration: boolean
	startedAt: number
}

export type SignInResult = { ok: true; email?: string } | { ok: false; message: string }

/** One stable, opaque ID for this browser profile's install (`urn:uuid:`, one of the accepted forms). */
export async function hostId(): Promise<string> {
	const saved = await vault.get<string>(HOST_ID_KEY)
	if (saved) return saved

	const created = `urn:uuid:${crypto.randomUUID()}`
	await vault.set(HOST_ID_KEY, created)
	return created
}

/** Builds the authorize URL and keeps the attempt's secrets until the callback. */
export async function beginSignIn(): Promise<string> {
	const account = await readAccount()
	const clientId = account?.clientId ?? DYNAMIC_CLIENT_ID
	const isRegistration = clientId === DYNAMIC_CLIENT_ID
	const pending: Pending = {
		state: randomToken(),
		nonce: randomToken(),
		verifier: randomToken(),
		clientId,
		isRegistration,
		startedAt: Date.now(),
	}
	const params: Record<string, string | undefined> = {
		client_id: clientId,
		agent_name_hint: isRegistration ? AGENT_NAME : undefined,
		ext_agent_host_id: await hostId(),
		id_token_hint: isRegistration ? undefined : account?.tokens?.idToken,
		login_hint: isRegistration ? undefined : account?.email,
		prompt: account?.needsConsent ? 'consent' : undefined,
		response_type: 'code',
		redirect_uri: REDIRECT_URI,
		scope: SCOPES,
		resource: API_URL,
		state: pending.state,
		nonce: pending.nonce,
		code_challenge_method: 'S256',
		code_challenge: await challengeOf(pending.verifier),
	}
	const url = new URL(AUTHORIZE_URL)
	for (const [name, value] of Object.entries(params))
		if (value !== undefined) url.searchParams.set(name, value)
	await vault.set(PENDING_KEY, pending)
	await clearNotice()

	return url.toString()
}

export type Callback =
	| { kind: 'code'; code: string; clientId: string }
	/** `consumed`: the attempt is over and its secrets are dropped. */
	| { kind: 'error'; message: string; consumed: boolean }

/** Checks a loopback callback against the pending attempt, as the sign-in docs order it. */
export function parseCallback(url: URL, pending: Pending | undefined, now = Date.now()): Callback {
	const query = url.searchParams
	if (!pending || now - pending.startedAt > PENDING_LIFETIME_MILLISECONDS)
		return {
			kind: 'error',
			message: 'This ChatGPT sign-in expired. Start again from the popup.',
			consumed: Boolean(pending),
		}
	if (query.get('state') !== pending.state)
		return {
			kind: 'error',
			message: 'This sign-in reply belongs to another attempt. Start again from the popup.',
			consumed: false,
		}

	const error = query.get('error')
	if (error)
		return {
			kind: 'error',
			message:
				error === 'access_denied'
					? 'ChatGPT sign-in was cancelled.'
					: `ChatGPT sign-in failed (${error.slice(0, 40)}).`,
			consumed: true,
		}

	const code = query.get('code')
	if (!code) return { kind: 'error', message: 'ChatGPT sign-in returned no code.', consumed: true }

	const returned = query.get('client_id')
	if (pending.isRegistration) {
		if (!returned || returned === DYNAMIC_CLIENT_ID)
			return {
				kind: 'error',
				message: 'ChatGPT registration did not finish. Try again.',
				consumed: true,
			}
		return { kind: 'code', code, clientId: returned }
	}
	if (returned && returned !== pending.clientId)
		return {
			kind: 'error',
			message: 'ChatGPT answered for another registration. Try again.',
			consumed: true,
		}

	return { kind: 'code', code, clientId: pending.clientId }
}

async function fail(message: string): Promise<SignInResult> {
	await setNotice(message)

	return { ok: false, message }
}

/** Finishes a sign-in from the callback URL: exchange, ID token checks, plan permission, save. */
export async function completeSignIn(href: string): Promise<SignInResult> {
	const pending = await vault.get<Pending>(PENDING_KEY)
	const callback = parseCallback(new URL(href), pending)
	if (callback.kind === 'error') {
		if (callback.consumed) await vault.remove(PENDING_KEY)
		return fail(callback.message)
	}
	if (!pending) return fail('This ChatGPT sign-in expired. Start again from the popup.')

	// One callback per attempt: the verifier is gone before anything can replay it.
	await vault.remove(PENDING_KEY)
	const { code, clientId } = callback
	const saved = await readAccount()
	// The issued client ID is kept even if the exchange fails, so the retry reauthorizes it.
	if (pending.isRegistration) await saveAccount({ clientId })

	let tokens: ReturnType<typeof tokensOf>
	try {
		tokens = tokensOf(
			await postToken({
				grant_type: 'authorization_code',
				client_id: clientId,
				code,
				code_verifier: pending.verifier,
				redirect_uri: REDIRECT_URI,
				resource: API_URL,
			}),
		)
	} catch (error) {
		return fail(
			error instanceof TokenEndpointError
				? error.code === 'invalid_grant'
					? 'ChatGPT sign-in code was not accepted (invalid_grant). Try again.'
					: `ChatGPT sign-in failed (${error.code ?? `HTTP ${error.status}`}).`
				: 'ChatGPT sign-in failed: no answer from OpenAI.',
		)
	}

	let identity: Awaited<ReturnType<typeof verifyIdToken>>
	try {
		identity = await verifyIdToken(tokens.idToken, { clientId, nonce: pending.nonce })
	} catch {
		return fail('ChatGPT sign-in could not be verified. Try again.')
	}
	const known = pending.isRegistration ? undefined : saved
	if (known?.subject && known.subject !== identity.subject) {
		// This registration belongs to another account; the next attempt registers anew.
		await forgetAccount()
		return fail('That is a different ChatGPT account. Continue with ChatGPT again to add it.')
	}

	const account = { clientId, subject: identity.subject, email: identity.email }
	if (!tokens.scopes.includes(PLAN_SCOPE)) {
		await saveAccount({ ...account, needsConsent: true })
		return fail('ChatGPT plan usage was not allowed. Continue with ChatGPT to allow it.')
	}
	await saveAccount({ ...account, tokens })
	await clearNotice()

	return { ok: true, email: identity.email }
}
