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

/**
 * `until` is a wall clock time, so other tabs can read it; `strikes` counts limits in a row. `inferred` marks a pause
 * started only by a network error, which never earns the grace after it, so such errors cannot pause the list forever.
 */
export interface RateLimitState {
	until: number
	strikes: number
	inferred?: true
}

const isState = (value: unknown): value is RateLimitState =>
	typeof value === 'object' &&
	value !== null &&
	typeof (value as RateLimitState).until === 'number' &&
	typeof (value as RateLimitState).strikes === 'number'

const pauseState = (until: number, strikes: number, inferred: boolean): RateLimitState =>
	inferred ? { until, strikes, inferred } : { until, strikes }

/** Whether a stored pause, of any tab, is running now. For callers outside the list, such as the service worker. */
export async function isRateLimitPaused(now = Date.now()) {
	try {
		const stored = (await browser.storage.local.get(RATE_LIMIT_KEY))[RATE_LIMIT_KEY]

		return isState(stored) && now < stored.until && stored.until <= now + MAX_STORED_MILLISECONDS
	} catch {
		return false
	}
}

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

	function store() {
		browser.storage.local
			.set({ [RATE_LIMIT_KEY]: state })
			.catch((error: unknown) => console.warn('[detent]', error))
	}

	// Tabs write without a lock, so a tab that signalled a shorter pause at the same moment can overwrite a longer
	// one; a tab still holding the longer pause writes it back, and every tab ends on the latest deadline.
	const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
		if (area !== 'local' || !changes[RATE_LIMIT_KEY]) return

		const next = changes[RATE_LIMIT_KEY].newValue
		if (Date.now() < state.until && !(isState(next) && next.until >= state.until)) store()
		else adopt(next)
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
		isThrottled: (now = Date.now()) =>
			now < state.until + (state.inferred ? 0 : THROTTLED_GRACE_MILLISECONDS),
		/**
		 * Starts a pause, or makes a running one last until Retry-After. `isInferred`: the signal is a network error
		 * taken for the limit, not GitHub's answer. Returns the new pause's length when this signal started one,
		 * undefined when a pause was already running.
		 */
		signal(retryAfterMilliseconds?: number, isInferred = false) {
			const now = Date.now()
			let started: number | undefined
			if (now < state.until) {
				const until = Math.max(state.until, now + (retryAfterMilliseconds ?? 0))
				const inferred = Boolean(state.inferred) && isInferred
				if (until === state.until && inferred === Boolean(state.inferred)) return undefined
				state = pauseState(until, state.strikes, inferred)
			} else {
				const strikes = now < state.until + REPEAT_WINDOW_MILLISECONDS ? state.strikes + 1 : 1
				started = pauseLength(strikes, retryAfterMilliseconds)
				state = pauseState(now + started, strikes, isInferred)
			}
			schedule()
			store()

			return started
		},
		stop() {
			clearTimeout(timer)
			timer = undefined
			browser.storage.onChanged.removeListener(listener)
		},
	}
}
