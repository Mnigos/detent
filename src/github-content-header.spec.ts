// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://github.com/example/shop/pull/1/files"}
import { describe, expect, it, vi } from 'vitest'
import { browser } from 'wxt/browser'
import githubContent from '../entrypoints/github.content'
import { startHeaderStats } from './header/mount'
import { readSettings, type Settings } from './lib/settings'

vi.mock('wxt/browser', () => ({
	browser: { storage: { onChanged: { addListener: vi.fn() } } },
}))
vi.mock('./lib/settings', () => ({ readSettings: vi.fn() }))
vi.mock('./lib/panel/large-pull-request', () => ({
	largePullRequestGate: vi.fn(async () => undefined),
	saveGroupingConsent: vi.fn(),
}))
vi.mock('./lib/panel/github-dom', () => ({ observeMutations: vi.fn() }))
vi.mock('./panel/mount', () => ({ startPanel: vi.fn(async () => undefined) }))
vi.mock('./tree/mount', () => ({ startTree: vi.fn(async () => undefined) }))
vi.mock('./list/mount', () => ({ startListStats: vi.fn(async () => undefined) }))
vi.mock('./header/mount', () => ({
	startHeaderStats: vi.fn(async () => ({ mount: vi.fn(), remove: vi.fn() })),
}))

const SETTINGS: Settings = {
	provider: 'openrouter',
	openRouterKey: '',
	chatgptModel: '',
	model: 'model',
	isEnabled: true,
	showListStats: true,
	showImagePreview: true,
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function navigate(path: string) {
	history.pushState(null, '', path)
	window.dispatchEvent(new PopStateEvent('popstate'))
}

const headers = () =>
	Promise.all(
		vi
			.mocked(startHeaderStats)
			.mock.results.map(
				(result) => result.value as Promise<{ mount: () => void; remove: () => void }>,
			),
	)

function changeSettings(settings: Settings) {
	vi.mocked(readSettings).mockResolvedValue(settings)
	const listener = vi.mocked(browser.storage.onChanged.addListener).mock.calls[0]?.[0] as (
		changes: object,
		area: string,
	) => void
	listener({ settings: {} }, 'local')
}

// One content script per file: every instance keeps its navigation listeners for the rest of the file.
describe('pull request header code lines', () => {
	it('runs once per pull request across its tabs, follows both switches and stays off lists', async () => {
		vi.mocked(readSettings).mockResolvedValue(SETTINGS)
		githubContent.main({} as never)
		await flush()
		for (const path of [
			'/example/shop/pull/1',
			'/example/shop/pull/1/commits',
			'/example/shop/pull/1/checks',
		]) {
			navigate(path)
			await flush()
		}

		expect(startHeaderStats).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ owner: 'example', repo: 'shop', number: 1 }),
		)
		const [first] = await headers()
		expect(first?.mount).toHaveBeenCalledOnce()
		expect(first?.remove).not.toHaveBeenCalled()

		navigate('/example/shop/pull/2/changes')
		await flush()
		expect(first?.remove).toHaveBeenCalledOnce()
		expect(startHeaderStats).toHaveBeenLastCalledWith(expect.objectContaining({ number: 2 }))
		const second = (await headers())[1]

		changeSettings({ ...SETTINGS, showListStats: false })
		await flush()
		expect(second?.remove).toHaveBeenCalledOnce()
		expect(startHeaderStats).toHaveBeenCalledTimes(2)

		changeSettings(SETTINGS)
		await flush()
		expect(startHeaderStats).toHaveBeenCalledTimes(3)
		const third = (await headers())[2]
		expect(third?.mount).toHaveBeenCalledOnce()

		changeSettings({ ...SETTINGS, isEnabled: false })
		await flush()
		expect(third?.remove).toHaveBeenCalledOnce()

		changeSettings(SETTINGS)
		await flush()
		navigate('/example/shop/pulls')
		await flush()
		const fourth = (await headers())[3]
		expect(fourth?.remove).toHaveBeenCalledOnce()
		expect(startHeaderStats).toHaveBeenCalledTimes(4)
	})
})
