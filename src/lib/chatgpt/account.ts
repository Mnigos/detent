// "Sign in with ChatGPT" for open-source apps: https://developers.openai.com/siwc/token-sharing-open-source
// Endpoints are those of https://auth.openai.com/.well-known/openid-configuration.
import { vault } from './vault'

export const ISSUER = 'https://auth.openai.com'
export const AUTHORIZE_URL = `${ISSUER}/api/accounts/authorize`
export const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`
export const REVOKE_URL = `${ISSUER}/api/accounts/oauth/revoke`
export const JWKS_URL = `${ISSUER}/.well-known/jwks.json`
export const API_URL = 'https://api.openai.com/v1'
export const PLAN_SCOPE = 'chatgpt.tokens.use.direct'
export const SCOPES = `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`
/** No call to OpenAI's auth or model-list endpoints may hang a popup or a sign-in. */
export const REQUEST_TIMEOUT_MILLISECONDS = 15_000
export const DYNAMIC_CLIENT_ID = 'dynamic_agent_client'
export const AGENT_NAME = 'detent for GitHub'
// Nothing listens here: a declarativeNetRequest rule turns the navigation into an extension page.
// Not 1455, where a Codex CLI login server may listen.
export const CALLBACK_PORT = 47_801
export const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}/auth/callback`

export interface Tokens {
	idToken: string
	accessToken: string
	refreshToken?: string
	/** Milliseconds since the epoch. */
	expiresAt: number
	scopes: string[]
	savedAt: string
}

/** One registration: the issued client ID outlives sign-outs, the tokens do not. */
export interface Account {
	clientId: string
	subject?: string
	email?: string
	tokens?: Tokens
	/** The last sign-in did not grant plan usage; the next one asks for consent again. */
	needsConsent?: boolean
}

const ACCOUNT_KEY = 'account'
const NOTICE_KEY = 'notice'

export const readAccount = () => vault.get<Account>(ACCOUNT_KEY)
export const saveAccount = (account: Account) => vault.set(ACCOUNT_KEY, account)
export const forgetAccount = () => vault.remove(ACCOUNT_KEY)

/** The one line the popup shows about the last thing that went wrong with ChatGPT. */
export const readNotice = () => vault.get<string>(NOTICE_KEY)
export const setNotice = (notice: string) => vault.set(NOTICE_KEY, notice)
export const clearNotice = () => vault.remove(NOTICE_KEY)

export class TokenEndpointError extends Error {
	constructor(
		readonly status: number,
		readonly code: string | undefined,
	) {
		super(`token endpoint HTTP ${status}${code ? ` ${code}` : ''}`)
	}
}

export interface TokenResponse {
	access_token?: unknown
	refresh_token?: unknown
	id_token?: unknown
	expires_in?: unknown
	scope?: unknown
}

/** Posts a form to the token endpoint; an error answer carries only its status and OAuth code. */
export async function postToken(form: Record<string, string>): Promise<TokenResponse> {
	const response = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
		body: new URLSearchParams(form),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
	})
	const body = (await response.json().catch(() => ({}))) as TokenResponse & { error?: unknown }
	if (!response.ok)
		throw new TokenEndpointError(
			response.status,
			typeof body.error === 'string' ? body.error : undefined,
		)

	return body
}

export function tokensOf(response: TokenResponse, previous?: Tokens): Tokens {
	const idToken = typeof response.id_token === 'string' ? response.id_token : previous?.idToken
	if (typeof response.access_token !== 'string' || !idToken)
		throw new Error('the token response has no access token or ID token')

	const expiresIn = typeof response.expires_in === 'number' ? response.expires_in : 3600
	return {
		idToken,
		accessToken: response.access_token,
		// A refresh answers with a replacement; keep the last one if it ever does not.
		refreshToken:
			typeof response.refresh_token === 'string' ? response.refresh_token : previous?.refreshToken,
		expiresAt: Date.now() + expiresIn * 1000,
		scopes: typeof response.scope === 'string' ? response.scope.split(' ').filter(Boolean) : [],
		savedAt: new Date().toISOString(),
	}
}
