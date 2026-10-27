import { browser } from 'wxt/browser'
import { type PriorityEntry, toPriorityEntries } from '../priority/schema'

const HISTORY_LIMIT = 5
// Bump when the ranking prompt or its inputs change shape: answers to the old prompt must not be reused.
export const PRIORITY_PROMPT_VERSION = 'r1'

export interface PrioritySnapshot {
	model?: string
	priorities: PriorityEntry[]
}

const prefixOf = (scope: string, labeler: string) =>
	`priorities:${PRIORITY_PROMPT_VERSION}:${scope.toLowerCase()}:${labeler}`

export function priorityKeys(scope: string, digest: string, labeler: string) {
	const prefix = prefixOf(scope, labeler)

	return { exact: `${prefix}:${digest}`, history: `${prefix}:history` }
}

export async function readPriorityCache(
	scope: string,
	digest: string,
	labeler: string,
): Promise<PrioritySnapshot | undefined> {
	const { exact } = priorityKeys(scope, digest, labeler)
	const stored = await browser.storage.local.get(exact)
	const value = stored[exact] as Partial<PrioritySnapshot> | undefined
	const priorities = toPriorityEntries(value?.priorities)

	return priorities
		? { priorities, ...(typeof value?.model === 'string' ? { model: value.model } : {}) }
		: undefined
}

let pending: Promise<unknown> = Promise.resolve()

/**
 * Saves one answer per revision and keeps the last few revisions of a pull request. Saves run one at
 * a time so two revisions answered together cannot drop each other from the history, and eviction
 * only ever touches this pull request's own snapshots, whatever the stored history claims.
 */
export function savePriorities(
	scope: string,
	digest: string,
	labeler: string,
	snapshot: PrioritySnapshot,
): Promise<void> {
	const keys = priorityKeys(scope, digest, labeler)
	const prefix = `${prefixOf(scope, labeler)}:`
	// A revision digest never holds a colon; one after the prefix belongs to a model named longer.
	const isOwnSnapshot = (key: unknown): key is string =>
		typeof key === 'string' &&
		key.startsWith(prefix) &&
		!key.slice(prefix.length).includes(':') &&
		key !== keys.history &&
		key !== keys.exact
	const save = pending.then(async () => {
		const stored = await browser.storage.local.get(keys.history)
		const value = stored[keys.history]
		const history = Array.isArray(value) ? [...new Set(value.filter(isOwnSnapshot))] : []
		const ordered = [keys.exact, ...history]
		await browser.storage.local.set({
			[keys.exact]: snapshot,
			[keys.history]: ordered.slice(0, HISTORY_LIMIT),
		})
		if (ordered.length > HISTORY_LIMIT)
			await browser.storage.local.remove(ordered.slice(HISTORY_LIMIT))
	})
	pending = save.catch(() => undefined)

	return save
}
