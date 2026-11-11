import { base64url } from '../lib/chatgpt/pkce'

const encode = (value: object) => base64url(new TextEncoder().encode(JSON.stringify(value)))

/** An RS256 key pair standing in for OpenAI's signing key, and its JWKS answer. */
export async function createSigner(kid = 'test-key') {
	const { privateKey, publicKey } = await crypto.subtle.generateKey(
		{
			name: 'RSASSA-PKCS1-v1_5',
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: 'SHA-256',
		},
		true,
		['sign', 'verify'],
	)
	const jwk = await crypto.subtle.exportKey('jwk', publicKey)

	return {
		jwks: { keys: [{ kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', use: 'sig', kid }] },
		async sign(claims: Record<string, unknown>, header: Record<string, unknown> = {}) {
			const signed = `${encode({ alg: 'RS256', typ: 'JWT', kid, ...header })}.${encode(claims)}`
			const signature = await crypto.subtle.sign(
				'RSASSA-PKCS1-v1_5',
				privateKey,
				new TextEncoder().encode(signed),
			)

			return `${signed}.${base64url(new Uint8Array(signature))}`
		},
	}
}

export type Signer = Awaited<ReturnType<typeof createSigner>>

export const idClaims = (overrides: Record<string, unknown> = {}) => ({
	iss: 'https://auth.openai.com',
	aud: ['oaiapp_issued'],
	sub: 'user-subject',
	email: 'reviewer@example.com',
	iat: Math.floor(Date.now() / 1000),
	exp: Math.floor(Date.now() / 1000) + 3600,
	...overrides,
})
