// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { browser } from 'wxt/browser'
import { ContentScriptContext } from 'wxt/utils/content-script-context'
import { requestPullRequestDiff } from '../diff/fetch-diff'
import { type LabelLayersResponse, requestLayerLabels } from '../model/label-layers'
import { createReviewSession } from './session'

const SESSION_GET = vi.hoisted(() => vi.fn<() => Promise<Record<string, unknown>>>())

vi.mock('wxt/browser', () => ({
	browser: {
		runtime: { id: 'extension-test' },
		storage: { session: { get: SESSION_GET, set: vi.fn() } },
	},
}))
vi.mock('../diff/fetch-diff', () => ({ requestPullRequestDiff: vi.fn() }))
vi.mock('../model/label-layers', () => ({ requestLayerLabels: vi.fn() }))

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
