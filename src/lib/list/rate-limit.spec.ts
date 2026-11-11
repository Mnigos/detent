import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import {
	createRateLimitPause,
	DEFAULT_PAUSE_MILLISECONDS,
	MAX_PAUSE_MILLISECONDS,
	pauseLength,
	RATE_LIMIT_KEY,
} from './rate-limit'

beforeEach(() => {
	fakeBrowser.reset()
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
})

afterEach(() => {
	vi.useRealTimers()
})

const stored = async () => (await fakeBrowser.storage.local.get(RATE_LIMIT_KEY))[RATE_LIMIT_KEY]

describe('pauseLength', () => {
	it('waits Retry-After or a minute, doubling on repeats up to ten minutes', () => {
		expect(pauseLength(1)).toBe(DEFAULT_PAUSE_MILLISECONDS)
		expect(pauseLength(2)).toBe(2 * DEFAULT_PAUSE_MILLISECONDS)
		expect(pauseLength(3)).toBe(4 * DEFAULT_PAUSE_MILLISECONDS)
		expect(pauseLength(9)).toBe(MAX_PAUSE_MILLISECONDS)
		expect(pauseLength(1, 30_000)).toBe(30_000)
		expect(pauseLength(2, 30_000)).toBe(60_000)
		// GitHub's own wait is never cut short.
		expect(pauseLength(1, 20 * 60_000)).toBe(20 * 60_000)
	})
})

describe('createRateLimitPause', () => {
	it('pauses for the signalled time, stores it for other tabs and resumes once', async () => {
		const resume = vi.fn()
		const pause = await createRateLimitPause(resume)
		expect(pause.isPaused()).toBe(false)

		expect(pause.signal(90_000)).toBe(90_000)
		expect(pause.isPaused()).toBe(true)
		await expect(stored()).resolves.toEqual({ until: Date.now() + 90_000, strikes: 1 })

		await vi.advanceTimersByTimeAsync(89_999)
		expect(resume).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(1)
		expect(resume).toHaveBeenCalledOnce()
		expect(pause.isPaused()).toBe(false)
		pause.stop()
	})

	it('does not stack signals that arrive during a pause, but honours a longer Retry-After', async () => {
		const pause = await createRateLimitPause(vi.fn())
		expect(pause.signal()).toBe(60_000)
		expect(pause.signal()).toBeUndefined()
		expect(pause.signal(30_000)).toBeUndefined()
		expect(pause.isPaused(Date.now() + 60_000)).toBe(false)

		expect(pause.signal(120_000)).toBeUndefined()
		expect(pause.isPaused(Date.now() + 119_999)).toBe(true)
		await expect(stored()).resolves.toMatchObject({ strikes: 1 })
		pause.stop()
	})

	it('backs off on a repeat soon after and starts over after a quiet spell', async () => {
		const pause = await createRateLimitPause(vi.fn())
		expect(pause.signal()).toBe(60_000)
		await vi.advanceTimersByTimeAsync(60_000)
		expect(pause.signal()).toBe(120_000)
		await vi.advanceTimersByTimeAsync(120_000)
		expect(pause.signal()).toBe(240_000)
		await vi.advanceTimersByTimeAsync(240_000 + 10 * 60_000)
		expect(pause.signal()).toBe(60_000)
		pause.stop()
	})

	it('counts a network error shortly after a pause as the same limit', async () => {
		const pause = await createRateLimitPause(vi.fn())
		expect(pause.isThrottled()).toBe(false)
		pause.signal()
		await vi.advanceTimersByTimeAsync(60_000)
		expect(pause.isPaused()).toBe(false)
		expect(pause.isThrottled()).toBe(true)
		await vi.advanceTimersByTimeAsync(60_000)
		expect(pause.isThrottled()).toBe(false)
		pause.stop()
	})

	it('gives a pause started by a network error no grace, so such errors cannot chain pauses', async () => {
		const pause = await createRateLimitPause(vi.fn())
		pause.signal(undefined, true)
		expect(pause.isThrottled()).toBe(true)
		await vi.advanceTimersByTimeAsync(60_000)
		expect(pause.isThrottled()).toBe(false)
		await expect(stored()).resolves.toMatchObject({ inferred: true })

		// GitHub's own answer during an inferred pause brings the grace back.
		pause.signal(undefined, true)
		pause.signal()
		await vi.advanceTimersByTimeAsync(120_000)
		expect(pause.isPaused()).toBe(false)
		expect(pause.isThrottled()).toBe(true)
		pause.stop()
	})

	it("honours another tab's pause, stored before or written while open", async () => {
		await fakeBrowser.storage.local.set({
			[RATE_LIMIT_KEY]: { until: Date.now() + 30_000, strikes: 1 },
		})
		const resume = vi.fn()
		const pause = await createRateLimitPause(resume)
		expect(pause.isPaused()).toBe(true)
		await vi.advanceTimersByTimeAsync(30_000)
		expect(resume).toHaveBeenCalledOnce()

		await fakeBrowser.storage.local.set({
			[RATE_LIMIT_KEY]: { until: Date.now() + 45_000, strikes: 2 },
		})
		expect(pause.isPaused()).toBe(true)
		// The other tab's strike count carries over to this tab's next limit.
		await vi.advanceTimersByTimeAsync(45_000)
		expect(resume).toHaveBeenCalledTimes(2)
		expect(pause.signal()).toBe(4 * DEFAULT_PAUSE_MILLISECONDS)
		pause.stop()
	})

	it('writes its longer pause back when another tab overwrites it with a shorter one', async () => {
		const pause = await createRateLimitPause(vi.fn())
		pause.signal(300_000)
		const until = Date.now() + 300_000
		await fakeBrowser.storage.local.set({
			[RATE_LIMIT_KEY]: { until: Date.now() + 60_000, strikes: 1 },
		})
		await vi.waitFor(async () => expect(stored()).resolves.toEqual({ until, strikes: 1 }))
		expect(pause.isPaused(until - 1)).toBe(true)
		pause.stop()
	})

	it('ignores a malformed or implausibly distant stored pause', async () => {
		await fakeBrowser.storage.local.set({ [RATE_LIMIT_KEY]: { until: 'soon' } })
		const pause = await createRateLimitPause(vi.fn())
		expect(pause.isPaused()).toBe(false)

		await fakeBrowser.storage.local.set({
			[RATE_LIMIT_KEY]: { until: Date.now() + 24 * 60 * 60_000, strikes: 1 },
		})
		expect(pause.isPaused()).toBe(false)
		pause.stop()
	})

	it('stops listening and resuming once stopped', async () => {
		const resume = vi.fn()
		const pause = await createRateLimitPause(resume)
		pause.signal()
		pause.stop()
		await vi.advanceTimersByTimeAsync(60_000)
		expect(resume).not.toHaveBeenCalled()

		await fakeBrowser.storage.local.set({
			[RATE_LIMIT_KEY]: { until: Date.now() + 30_000, strikes: 1 },
		})
		expect(pause.isPaused()).toBe(false)
	})
})
