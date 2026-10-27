import { beforeEach, describe, expect, it, vi } from 'vitest'
import { browser } from 'wxt/browser'
import { analysisKeys } from './analysis-cache'
import {
	LABEL_LAYERS_MESSAGE,
	type LabelLayersRequest,
	requestLayerLabels,
	resolveLayerLabels,
} from './label-layers'
import { groupLayersWithOpenRouter } from './openrouter'
import { recordUsage } from './usage'

vi.mock('wxt/browser', () => ({
	browser: {
		runtime: { sendMessage: vi.fn(), getPlatformInfo: vi.fn(async () => ({})) },
		storage: { local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } },
	},
}))
vi.mock('./openrouter', () => ({ groupLayersWithOpenRouter: vi.fn(), timeoutFor: () => 20_000 }))
vi.mock('./usage', () => ({ recordUsage: vi.fn(async () => undefined) }))

const MODEL = 'test-model'
const GROUPING = [{ name: 'Read locking', summary: 'Start here.', files: ['src/lock.ts'] }]
let stored: Record<string, unknown>
let request: LabelLayersRequest
let scenario = 0

beforeEach(() => {
	vi.resetAllMocks()
	stored = { settings: { openRouterKey: 'test-key', model: MODEL } }
	request = {
		type: LABEL_LAYERS_MESSAGE,
		scope: `owner/repo/${++scenario}`,
		digest: 'revision-a',
		files: [{ path: 'src/lock.ts', digest: 'lock-a' }],
		maxLayers: 3,
		groupingInput: 'grouping',
	}
	vi.mocked(browser.storage.local.get).mockImplementation(async (keys) => {
		const selected =
			typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(stored)
		return Object.fromEntries(selected.map((key) => [key, stored[key]]))
	})
	vi.mocked(browser.storage.local.set).mockImplementation(async (items) => {
		Object.assign(stored, items)
	})
	vi.mocked(browser.storage.local.remove).mockImplementation(async (keys) => {
		for (const key of typeof keys === 'string' ? [keys] : keys) delete stored[key]
	})
	vi.mocked(groupLayersWithOpenRouter).mockResolvedValue({ layers: GROUPING })
})

describe('analysis cache', () => {
	it('reuses a saved result on refresh and after a worker restart', async () => {
		const first = await resolveLayerLabels(request)
		const second = await resolveLayerLabels({ ...request, groupingInput: 'new build prompt' })
		expect(second?.grouping).toEqual(first?.grouping)
		vi.resetModules()
		const restarted = await import('./label-layers')
		expect((await restarted.resolveLayerLabels(request))?.grouping).toEqual(GROUPING)
		expect(groupLayersWithOpenRouter).toHaveBeenCalledTimes(1)
	})

	it('shares one running model request between concurrent refreshes', async () => {
		let finish: ((value: { layers: typeof GROUPING }) => void) | undefined
		vi.mocked(groupLayersWithOpenRouter).mockReturnValue(
			new Promise((resolve) => {
				finish = resolve
			}),
		)
		const first = resolveLayerLabels(request)
		const second = resolveLayerLabels(request)
		await vi.waitFor(() => expect(groupLayersWithOpenRouter).toHaveBeenCalledTimes(1))
		finish?.({ layers: GROUPING })
		const results = await Promise.all([first, second])
		expect(results[0]).toEqual(results[1])
	})

	it('returns saved groups without starting a model request when mounting a changed revision', async () => {
		await resolveLayerLabels(request)
		const result = await resolveLayerLabels({ ...request, digest: 'revision-b', cacheOnly: true })
		expect(result).toMatchObject({ grouping: GROUPING, isStale: true })
		expect(groupLayersWithOpenRouter).toHaveBeenCalledTimes(1)
	})

	it('does not reanalyze a new revision with identical per-file changes', async () => {
		await resolveLayerLabels(request)
		expect(
			(await resolveLayerLabels({ ...request, digest: 'new-commit-same-changes' }))?.grouping,
		).toEqual(GROUPING)
		expect(groupLayersWithOpenRouter).toHaveBeenCalledTimes(1)
	})

	it('updates the affected layer and preserves unrelated layer names, order and files', async () => {
		const initial = [
			...GROUPING,
			{ name: 'Read UI', summary: 'Keep this.', files: ['web/page.tsx'] },
		]
		request.files.push({ path: 'web/page.tsx', digest: 'page-a' })
		vi.mocked(groupLayersWithOpenRouter).mockResolvedValueOnce({ layers: initial })
		await resolveLayerLabels(request)
		vi.mocked(groupLayersWithOpenRouter).mockResolvedValueOnce({
			layers: [
				{ name: 'Read locking', summary: 'Updated locking.', files: ['src/lock.ts'] },
				{ name: 'Unwanted rename', summary: 'Ignore.', files: ['web/page.tsx'] },
			],
		})
		const result = await resolveLayerLabels({
			...request,
			digest: 'revision-b',
			files: [
				{ path: 'src/lock.ts', digest: 'lock-b' },
				{ path: 'web/page.tsx', digest: 'page-a' },
			],
		})
		expect(result?.grouping).toEqual([
			{ name: 'Read locking', summary: 'Updated locking.', files: ['src/lock.ts'] },
			initial[1],
		])
		expect(groupLayersWithOpenRouter).toHaveBeenLastCalledWith(
			expect.objectContaining({ input: expect.stringContaining('Previous analysis:') }),
		)
	})

	it('keeps a later revision as the update baseline if an older job finishes last', async () => {
		let finishOld: ((value: { layers: typeof GROUPING }) => void) | undefined
		vi.mocked(groupLayersWithOpenRouter).mockReturnValueOnce(
			new Promise((resolve) => {
				finishOld = resolve
			}),
		)
		const oldJob = resolveLayerLabels(request)
		await vi.waitFor(() => expect(groupLayersWithOpenRouter).toHaveBeenCalledTimes(1))
		const newer = {
			...request,
			digest: 'revision-b',
			files: [{ path: 'src/lock.ts', digest: 'lock-b' }],
		}
		await resolveLayerLabels(newer)
		finishOld?.({ layers: GROUPING })
		await oldJob
		expect(stored[analysisKeys(request, `openrouter:${MODEL}`).latest]).toMatchObject({
			digest: 'revision-b',
		})
	})

	it('keeps saved groups on an update failure and suppresses immediate repeated attempts', async () => {
		await resolveLayerLabels(request)
		vi.mocked(groupLayersWithOpenRouter).mockResolvedValue({ error: { kind: 'timeout' } })
		const newer = {
			...request,
			digest: 'revision-b',
			files: [{ path: 'src/lock.ts', digest: 'lock-b' }],
		}
		expect(await resolveLayerLabels(newer)).toMatchObject({
			grouping: GROUPING,
			isStale: true,
			error: { kind: 'timeout' },
		})
		await resolveLayerLabels(newer)
		expect(groupLayersWithOpenRouter).toHaveBeenCalledTimes(2)
		expect(stored[analysisKeys(newer, `openrouter:${MODEL}`).exact]).toBeUndefined()
	})

	it('reports storage failures instead of silently claiming persistence', async () => {
		vi.mocked(browser.storage.local.set).mockRejectedValue(new Error('Quota exceeded'))
		expect(await resolveLayerLabels(request)).toMatchObject({
			grouping: GROUPING,
			cacheError: true,
		})
	})

	it('isolates repositories and selected models', async () => {
		await resolveLayerLabels(request)
		await resolveLayerLabels({ ...request, scope: 'other/repo/1' })
		stored.settings = { openRouterKey: 'test-key', model: 'another-model' }
		await resolveLayerLabels(request)
		expect(groupLayersWithOpenRouter).toHaveBeenCalledTimes(3)
	})

	it('gives the model the file list followed by the diff excerpts', async () => {
		const hosted = {
			...request,
			diffExcerpts: { 'src/lock.ts': '### src/lock.ts\n+lock()', 'src/other.ts': '### other' },
		}
		await resolveLayerLabels(hosted)
		const call = vi.mocked(groupLayersWithOpenRouter).mock.calls[0]?.[0]
		expect(call?.input.startsWith('grouping\n\n## Diff\n\n### src/lock.ts')).toBe(true)
		expect(call?.input).toContain('### other')
	})

	it('maps @number answers back to paths with the ids of the prompt', async () => {
		vi.mocked(groupLayersWithOpenRouter).mockResolvedValue({
			layers: [{ name: 'Read locking', summary: 'Start here.', files: ['@1'] }],
		})
		const response = await resolveLayerLabels({
			...request,
			groupingInput: 'Pull request: T\n\n- src/lock.ts [server] +1/-0 @1',
		})
		expect(response?.grouping).toEqual(GROUPING)
	})

	it('records the usage of every answer and reports the cost of a fresh one only', async () => {
		const usage = { promptTokens: 10, completionTokens: 2, cost: 0.002 }
		vi.mocked(groupLayersWithOpenRouter).mockResolvedValue({ layers: GROUPING, usage })
		expect((await resolveLayerLabels(request))?.cost).toBe(0.002)
		expect(recordUsage).toHaveBeenCalledWith(usage)
		expect((await resolveLayerLabels(request))?.cost).toBeUndefined()
		expect(recordUsage).toHaveBeenCalledTimes(1)
	})

	it('asks nothing and caches nothing without an OpenRouter key', async () => {
		stored.settings = { openRouterKey: '', model: MODEL }
		expect(await resolveLayerLabels({ ...request, cacheOnly: true })).toBeUndefined()
		expect(await resolveLayerLabels(request)).toEqual({
			layers: [],
			source: 'fallback',
			labeler: 'none',
		})
		expect(groupLayersWithOpenRouter).not.toHaveBeenCalled()
		expect(Object.keys(stored)).toEqual(['settings'])
	})

	it('sends the revision identity and file fingerprints to the worker', async () => {
		vi.mocked(browser.runtime.sendMessage).mockResolvedValue(undefined)
		expect(await requestLayerLabels(request)).toBeUndefined()
		expect(browser.runtime.sendMessage).toHaveBeenCalledWith(request)
	})
})

it('promotes a cached revision over an older in-flight update, including cache-only mounts', async () => {
	await resolveLayerLabels(request)
	let finish: ((value: { layers: typeof GROUPING }) => void) | undefined
	vi.mocked(groupLayersWithOpenRouter).mockReturnValueOnce(
		new Promise((resolve) => {
			finish = resolve
		}),
	)
	const work = resolveLayerLabels({
		...request,
		digest: 'older',
		files: [{ path: 'src/lock.ts', digest: 'older' }],
	})
	await vi.waitFor(() => expect(groupLayersWithOpenRouter).toHaveBeenCalledTimes(2))
	await resolveLayerLabels({ ...request, cacheOnly: true })
	finish?.({ layers: GROUPING })
	await work
	expect(stored[analysisKeys(request, `openrouter:${MODEL}`).latest]).toMatchObject({
		digest: request.digest,
	})
})

it('retains five recent revisions without evicting another PR or model', async () => {
	await resolveLayerLabels({ ...request, scope: 'protected/repo/1' })
	const protectedKeys = Object.keys(stored)
	for (let index = 0; index < 8; index++)
		await resolveLayerLabels({ ...request, digest: `version-${index}` })
	const keys = analysisKeys(request, `openrouter:${MODEL}`)
	expect(stored[keys.history]).toHaveLength(5)
	expect(stored[keys.latest]).toMatchObject({ digest: 'version-7' })
	expect(
		stored[analysisKeys({ ...request, digest: 'version-0' }, `openrouter:${MODEL}`).exact],
	).toBeUndefined()
	for (const key of protectedKeys) expect(stored[key]).toBeDefined()
})

it('does not persist a model response containing only unknown paths', async () => {
	vi.mocked(groupLayersWithOpenRouter).mockResolvedValue({
		layers: [{ name: 'Invalid', summary: '', files: ['unknown.ts'] }],
	})
	expect(await resolveLayerLabels(request)).toMatchObject({
		source: 'fallback',
		error: { kind: 'invalid' },
	})
	expect(stored[analysisKeys(request, `openrouter:${MODEL}`).exact]).toBeUndefined()
})

it('asks for the split of an oversized step and merges the pieces in its place', async () => {
	const paths = Array.from({ length: 50 }, (_, index) => `apps/web/src/f${index}.ts`)
	request.files = paths.map((path) => ({ path, digest: 'a' }))
	request.groupingInput = `T\n\n${paths.map((path, index) => `- ${path} [ui] +1/-0 @${index + 1}`).join('\n')}`
	vi.mocked(groupLayersWithOpenRouter)
		.mockResolvedValueOnce({
			layers: [{ name: 'Wire everything', summary: 'Big.', files: paths }],
		})
		.mockResolvedValueOnce({
			layers: [
				{ name: 'Wire the first half', summary: 'A.', files: paths.slice(0, 25) },
				{ name: 'Wire the second half', summary: 'B.', files: paths.slice(25) },
			],
		})
	const result = await resolveLayerLabels(request)
	expect(result?.grouping?.map((group) => [group.name, group.files.length])).toEqual([
		['Wire the first half', 25],
		['Wire the second half', 25],
	])
	const splitPrompt = vi.mocked(groupLayersWithOpenRouter).mock.calls[1]?.[0]?.input ?? ''
	expect(splitPrompt).toContain('Split the step "Wire everything"')
	expect(groupLayersWithOpenRouter).toHaveBeenCalledTimes(2)
})

it('splits an oversized step saved earlier on the next visit, then leaves the revision alone', async () => {
	const paths = Array.from({ length: 50 }, (_, index) => `apps/web/src/f${index}.ts`)
	request.files = paths.map((path) => ({ path, digest: 'a' }))
	request.groupingInput = `T\n\n${paths.map((path, index) => `- ${path} [ui] +1/-0 @${index + 1}`).join('\n')}`
	stored[analysisKeys(request, `openrouter:${MODEL}`).exact] = {
		digest: request.digest,
		files: request.files,
		response: {
			source: 'model',
			labeler: 'openrouter',
			layers: [],
			grouping: [{ name: 'Wire everything', summary: 'Big.', files: paths }],
			groupingChecked: true,
		},
	}
	vi.mocked(groupLayersWithOpenRouter).mockResolvedValue({
		layers: [
			{ name: 'Wire the first half', summary: 'A.', files: paths.slice(0, 25) },
			{ name: 'Wire the second half', summary: 'B.', files: paths.slice(25) },
		],
	})
	expect((await resolveLayerLabels(request))?.grouping?.map((group) => group.name)).toEqual([
		'Wire the first half',
		'Wire the second half',
	])
	expect(groupLayersWithOpenRouter).toHaveBeenCalledTimes(1)
	await resolveLayerLabels(request)
	expect(groupLayersWithOpenRouter).toHaveBeenCalledTimes(1)
})

it('does not silently append omitted UI files to a contracts group', async () => {
	request.files = [
		{ path: 'packages/chat/chat.types.ts', digest: 'a' },
		{ path: 'apps/admin/PlanCard.tsx', digest: 'a' },
	]
	vi.mocked(groupLayersWithOpenRouter).mockResolvedValue({
		layers: [
			{
				name: 'Define chat contracts',
				summary: 'Read shared types.',
				files: ['packages/chat/chat.types.ts'],
			},
		],
	})
	const result = await resolveLayerLabels(request)
	expect(result?.grouping?.find((group) => group.name === 'Define chat contracts')?.files).toEqual([
		'packages/chat/chat.types.ts',
	])
	expect(result?.grouping?.flatMap((group) => group.files).sort()).toEqual(
		request.files.map((file) => file.path).sort(),
	)
	expect(result?.qualityWarning).toBe(true)
})

it('repairs only directory-named cached groups and keeps the repaired revision stable', async () => {
	const files = [
		{ path: 'apps/admin-web/PlanCard.tsx', digest: 'a' },
		{ path: 'src/lock.ts', digest: 'a' },
	]
	request.files = files
	request.groupingInput = '- apps/admin-web/PlanCard.tsx [ui] @1\n- src/lock.ts [server] @2'
	const unchanged = {
		name: 'Serialize provider updates',
		summary: 'Check concurrent writes.',
		files: ['src/lock.ts'],
	}
	const groups = [
		{ name: 'admin-web', summary: '', files: ['apps/admin-web/PlanCard.tsx'] },
		unchanged,
	]
	stored[analysisKeys(request, `openrouter:${MODEL}`).exact] = {
		digest: request.digest,
		files,
		response: { source: 'model', labeler: 'openrouter', layers: [], grouping: groups },
	}
	const fixed = {
		name: 'Approve proposed plans',
		summary: 'Check plan decisions.',
		files: ['apps/admin-web/PlanCard.tsx'],
	}
	vi.mocked(groupLayersWithOpenRouter).mockResolvedValue({ layers: [fixed] })
	expect((await resolveLayerLabels(request))?.grouping).toEqual([fixed, unchanged])
	const call = vi.mocked(groupLayersWithOpenRouter).mock.calls[0]?.[0]
	expect(call?.input).not.toContain('- src/lock.ts')
	await resolveLayerLabels(request)
	expect(groupLayersWithOpenRouter).toHaveBeenCalledTimes(1)
})

it('bounds retries when a model keeps returning generic groups and preserves the cached warning', async () => {
	vi.mocked(groupLayersWithOpenRouter).mockResolvedValue({
		layers: [{ name: 'Web changes', summary: '', files: ['src/lock.ts'] }],
	})
	expect(await resolveLayerLabels(request)).toMatchObject({ qualityWarning: true })
	expect(groupLayersWithOpenRouter).toHaveBeenCalledTimes(2)
	expect(await resolveLayerLabels(request)).toMatchObject({ qualityWarning: true })
	expect(groupLayersWithOpenRouter).toHaveBeenCalledTimes(2)
})
