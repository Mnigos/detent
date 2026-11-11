import {
	type Account,
	API_URL,
	clearNotice,
	forgetAccount,
	postToken,
	REQUEST_TIMEOUT_MILLISECONDS,
	REVOKE_URL,
	readAccount,
	saveAccount,
	setNotice,
	TokenEndpointError,
	type Tokens,
	tokensOf,
} from './account'
import { IdTokenError, SigningKeysUnavailable, verifyIdToken } from './id-token'

/** Refresh this long before the hour-long access token runs out. */
export const REFRESH_MARGIN_MILLISECONDS = 5 * 60_000
export const SIGN_IN_AGAIN = 'Sign in to ChatGPT again.'
// Refresh answers that mean this token set is finished: the user has to sign in again.
const UNUSABLE_REFRESH = new Set([
	'invalid_grant',
	'invalid_refresh_token',
	'token_expired',
	'refresh_token_expired',
	'refresh_token_invalidated',
	'refresh_token_reused',
])

/** No usable ChatGPT session: signed out, or the refresh token is no longer accepted. */
export class SignInRequired extends Error {
	constructor() {
		super('ChatGPT sign-in required')
	}
}

// The last access token the API refused. Kept in memory only, so marking it never writes the
// credential record and cannot race a refresh or a sign-out.
let rejectedToken: string | undefined

const isFresh = (tokens: Tokens, now = Date.now()) =>
	tokens.accessToken !== rejectedToken && tokens.expiresAt - REFRESH_MARGIN_MILLISECONDS > now

/** Drops the tokens and keeps the registration, so the next sign-in reauthorizes it. */
async function endSession({ tokens: _tokens, ...registration }: Account, notice: string) {
	await saveAccount(registration)
	await setNotice(notice)
}

let refreshing: Promise<string> | undefined

async function refresh(): Promise<string> {
	// Read again: a refresh that finished a moment ago already rotated the refresh token.
	const account = await readAccount()
	const tokens = account?.tokens
	if (!account || !tokens) throw new SignInRequired()
	if (isFresh(tokens)) return tokens.accessToken
	if (!tokens.refreshToken) {
		await endSession(account, SIGN_IN_AGAIN)
		throw new SignInRequired()
	}

	let next: Tokens
	try {
		const response = await postToken({
			grant_type: 'refresh_token',
			client_id: account.clientId,
			refresh_token: tokens.refreshToken,
			resource: API_URL,
		})
		next = tokensOf(response, tokens)
		// A refresh may leave the ID token out; a new one must still be this account's. Without
		// the signing keys the new access token is still used, with the last verified ID token.
		if (typeof response.id_token === 'string')
			await verifyIdToken(response.id_token, {
				clientId: account.clientId,
				subject: account.subject,
			}).catch((error: unknown) => {
				if (!(error instanceof SigningKeysUnavailable)) throw error
				next = { ...next, idToken: tokens.idToken }
			})
	} catch (error) {
		// The old refresh token is spent; one that comes back with a bad ID token is not trusted.
		if (error instanceof IdTokenError) {
			await endSession(account, SIGN_IN_AGAIN)
			throw new SignInRequired()
		}
		if (error instanceof TokenEndpointError && error.code === 'invalid_client') {
			// The registration itself is gone; the next sign-in registers detent again.
			await forgetAccount()
			await setNotice(SIGN_IN_AGAIN)
			throw new SignInRequired()
		}
		if (
			error instanceof TokenEndpointError &&
			(UNUSABLE_REFRESH.has(error.code ?? '') || error.status === 400 || error.status === 401)
		) {
			await endSession(account, SIGN_IN_AGAIN)
			throw new SignInRequired()
		}
		// A network failure or a 5xx keeps the session for the next attempt.
		throw error
	}
	// A sign-out while the refresh ran wins: its tokens are not brought back.
	if ((await readAccount())?.tokens?.refreshToken !== tokens.refreshToken)
		throw new SignInRequired()
	await saveAccount({
		...account,
		tokens: { ...next, scopes: next.scopes.length ? next.scopes : tokens.scopes },
	})

	return next.accessToken
}

/**
 * A usable access token, refreshed shortly before expiry. Concurrent callers share one refresh,
 * since the refresh token rotates and a second use of the old one ends the session.
 */
export async function accessToken(): Promise<string> {
	const tokens = (await readAccount())?.tokens
	if (!tokens) throw new SignInRequired()
	if (isFresh(tokens)) return tokens.accessToken

	refreshing ??= refresh().finally(() => {
		refreshing = undefined
	})
	return refreshing
}

/** The API refused the access token; the next call refreshes it before trying again. */
export function invalidateAccessToken(rejected: string) {
	rejectedToken = rejected
}

async function revoke(clientId: string, refreshToken: string): Promise<boolean> {
	for (let attempt = 0; attempt < 3; attempt++) {
		if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt))
		try {
			const response = await fetch(REVOKE_URL, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({
					token: refreshToken,
					token_type_hint: 'refresh_token',
					client_id: clientId,
				}),
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
			})
			if (response.ok) return true
			if (response.status < 500) return false
		} catch {}
	}
	return false
}

/**
 * Ends the renewable session at OpenAI, then drops the tokens here. The issued client ID, account
 * and host ID stay for the next sign-in, as the docs ask.
 */
export async function signOut(): Promise<{ revoked: boolean }> {
	await refreshing?.catch(() => undefined)
	const account = await readAccount()
	if (!account?.tokens) return { revoked: true }

	const { refreshToken } = account.tokens
	const revoked = refreshToken ? await revoke(account.clientId, refreshToken) : true
	const { tokens: _tokens, needsConsent: _consent, ...registration } = account
	await saveAccount(registration)
	if (revoked) await clearNotice()
	else
		await setNotice(
			'Signed out here, but OpenAI did not confirm it. You can disconnect detent in ChatGPT settings.',
		)

	return { revoked }
}
