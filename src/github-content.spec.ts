// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://github.com/example/shop/pull/1/files"}
import { beforeEach, describe, expect, it, vi } from 'vitest'
import githubContent from '../entrypoints/github.content'
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
vi.mock('./lib/panel/github-dom', () => ({ observeMutations: vi.fn() }))
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
