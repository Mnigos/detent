import { browser } from 'wxt/browser'

// Shared by every tab: one tab's rate limit pauses the lists in the others too.
export const RATE_LIMIT_KEY = 'rateLimitedUntil'
export const DEFAULT_PAUSE_MILLISECONDS = 60_000
export const MAX_PAUSE_MILLISECONDS = 10 * 60_000
// A limit that comes back this soon after the last pause ended is a repeat and doubles the pause.
const REPEAT_WINDOW_MILLISECONDS = 10 * 60_000
// A network error this soon after a pause is the same limit: a 429 without CORS headers reads as one.
const THROTTLED_GRACE_MILLISECONDS = 60_000
// A stored pause further out than this comes from a changed wall clock, not from GitHub.
const MAX_STORED_MILLISECONDS = 60 * 60_000

/** `until` is a wall clock time, so other tabs can read it; `strikes` counts limits in a row. */
export interface RateLimitState {
	until: number
	strikes: number
}

const isState = (value: unknown): value is RateLimitState =>
	typeof value === 'object' &&
	value !== null &&
	typeof (value as RateLimitState).until === 'number' &&
	typeof (value as RateLimitState).strikes === 'number'

/** Retry-After, or a minute, doubled for every repeat up to ten minutes; a longer Retry-After always wins. */
export const pauseLength = (strikes: number, retryAfterMilliseconds?: number) =>
	Math.max(
		retryAfterMilliseconds ?? 0,
		Math.min(
			MAX_PAUSE_MILLISECONDS,
			(retryAfterMilliseconds ?? DEFAULT_PAUSE_MILLISECONDS) * 2 ** (strikes - 1),
		),
	)

/**
 * The list's pause for GitHub rate limits, kept in `chrome.storage.local` so every tab honours it. `onResume` runs
 * once the pause is over, whichever tab started it.
 */
export async function createRateLimitPause(onResume: () => void) {
	let state: RateLimitState = { until: 0, strikes: 0 }
	let timer: ReturnType<typeof setTimeout> | undefined

	function schedule() {
		clearTimeout(timer)
		timer = undefined
		const wait = state.until - Date.now()
		if (wait <= 0) return

		timer = setTimeout(() => {
			timer = undefined
			if (Date.now() < state.until) schedule()
			else onResume()
		}, wait)
	}

	// A pause only ever grows: a later or own write never shortens the one already honoured.
	function adopt(next: unknown) {
		if (!isState(next) || next.until <= state.until) return
		if (next.until > Date.now() + MAX_STORED_MILLISECONDS) return

		state = next
		schedule()
	}

	const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
		if (area === 'local' && changes[RATE_LIMIT_KEY]) adopt(changes[RATE_LIMIT_KEY].newValue)
	}
	adopt(
		await browser.storage.local
			.get(RATE_LIMIT_KEY)
			.then((stored) => stored[RATE_LIMIT_KEY])
			.catch(() => undefined),
	)
	browser.storage.onChanged.addListener(listener)

	return {
		isPaused: (now = Date.now()) => now < state.until,
		isThrottled: (now = Date.now()) => now < state.until + THROTTLED_GRACE_MILLISECONDS,
		/**
		 * Starts a pause, or makes a running one last until Retry-After. Returns the new pause's length when this
		 * signal started one, undefined when a pause was already running.
		 */
		signal(retryAfterMilliseconds?: number) {
			const now = Date.now()
			let started: number | undefined
			if (now < state.until) {
				if (retryAfterMilliseconds === undefined || now + retryAfterMilliseconds <= state.until)
					return undefined
				state = { ...state, until: now + retryAfterMilliseconds }
			} else {
				const strikes = now < state.until + REPEAT_WINDOW_MILLISECONDS ? state.strikes + 1 : 1
				started = pauseLength(strikes, retryAfterMilliseconds)
				state = { until: now + started, strikes }
			}
			schedule()
			browser.storage.local
				.set({ [RATE_LIMIT_KEY]: state })
				.catch((error: unknown) => console.warn('[detent]', error))

			return started
		},
		stop() {
			clearTimeout(timer)
			timer = undefined
			browser.storage.onChanged.removeListener(listener)
		},
	}
}
