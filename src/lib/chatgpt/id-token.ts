import { ISSUER, JWKS_URL, REQUEST_TIMEOUT_MILLISECONDS } from './account'
import { fromBase64url } from './pkce'

const CLOCK_SKEW_SECONDS = 60

/** The ID token is not valid: never trust its identity. */
export class IdTokenError extends Error {}

/** OpenAI's signing keys could not be loaded, so nothing was decided about the token. */
export class SigningKeysUnavailable extends Error {}

export interface IdentityClaims {
	subject: string
	email?: string
}

interface SigningKey extends JsonWebKey {
	kid?: string
}

let signingKeys: Promise<SigningKey[]> | undefined

function loadKeys(reload = false): Promise<SigningKey[]> {
	if (reload || !signingKeys)
		signingKeys = fetch(JWKS_URL, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS) })
			.then(async (response) => {
				if (!response.ok) throw new Error(`HTTP ${response.status}`)
				const body = (await response.json()) as { keys?: SigningKey[] }

				return Array.isArray(body.keys) ? body.keys : []
			})
			.catch((error: unknown) => {
				signingKeys = undefined
				throw new SigningKeysUnavailable(`signing keys: ${String(error)}`)
			})

	return signingKeys
}

/** Drops the cached signing keys; the next check fetches them again. */
export function forgetSigningKeys() {
	signingKeys = undefined
}

function segment(text: string): Record<string, unknown> {
	try {
		const value: unknown = JSON.parse(new TextDecoder().decode(fromBase64url(text)))
		if (value && typeof value === 'object') return value as Record<string, unknown>
	} catch {}
	throw new IdTokenError('the ID token is not a JWT')
}

async function keyFor(kid: unknown): Promise<SigningKey> {
	const find = (keys: SigningKey[]) => keys.find((key) => key.kid === kid && key.kty === 'RSA')
	// An unknown key ID means the issuer rotated its keys since they were cached.
	const key = find(await loadKeys()) ?? find(await loadKeys(true))
	if (!key) throw new IdTokenError('the ID token is signed with an unknown key')

	return key
}

/**
 * Verifies an OpenAI ID token: RS256 signature against the issuer's published keys, issuer,
 * audience (the issued client ID), expiry, and, when given, the attempt's nonce and the account's
 * known subject.
 */
export async function verifyIdToken(
	token: string,
	expected: { clientId: string; nonce?: string; subject?: string },
	now = Date.now(),
): Promise<IdentityClaims> {
	const parts = token.split('.')
	const [header, payload, signature] = parts
	if (parts.length !== 3 || !header || !payload || !signature)
		throw new IdTokenError('the ID token is not a JWT')

	const { alg, kid } = segment(header)
	if (alg !== 'RS256') throw new IdTokenError(`unexpected ID token algorithm ${String(alg)}`)
	const { kty, n, e } = await keyFor(kid)
	const key = await crypto.subtle.importKey(
		'jwk',
		{ kty, n, e },
		{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
		false,
		['verify'],
	)
	const isValid = await crypto.subtle.verify(
		'RSASSA-PKCS1-v1_5',
		key,
		fromBase64url(signature),
		new TextEncoder().encode(`${header}.${payload}`),
	)
	if (!isValid) throw new IdTokenError('the ID token signature does not match')

	const claims = segment(payload)
	const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
	const seconds = now / 1000
	if (claims.iss !== ISSUER) throw new IdTokenError('the ID token has another issuer')
	if (!audience.includes(expected.clientId))
		throw new IdTokenError('the ID token is for another client')
	if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS < seconds)
		throw new IdTokenError('the ID token has expired')
	if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_SECONDS > seconds)
		throw new IdTokenError('the ID token is issued in the future')
	if (expected.nonce !== undefined && claims.nonce !== expected.nonce)
		throw new IdTokenError('the ID token nonce does not match this sign-in')
	if (typeof claims.sub !== 'string' || !claims.sub)
		throw new IdTokenError('the ID token has no subject')
	if (expected.subject !== undefined && claims.sub !== expected.subject)
		throw new IdTokenError('the ID token belongs to another account')

	return { subject: claims.sub, email: typeof claims.email === 'string' ? claims.email : undefined }
}
