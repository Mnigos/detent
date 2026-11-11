export const base64url = (bytes: Uint8Array) =>
	btoa(String.fromCharCode(...bytes))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/, '')

export function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
	const padded = text.replaceAll('-', '+').replaceAll('_', '/')
	const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))

	return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

/** 32 random bytes, base64url: a state, a nonce or a PKCE verifier (43 characters). */
export const randomToken = () => base64url(crypto.getRandomValues(new Uint8Array(32)))

/** The S256 code challenge of a PKCE verifier. */
export const challengeOf = async (verifier: string) =>
	base64url(
		new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
	)
