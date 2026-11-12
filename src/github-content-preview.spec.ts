// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://github.com/example/shop/pull/1"}

import { expect, it, vi } from 'vitest'
import { browser } from 'wxt/browser'
import githubContent from '../entrypoints/github.content'
import { isImagePreviewOpen } from './image-preview/overlay'
import { readSettings, type Settings } from './lib/settings'

vi.mock('wxt/browser', () => ({
	browser: { storage: { onChanged: { addListener: vi.fn() } } },
}))
vi.mock('./lib/settings', () => ({ readSettings: vi.fn() }))
vi.mock('./lib/panel/github-dom', () => ({ observeMutations: vi.fn() }))
vi.mock('./header/mount', () => ({ startHeaderStats: vi.fn(async () => undefined) }))

const SHOT = 'https://private-user-images.githubusercontent.com/1/a.png'
const SETTINGS: Settings = {
	openRouterKey: '',
	model: 'model',
	isEnabled: false,
	showListStats: true,
	showImagePreview: true,
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function clickImage() {
	const event = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true })
	document.querySelector('#a')?.dispatchEvent(event)

	return event
}

// One content script per file: its click listener stays on the document for the rest of the file.
it('previews images by their own switch while the main switch is off', async () => {
	document.body.innerHTML = `<div class="markdown-body"><img id="a" alt="Shot" src="${SHOT}"></div>`
	vi.mocked(readSettings).mockResolvedValue(SETTINGS)
	githubContent.main({} as never)
	await flush()

	expect(clickImage().defaultPrevented).toBe(true)
	expect(isImagePreviewOpen()).toBe(true)

	vi.mocked(readSettings).mockResolvedValue({ ...SETTINGS, showImagePreview: false })
	const listener = vi.mocked(browser.storage.onChanged.addListener).mock.calls[0]?.[0] as (
		changes: object,
		area: string,
	) => void
	listener({ settings: {} }, 'local')
	await flush()

	expect(isImagePreviewOpen()).toBe(false)
	expect(clickImage().defaultPrevented).toBe(false)
	expect(isImagePreviewOpen()).toBe(false)
})
