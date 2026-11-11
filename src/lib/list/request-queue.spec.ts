import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequestQueue, QUEUE_CONCURRENCY, QUEUE_GAP_MILLISECONDS } from './request-queue'

beforeEach(() => {
	vi.useFakeTimers()
})

afterEach(() => {
	vi.useRealTimers()
	vi.unstubAllGlobals()
})

// A task that records when it started and settles when the test says so.
function controlledTasks() {
	const started: { name: string; at: number }[] = []
	const finish = new Map<string, () => void>()
	const task = (name: string) => () =>
		new Promise<string>((resolve) => {
			started.push({ name, at: Date.now() })
			finish.set(name, () => resolve(name))
		})

	return { started, finish, task }
}

describe('createRequestQueue', () => {
	it('runs three requests at once, 150 ms apart, in the order they were queued', async () => {
		expect([QUEUE_CONCURRENCY, QUEUE_GAP_MILLISECONDS]).toEqual([3, 150])
		const queue = createRequestQueue()
		const { started, finish, task } = controlledTasks()
		const t0 = Date.now()
		const results = ['a', 'b', 'c', 'd', 'e'].map((name) => queue.run(task(name)))

		await vi.advanceTimersByTimeAsync(1000)
		expect(started.map(({ name, at }) => [name, at - t0])).toEqual([
			['a', 0],
			['b', 150],
			['c', 300],
		])

		finish.get('b')?.()
		await vi.advanceTimersByTimeAsync(0)
		expect(started.map(({ name }) => name)).toEqual(['a', 'b', 'c', 'd'])
		finish.get('a')?.()
		await vi.advanceTimersByTimeAsync(0)
		// The slot is free, but the start before it was less than 150 ms ago.
		expect(started).toHaveLength(4)
		await vi.advanceTimersByTimeAsync(QUEUE_GAP_MILLISECONDS)
		expect(started.map(({ name }) => name)).toEqual(['a', 'b', 'c', 'd', 'e'])

		for (const name of ['c', 'd', 'e']) finish.get(name)?.()
		await expect(Promise.all(results)).resolves.toEqual(['a', 'b', 'c', 'd', 'e'])
	})

	it('frees the slot of a request that fails', async () => {
		const queue = createRequestQueue({ concurrency: 1, gapMilliseconds: 0 })
		const failed = queue.run(async () => {
			throw new Error('boom')
		})
		const next = queue.run(async () => 'next')

		await expect(failed).rejects.toThrow('boom')
		await expect(next).resolves.toBe('next')
	})

	it('shares one running task per key, as when two tabs ask for the same pull request', async () => {
		const queue = createRequestQueue()
		const { started, finish, task } = controlledTasks()
		const first = queue.shared('diff:o/r/1', () => queue.run(task('one')))
		const second = queue.shared('diff:o/r/1', () => queue.run(task('two')))
		const other = queue.shared('diff:o/r/2', () => queue.run(task('other')))
		await vi.advanceTimersByTimeAsync(500)

		expect(second).toBe(first)
		expect(started.map(({ name }) => name)).toEqual(['one', 'other'])
		finish.get('one')?.()
		finish.get('other')?.()
		await expect(Promise.all([first, second, other])).resolves.toEqual(['one', 'one', 'other'])

		// Once settled, the key is asked again.
		const again = queue.shared('diff:o/r/1', () => queue.run(task('again')))
		await vi.advanceTimersByTimeAsync(500)
		finish.get('again')?.()
		await expect(again).resolves.toBe('again')
	})

	it('sends fetch requests through the queue', async () => {
		const fetch = vi.fn(async () => new Response('ok'))
		vi.stubGlobal('fetch', fetch)
		const queue = createRequestQueue()
		const response = queue.send('https://github.com/o/r/pull/1.diff', { credentials: 'include' })
		await vi.advanceTimersByTimeAsync(0)

		await expect((await response).text()).resolves.toBe('ok')
		expect(fetch).toHaveBeenCalledWith('https://github.com/o/r/pull/1.diff', {
			credentials: 'include',
		})
	})
})
