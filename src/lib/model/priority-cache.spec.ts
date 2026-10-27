import { beforeEach, describe, expect, it, vi } from 'vitest'
import { browser } from 'wxt/browser'
import {
	PRIORITY_PROMPT_VERSION,
	priorityKeys,
	readPriorityCache,
	savePriorities,
} from './priority-cache'

vi.mock('wxt/browser', () => ({
	browser: { storage: { local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } } },
}))

const SCOPE = 'owner/repo/7'
const MODEL = 'openrouter:model-a'
const SNAPSHOT = { model: 'model-a', priorities: [{ path: 'src/a.ts', priority: 'high' as const }] }
let stored: Record<string, unknown>

beforeEach(() => {
	vi.resetAllMocks()
	stored = {}
	vi.mocked(browser.storage.local.get).mockImplementation(async (key) => ({
		[key as string]: stored[key as string],
	}))
	vi.mocked(browser.storage.local.set).mockImplementation(async (items) => {
		Object.assign(stored, items)
	})
	vi.mocked(browser.storage.local.remove).mockImplementation(async (keys) => {
		for (const key of typeof keys === 'string' ? [keys] : keys) delete stored[key]
	})
})

describe('priority cache identity and retention', () => {
	it('normalizes PR casing and versions the keys independently of grouping', () => {
		const keys = priorityKeys('Owner/Repo/7', 'sha', MODEL)
		expect(keys).toEqual({
			exact: `priorities:${PRIORITY_PROMPT_VERSION}:owner/repo/7:${MODEL}:sha`,
			history: `priorities:${PRIORITY_PROMPT_VERSION}:owner/repo/7:${MODEL}:history`,
		})
		expect(priorityKeys(SCOPE, 'sha', MODEL)).toEqual(keys)
	})

	it.each([
		['owner/repo/8', 'r1', MODEL],
		['owner/other/7', 'r1', MODEL],
		[SCOPE, 'r1', 'openrouter:model-b'],
		[SCOPE, 'r2', MODEL],
	])('does not reuse an answer for %s / %s / %s', async (scope, revision, model) => {
		await savePriorities(SCOPE, 'r1', MODEL, SNAPSHOT)
		await expect(readPriorityCache(scope, revision, model)).resolves.toBeUndefined()
		await expect(readPriorityCache(SCOPE.toUpperCase(), 'r1', MODEL)).resolves.toEqual(SNAPSHOT)
	})

	it('keeps exactly the five newest revisions without evicting another PR or model', async () => {
		await savePriorities('owner/repo/8', 'r1', MODEL, SNAPSHOT)
		await savePriorities(SCOPE, 'r1', 'openrouter:model-b', SNAPSHOT)
		for (let revision = 1; revision <= 7; revision++)
			await savePriorities(SCOPE, `r${revision}`, MODEL, SNAPSHOT)
		const keys = priorityKeys(SCOPE, 'r7', MODEL)
		expect(stored[keys.history]).toEqual(
			['r7', 'r6', 'r5', 'r4', 'r3'].map((digest) => priorityKeys(SCOPE, digest, MODEL).exact),
		)
		for (const revision of ['r1', 'r2'])
			await expect(readPriorityCache(SCOPE, revision, MODEL)).resolves.toBeUndefined()
		for (const revision of ['r3', 'r4', 'r5', 'r6', 'r7'])
			await expect(readPriorityCache(SCOPE, revision, MODEL)).resolves.toEqual(SNAPSHOT)
		await expect(readPriorityCache('owner/repo/8', 'r1', MODEL)).resolves.toEqual(SNAPSHOT)
		await expect(readPriorityCache(SCOPE, 'r1', 'openrouter:model-b')).resolves.toEqual(SNAPSHOT)
	})

	it('refreshes an existing revision without duplicates or premature eviction', async () => {
		for (const digest of ['r1', 'r2', 'r3', 'r4', 'r5'])
			await savePriorities(SCOPE, digest, MODEL, SNAPSHOT)
		const updated = { ...SNAPSHOT, model: 'actual-provider-model' }
		await savePriorities(SCOPE, 'r2', MODEL, updated)
		expect(stored[priorityKeys(SCOPE, 'r2', MODEL).history]).toEqual(
			['r2', 'r5', 'r4', 'r3', 'r1'].map((digest) => priorityKeys(SCOPE, digest, MODEL).exact),
		)
		await expect(readPriorityCache(SCOPE, 'r2', MODEL)).resolves.toEqual(updated)
		expect(browser.storage.local.remove).not.toHaveBeenCalled()
	})
})

describe('concurrent priority saves', () => {
	it('keeps both revisions in the history when two answers are saved at once', async () => {
		await Promise.all([
			savePriorities(SCOPE, 'r1', MODEL, SNAPSHOT),
			savePriorities(SCOPE, 'r2', MODEL, SNAPSHOT),
		])

		expect(stored[priorityKeys(SCOPE, 'r2', MODEL).history]).toEqual(
			['r2', 'r1'].map((digest) => priorityKeys(SCOPE, digest, MODEL).exact),
		)
	})
})

describe('corrupt priority storage', () => {
	it('does not evict storage outside this PR/model when history contains foreign keys', async () => {
		const keys = priorityKeys(SCOPE, 'r6', MODEL)
		const other = priorityKeys('owner/repo/8', 'r1', MODEL).exact
		stored[other] = SNAPSHOT
		stored.settings = { marker: 'protected' }
		stored[keys.history] = [
			...['r5', 'r4', 'r3', 'r2'].map((digest) => priorityKeys(SCOPE, digest, MODEL).exact),
			other,
			'settings',
		]
		await savePriorities(SCOPE, 'r6', MODEL, SNAPSHOT)
		expect({ otherPR: stored[other], settings: stored.settings }).toEqual({
			otherPR: SNAPSHOT,
			settings: { marker: 'protected' },
		})
	})

	it.each([
		undefined,
		null,
		false,
		42,
		'broken',
		{},
		{ priorities: [] },
		{ priorities: 'bad' },
		{
			priorities: [null, { path: 'src/a.ts', priority: 'critical' }],
		},
	])('treats %j as a cache miss', async (value) => {
		stored[priorityKeys(SCOPE, 'r1', MODEL).exact] = value
		await expect(readPriorityCache(SCOPE, 'r1', MODEL)).resolves.toBeUndefined()
	})

	it('salvages valid entries, drops duplicate paths and strips Medium/Low reasons', async () => {
		stored[priorityKeys(SCOPE, 'r1', MODEL).exact] = {
			model: 42,
			priorities: [
				{ path: 'src/a.ts', priority: 'high', reason: '  May charge twice.  ' },
				{ path: 'src/a.ts', priority: 'urgent' },
				{ path: 'src/b.ts', priority: 'medium', reason: 'irrelevant' },
				{ path: 'src/c.ts', priority: 'low', reason: 'irrelevant' },
				{ path: 'unknown.ts', priority: false },
			],
		}
		await expect(readPriorityCache(SCOPE, 'r1', MODEL)).resolves.toEqual({
			priorities: [
				{ path: 'src/a.ts', priority: 'high', reason: 'May charge twice.' },
				{ path: 'src/b.ts', priority: 'medium' },
				{ path: 'src/c.ts', priority: 'low' },
			],
		})
	})

	it.each([null, 'broken', 7, [null, false, 42]])(
		'rebuilds a malformed history %j',
		async (history) => {
			const keys = priorityKeys(SCOPE, 'r1', MODEL)
			stored[keys.history] = history
			await savePriorities(SCOPE, 'r1', MODEL, SNAPSHOT)
			expect(stored[keys.history]).toEqual([keys.exact])
			expect(stored[keys.exact]).toEqual(SNAPSHOT)
			expect(browser.storage.local.remove).not.toHaveBeenCalled()
		},
	)
})
