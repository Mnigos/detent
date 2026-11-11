export const QUEUE_CONCURRENCY = 3
export const QUEUE_GAP_MILLISECONDS = 150

/** Sends one HTTP request; the queue's `send` has fetch's shape so request code can take either. */
export type Send = (url: string, init?: RequestInit) => Promise<Response>

/**
 * The service worker's single queue for list requests, shared by every tab. At most `concurrency` requests run at
 * once and two starts are at least `gapMilliseconds` apart; waiting requests start in the order they were queued.
 * `shared` runs one task per key: a tab asking for a key another tab is already loading gets the same promise.
 */
export function createRequestQueue({
	concurrency = QUEUE_CONCURRENCY,
	gapMilliseconds = QUEUE_GAP_MILLISECONDS,
} = {}) {
	const waiting: (() => void)[] = []
	const inFlight = new Map<string, Promise<unknown>>()
	let active = 0
	let lastStart = Number.NEGATIVE_INFINITY
	let timer: ReturnType<typeof setTimeout> | undefined

	function next() {
		if (timer !== undefined || active >= concurrency || waiting.length === 0) return

		const wait = lastStart + gapMilliseconds - Date.now()
		if (wait > 0) {
			timer = setTimeout(() => {
				timer = undefined
				next()
			}, wait)
			return
		}
		lastStart = Date.now()
		active += 1
		;(waiting.shift() as () => void)()
		next()
	}

	function run<T>(task: () => Promise<T>): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			waiting.push(() => {
				task()
					.then(resolve, reject)
					.finally(() => {
						active -= 1
						next()
					})
			})
			next()
		})
	}

	function shared<T>(key: string, task: () => Promise<T>): Promise<T> {
		const running = inFlight.get(key)
		if (running) return running as Promise<T>

		const promise = task().finally(() => inFlight.delete(key))
		inFlight.set(key, promise)

		return promise
	}

	return {
		run,
		shared,
		/** fetch through the queue. */
		send: ((url, init) => run(() => fetch(url, init))) satisfies Send,
	}
}
