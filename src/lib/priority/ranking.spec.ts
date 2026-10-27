import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiffFile } from '../diff/parse-diff'
import { type PrioritizeResponse, requestPriorities } from '../model/label-priorities'
import { createPanelStore, currentFile, type PanelFile, type PanelLayer } from '../panel/store'
import { createPriorityRequest, planPriorities } from './ranking'

vi.mock('../model/label-priorities', () => ({ requestPriorities: vi.fn() }))

const files: PanelFile[] = [
	{ path: 'src/view.tsx', role: 'ui', additions: 3, deletions: 0 },
	{ path: 'src/auth.service.ts', role: 'server', additions: 8, deletions: 0 },
	{ path: 'src/view.spec.ts', role: 'test', additions: 50, deletions: 0 },
	{ path: 'bun.lock', role: 'generated', additions: 400, deletions: 0 },
]
const layers: PanelLayer[] = [{ id: 'group', name: 'Group', summary: '', isTrailing: false, files }]
const diffs: DiffFile[] = files.map((file) => ({
	...file,
	status: 'modified',
	hunks: [],
	isBinary: false,
}))
const summary = { title: 'Login screen', body: 'Changes login.' }
const pathsOf = (sections: PanelLayer[]) =>
	sections.map((section) => [section.name, section.files.map((file) => file.path)])

beforeEach(() => vi.resetAllMocks())

describe('planPriorities', () => {
	it('prepares fallback sections immediately and excludes generated files from numbered inputs', () => {
		const plan = planPriorities(diffs, layers, summary)
		expect(pathsOf(plan.sections)).toEqual([
			['Urgent', ['src/auth.service.ts']],
			['Medium', ['src/view.tsx']],
			['Low', ['bun.lock', 'src/view.spec.ts']],
		])
		expect(plan.files).toEqual(files)
		expect(plan.input).toContain('Pull request: Login screen\nChanges login.')
		expect(plan.input).toContain('src/auth.service.ts [server] modified +8/-0 @1')
		expect(plan.input).not.toContain('bun.lock')
		expect(requestPriorities).not.toHaveBeenCalled()
	})

	it('uses diff rename status so a pure rename of a risky path stays Low', () => {
		const renamed: PanelFile = {
			path: 'src/billing.service.ts',
			role: 'server',
			additions: 0,
			deletions: 0,
		}
		const plan = planPriorities(
			[{ ...renamed, status: 'renamed', hunks: [], isBinary: false }],
			[{ ...(layers[0] as PanelLayer), files: [renamed] }],
			summary,
		)
		expect(plan.fallback).toEqual([{ path: renamed.path, priority: 'low' }])
	})
})

describe('lazy ranking request', () => {
	function setup() {
		const plan = planPriorities(diffs, layers, summary)
		const store = createPanelStore(layers, {
			status: 'Groups ready.',
			savePosition: vi.fn(),
			priorityLayers: plan.sections,
			priorityStatus: 'Priorities come from the file structure.',
		})
		const isActive = vi.fn(() => true)
		const ask = createPriorityRequest({
			plan,
			store,
			scope: 'owner/repo/1',
			digest: 'r1',
			diffExcerpts: { 'src/auth.service.ts': '+checkSession()' },
			isActive,
		})
		return { store, ask, isActive, plan }
	}

	it('waits for activation, shares repeated invocations and forwards revision plus excerpts', async () => {
		let finish!: (response: PrioritizeResponse) => void
		vi.mocked(requestPriorities).mockReturnValue(
			new Promise((resolve) => {
				finish = resolve
			}),
		)
		const { store, ask, plan } = setup()
		expect(requestPriorities).not.toHaveBeenCalled()
		store.dispatch({ type: 'set-mode', mode: 'priority' })
		ask()
		ask()
		expect(store.getSnapshot().priorityStatus).toBe('Ranking the files with the model…')
		expect(requestPriorities).toHaveBeenCalledExactlyOnceWith({
			scope: 'owner/repo/1',
			digest: 'r1',
			input: plan.input,
			diffExcerpts: { 'src/auth.service.ts': '+checkSession()' },
		})
		finish({ source: 'fallback', labeler: 'openrouter' })
		await vi.waitFor(() =>
			expect(store.getSnapshot().priorityStatus).toBe('Priorities come from the file structure.'),
		)
		ask()
		expect(requestPriorities).toHaveBeenCalledTimes(1)
	})

	it('fills model omissions from the heuristic and keeps the selected file after reordering', async () => {
		vi.mocked(requestPriorities).mockResolvedValue({
			source: 'model',
			labeler: 'openrouter',
			model: 'review-model',
			cost: 0.002,
			priorities: [{ path: 'src/view.tsx', priority: 'high', reason: 'Could hide login.' }],
		})
		const { store, ask } = setup()
		store.dispatch({ type: 'set-mode', mode: 'priority' })
		ask()
		await vi.waitFor(() =>
			expect(store.getSnapshot().priorityStatus).toBe('Priorities from review-model · $0.0020.'),
		)
		expect(pathsOf(store.getSnapshot().layers)).toEqual([
			['Urgent', ['src/auth.service.ts']],
			['High', ['src/view.tsx']],
			['Low', ['bun.lock', 'src/view.spec.ts']],
		])
		expect(currentFile(store.getSnapshot())?.path).toBe('src/view.tsx')
		expect(store.getSnapshot().layers[1]?.files[0]?.reason).toBe('Could hide login.')
	})

	it('can demote every heuristic Urgent file when the model marks zero Urgent', async () => {
		vi.mocked(requestPriorities).mockResolvedValue({
			source: 'model',
			labeler: 'openrouter',
			model: 'm',
			priorities: [{ path: 'src/auth.service.ts', priority: 'high' }],
		})
		const { store, ask } = setup()
		ask()
		await vi.waitFor(() => expect(store.getSnapshot().priorityStatus).toBe('Priorities from m.'))
		expect(pathsOf(store.getSnapshot().priorityLayers)).toEqual([
			['High', ['src/auth.service.ts']],
			['Medium', ['src/view.tsx']],
			['Low', ['bun.lock', 'src/view.spec.ts']],
		])
		expect(store.getSnapshot().layers).toBe(layers)
	})

	it.each(['missing', 'rejected'] as const)(
		'keeps fallback sections and reports a %s worker reply',
		async (failure) => {
			if (failure === 'missing') vi.mocked(requestPriorities).mockResolvedValue(undefined)
			else vi.mocked(requestPriorities).mockRejectedValue(new Error('worker stopped'))
			const { store, ask, plan } = setup()
			ask()
			await vi.waitFor(() =>
				expect(store.getSnapshot().priorityStatus).toBe(
					'The analysis did not come back; reload the page to try again.',
				),
			)
			expect(store.getSnapshot().priorityLayers).toBe(plan.sections)
		},
	)

	it('ignores a late reply after the session has stopped', async () => {
		let finish!: (response: PrioritizeResponse) => void
		vi.mocked(requestPriorities).mockReturnValue(
			new Promise((resolve) => {
				finish = resolve
			}),
		)
		const { store, ask, isActive } = setup()
		ask()
		const before = store.getSnapshot()
		const listener = vi.fn()
		store.subscribe(listener)
		isActive.mockReturnValue(false)
		finish({ source: 'model', labeler: 'openrouter', model: 'm', priorities: [] })
		await vi.waitFor(() => expect(isActive).toHaveBeenCalledTimes(1))
		expect(store.getSnapshot()).toBe(before)
		expect(listener).not.toHaveBeenCalled()
	})
})
