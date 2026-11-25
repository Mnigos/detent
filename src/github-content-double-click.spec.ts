// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://github.com/example/shop/pull/1/files"}
import { expect, it, vi } from 'vitest'
import { browser } from 'wxt/browser'
import githubContent from '../entrypoints/github.content'
import { readSettings, type Settings } from './lib/settings'

vi.mock('wxt/browser', () => ({
	browser: { storage: { onChanged: { addListener: vi.fn() } } },
}))
vi.mock('./lib/settings', () => ({ readSettings: vi.fn() }))
vi.mock('./header/mount', () => ({ startHeaderStats: vi.fn(async () => undefined) }))
vi.mock('./lib/panel/github-dom', async (original) => ({
	...(await original<typeof import('./lib/panel/github-dom')>()),
	observeMutations: vi.fn(),
}))

const SETTINGS: Settings = {
	provider: 'openrouter',
	openRouterKey: '',
	chatgptModel: '',
	model: 'model',
	isEnabled: false,
	showListStats: true,
	showImagePreview: true,
	doubleClickViewed: false,
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const checkbox = () => document.querySelector<HTMLInputElement>('.js-reviewed-checkbox')

function doubleClickLine() {
	document
		.querySelector('.blob-code')
		?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true, detail: 2 }))
}

// One content script per file: its listeners stay on the document for the rest of the file.
it('follows its own switch, off by default, while the main switch is off', async () => {
	document.body.innerHTML = `<div id="files"><div class="file js-file" data-tagsearch-path="a.ts">
		<div class="file-header"><form><label><input class="js-reviewed-checkbox" type="checkbox" name="viewed"> Viewed</label></form></div>
		<table><tr><td class="blob-code">const a = 1</td></tr></table></div></div>`
	vi.mocked(readSettings).mockResolvedValue(SETTINGS)
	githubContent.main({} as never)
	await flush()

	doubleClickLine()
	expect(checkbox()?.checked).toBe(false)

	vi.mocked(readSettings).mockResolvedValue({ ...SETTINGS, doubleClickViewed: true })
	const listener = vi.mocked(browser.storage.onChanged.addListener).mock.calls[0]?.[0] as (
		changes: object,
		area: string,
	) => void
	listener({ settings: {} }, 'local')
	await flush()

	doubleClickLine()
	expect(checkbox()?.checked).toBe(true)
})
