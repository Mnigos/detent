// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { browser } from 'wxt/browser'
import { ContentScriptContext } from 'wxt/utils/content-script-context'
import { requestPullRequestDiff } from '../diff/fetch-diff'
import { type LabelLayersResponse, requestLayerLabels } from '../model/label-layers'
import { requestPriorities } from '../model/label-priorities'
import { createReviewSession } from './session'
import { currentFile, viewModeOf } from './store'

const SESSION_GET = vi.hoisted(() => vi.fn<() => Promise<Record<string, unknown>>>())

vi.mock('wxt/browser', () => ({
	browser: {
		runtime: { id: 'extension-test' },
		storage: { session: { get: SESSION_GET, set: vi.fn() } },
	},
}))
vi.mock('../diff/fetch-diff', () => ({ requestPullRequestDiff: vi.fn() }))
vi.mock('../model/label-layers', () => ({ requestLayerLabels: vi.fn() }))
vi.mock('../model/label-priorities', () => ({ requestPriorities: vi.fn() }))
vi.mock('./github-dom', async (importOriginal) => ({
	...(await importOriginal<typeof import('./github-dom')>()),
	fetchPullRequestBody: vi.fn(async () => ''),
}))

const RESPONSE: LabelLayersResponse = {
	layers: [],
	labeler: 'openrouter',
	model: 'test',
	source: 'model',
	grouping: [
		{
			name: 'Saved layer',
			summary: 'Saved summary.',
			files: ['src/entitlement.repository.ts', 'src/renew.handler.ts'],
		},
	],
}
let ctx: ContentScriptContext

beforeEach(() => {
	vi.resetAllMocks()
	vi.mocked(requestPullRequestDiff).mockResolvedValue(
		readFileSync(resolve(process.cwd(), 'fixtures/provider-lock.diff'), 'utf8'),
	)
	SESSION_GET.mockResolvedValue({})
	vi.mocked(browser.storage.session.set).mockResolvedValue(undefined)
	ctx = new ContentScriptContext('session-spec')
})
afterEach(() => {
	ctx.abort()
})

describe('review session cache integration', () => {
	it.each(['priority', 'files'] as const)(
		'round-trips %s mode and the selected path through PR session storage',
		async (mode) => {
			const saved: Record<string, unknown> = {}
			SESSION_GET.mockImplementation(async () => structuredClone(saved))
			vi.mocked(browser.storage.session.set).mockImplementation(async (values) => {
				Object.assign(saved, structuredClone(values))
			})
			vi.mocked(requestLayerLabels).mockResolvedValue(RESPONSE)
			const location = { owner: 'Owner', repo: 'Repo', number: 7, tab: 'changes' } as const
			const first = await createReviewSession(ctx, location, () => new Set(), {
				withPriorities: true,
			})
			first.store.dispatch({ type: 'set-mode', mode: 'priority' })
			const path = 'src/renew.handler.ts'
			const sections = first.store.getSnapshot().layers
			const layerIndex = sections.findIndex((section) =>
				section.files.some((file) => file.path === path),
			)
			const fileIndex = sections[layerIndex]?.files.findIndex((file) => file.path === path) ?? -1
			expect(layerIndex).toBeGreaterThanOrEqual(0)
			expect(fileIndex).toBeGreaterThanOrEqual(0)
			first.store.dispatch({ type: 'select', layerIndex, fileIndex })
			first.store.dispatch({ type: 'set-mode', mode })
			expect(saved['panel:owner/repo/7']).toEqual({
				layerIndex,
				fileIndex,
				path,
				isPriority: true,
				isRaw: mode === 'files',
				isCollapsed: false,
			})
			first.stop()
			const restored = await createReviewSession(ctx, location, () => new Set(), {
				withPriorities: true,
			})
			expect(viewModeOf(restored.store.getSnapshot())).toBe(mode)
			expect(currentFile(restored.store.getSnapshot())?.path).toBe(path)
			if (mode === 'files') {
				restored.store.dispatch({ type: 'toggle-raw' })
				expect(viewModeOf(restored.store.getSnapshot())).toBe('priority')
				expect(currentFile(restored.store.getSnapshot())?.path).toBe(path)
			}
			expect(requestPriorities).not.toHaveBeenCalled()
			restored.stop()
		},
	)

	it('offers a separate lazy priority request and discards its result after stop', async () => {
		vi.mocked(requestLayerLabels).mockResolvedValue(RESPONSE)
		let finish!: (response: Awaited<ReturnType<typeof requestPriorities>>) => void
		vi.mocked(requestPriorities).mockReturnValue(
			new Promise((resolve) => {
				finish = resolve
			}),
		)
		const session = await createReviewSession(
			ctx,
			{ owner: 'owner', repo: 'repo', number: 1, tab: 'changes' },
			() => new Set(),
			{ withPriorities: true },
		)
		expect(requestPriorities).not.toHaveBeenCalled()
		expect(session.requestPriorities).toBeTypeOf('function')
		session.requestPriorities?.()
		session.requestPriorities?.()
		expect(requestPriorities).toHaveBeenCalledTimes(1)
		expect(requestPriorities).toHaveBeenCalledWith(
			expect.objectContaining({ scope: 'owner/repo/1', digest: expect.any(String) }),
		)
		const before = session.store.getSnapshot()
		session.stop()
		finish({ source: 'fallback', labeler: 'none' })
		await Promise.resolve()
		await Promise.resolve()
		expect(session.store.getSnapshot()).toBe(before)
	})

	it('reports an interrupted analysis when the worker never answers', async () => {
		vi.mocked(requestLayerLabels).mockResolvedValue(undefined)
		const session = await createReviewSession(
			ctx,
			{ owner: 'owner', repo: 'repo', number: 1, tab: 'changes' },
			() => new Set(),
		)
		await vi.waitFor(() =>
			expect(session.store.getSnapshot().status).toContain('did not come back'),
		)
		expect(session.store.getSnapshot().isAnalyzing).toBe(false)
	})

	it('keeps the grouping layers when the analysis is interrupted while Priority Review is shown', async () => {
		let finish!: (response: LabelLayersResponse | undefined) => void
		vi.mocked(requestLayerLabels)
			.mockResolvedValueOnce(undefined)
			.mockReturnValueOnce(
				new Promise((resolve) => {
					finish = resolve
				}),
			)
		const session = await createReviewSession(
			ctx,
			{ owner: 'owner', repo: 'repo', number: 1, tab: 'changes' },
			() => new Set(),
			{ withPriorities: true },
		)
		const { groupLayers, priorityLayers } = session.store.getSnapshot()
		session.store.dispatch({ type: 'set-mode', mode: 'priority' })
		finish(undefined)
		await vi.waitFor(() =>
			expect(session.store.getSnapshot().status).toContain('did not come back'),
		)
		expect(session.store.getSnapshot().groupLayers).toBe(groupLayers)
		expect(session.store.getSnapshot().layers).toBe(priorityLayers)
		session.store.dispatch({ type: 'set-mode', mode: 'layers' })
		expect(session.store.getSnapshot().layers).toBe(groupLayers)
	})

	it('starts with cached groups and saved file selection without mounting a fallback first', async () => {
		vi.mocked(requestLayerLabels).mockResolvedValue(RESPONSE)
		SESSION_GET.mockResolvedValue({
			'panel:owner/repo/1': {
				path: 'src/renew.handler.ts',
				layerIndex: 5,
				fileIndex: 8,
			},
		})
		const session = await createReviewSession(
			ctx,
			{ owner: 'owner', repo: 'repo', number: 1, tab: 'changes' },
			() => new Set(),
		)
		expect(session.store.getSnapshot()).toMatchObject({
			layerIndex: 0,
			fileIndex: 1,
			layers: [{ name: 'Saved layer' }],
		})
		expect(requestLayerLabels).toHaveBeenCalledTimes(1)
		expect(requestLayerLabels).toHaveBeenCalledWith(
			expect.objectContaining({ scope: 'owner/repo/1', cacheOnly: true }),
		)
		session.stop()
	})

	it('shows previous groups while one update runs and keeps the selected path after the update', async () => {
		let finish: ((value: LabelLayersResponse) => void) | undefined
		vi.mocked(requestLayerLabels)
			.mockResolvedValueOnce({ ...RESPONSE, isStale: true })
			.mockReturnValueOnce(
				new Promise((resolve) => {
					finish = resolve
				}),
			)
		const session = await createReviewSession(
			ctx,
			{ owner: 'owner', repo: 'repo', number: 1, tab: 'changes' },
			() => new Set(),
		)
		expect(session.store.getSnapshot().layers[0]?.name).toBe('Saved layer')
		expect(session.store.getSnapshot().status).toContain('updating changed files')
		session.store.dispatch({ type: 'select', layerIndex: 0, fileIndex: 1 })
		finish?.({
			...RESPONSE,
			grouping: [
				{
					name: 'Updated layer',
					summary: '',
					files: ['src/renew.handler.ts', 'src/entitlement.repository.ts'],
				},
			],
		})
		await vi.waitFor(() =>
			expect(session.store.getSnapshot().layers[0]?.name).toBe('Updated layer'),
		)
		expect(
			session.store.getSnapshot().layers[0]?.files[session.store.getSnapshot().fileIndex]?.path,
		).toBe('src/renew.handler.ts')
		expect(requestLayerLabels).toHaveBeenCalledTimes(2)
		session.stop()
	})
})
