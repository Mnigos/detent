// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://github.com/example/shop/pull/1/files"}
import { beforeEach, describe, expect, it, vi } from 'vitest'
import githubContent from '../entrypoints/github.content'
import { takeOwnHash } from './lib/panel/github-dom'
import { largePullRequestGate, saveGroupingConsent } from './lib/panel/large-pull-request'
import { readSettings, type Settings } from './lib/settings'
import { startPanel } from './panel/mount'

vi.mock('wxt/browser', () => ({
	browser: { storage: { onChanged: { addListener: vi.fn() } } },
}))
vi.mock('./lib/settings', () => ({ readSettings: vi.fn() }))
vi.mock('./lib/panel/large-pull-request', () => ({
	largePullRequestGate: vi.fn(),
	saveGroupingConsent: vi.fn(),
}))
vi.mock('./lib/panel/github-dom', () => ({ observeMutations: vi.fn(), takeOwnHash: vi.fn() }))
vi.mock('./panel/mount', () => ({ startPanel: vi.fn() }))
vi.mock('./tree/mount', () => ({ startTree: vi.fn() }))
vi.mock('./list/mount', () => ({ startListStats: vi.fn() }))

const SETTINGS: Settings = {
	openRouterKey: '',
	model: 'model',
	isEnabled: true,
	showListStats: true,
}
const groupButton = () => document.querySelector<HTMLButtonElement>('#detent-group')
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function navigate(path: string) {
	history.pushState(null, '', path)
	window.dispatchEvent(new PopStateEvent('popstate'))
}

beforeEach(() => {
	vi.resetAllMocks()
	history.replaceState(null, '', '/example/shop/pull/1/files')
	document.head.innerHTML = ''
	document.body.innerHTML = ''
	vi.mocked(readSettings).mockResolvedValue(SETTINGS)
	vi.mocked(largePullRequestGate).mockResolvedValue(
		'Large pull request (570 files). Group with detent',
	)
	vi.mocked(saveGroupingConsent).mockResolvedValue(undefined)
})

describe('large pull request button', () => {
	it('starts the pull request it was shown for', async () => {
		githubContent.main({} as never)
		await flush()
		groupButton()?.click()

		expect(saveGroupingConsent).toHaveBeenCalledWith(expect.objectContaining({ number: 1 }))
		expect(startPanel).toHaveBeenCalledWith({}, expect.objectContaining({ number: 1 }))
	})

	it('does nothing when clicked after navigating to another pull request', async () => {
		githubContent.main({} as never)
		await flush()
		const stale = groupButton()
		expect(stale).not.toBeNull()

		let finishSettings!: (settings: Settings) => void
		vi.mocked(readSettings).mockReturnValue(
			new Promise((resolve) => {
				finishSettings = resolve
			}),
		)
		navigate('/example/shop/pull/2/files')
		expect(stale?.isConnected).toBe(false)
		stale?.click()
		finishSettings(SETTINGS)
		await flush()

		expect(saveGroupingConsent).not.toHaveBeenCalled()
		expect(startPanel).not.toHaveBeenCalled()
		expect(largePullRequestGate).toHaveBeenLastCalledWith(
			expect.objectContaining({ number: 2 }),
			expect.any(Function),
		)
		expect(groupButton()).not.toBeNull()
	})
})

describe('hash on the files page', () => {
	const FILE = `diff-${'c'.repeat(64)}`
	const navigationType = (type: NavigationTimingType) =>
		vi
			.spyOn(performance, 'getEntriesByType')
			.mockReturnValue([{ type } as PerformanceNavigationTiming])

	beforeEach(() => {
		vi.mocked(largePullRequestGate).mockResolvedValue(undefined)
	})

	it.each([`#${FILE}R25`, `#${FILE}`, '#r4479369071', '#discussion_r4479369071'])(
		'keeps %s, a link the reviewer just followed',
		async (hash) => {
			navigationType('navigate')
			history.replaceState(null, '', `/example/shop/pull/1/files${hash}`)
			githubContent.main({} as never)
			await flush()

			expect(window.location.hash).toBe(hash)
			expect(startPanel).toHaveBeenCalled()
		},
	)

	it('drops a #diff- hash a reload brought back, but not one clicked on the page later', async () => {
		navigationType('reload')
		history.replaceState(null, '', `/example/shop/pull/1/files#${FILE}`)
		githubContent.main({} as never)
		await flush()
		expect(window.location.hash).toBe('')

		navigate(`/example/shop/pull/1/changes#${FILE}R3`)
		await flush()
		expect(window.location.hash).toBe(`#${FILE}R3`)
	})

	it('keeps a comment hash a reload brought back', async () => {
		navigationType('reload')
		history.replaceState(null, '', '/example/shop/pull/1/files#r4479369071')
		githubContent.main({} as never)
		await flush()

		expect(window.location.hash).toBe('#r4479369071')
	})

	it('drops the #diff- hash detent set itself', async () => {
		navigationType('navigate')
		vi.mocked(takeOwnHash).mockReturnValue(true)
		history.replaceState(null, '', `/example/shop/pull/1/files#${FILE}`)
		githubContent.main({} as never)
		await flush()

		expect(window.location.hash).toBe('')
	})
})
