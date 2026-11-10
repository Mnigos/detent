// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContentScriptContext } from 'wxt/utils/content-script-context'
import { anchorIdForPath } from '../lib/panel/github-dom'
import { holdReviewAnchor, releaseReviewAnchor } from '../lib/panel/review-anchor'
import { createReviewSession } from '../lib/panel/session'
import { createPanelStore, currentFile, type PanelStore } from '../lib/panel/store'
import { HANDLER_SPEC, LAYERS } from '../test/changes-page'
import { startPanel } from './mount'

vi.mock('../lib/panel/session', () => ({ createReviewSession: vi.fn() }))
// The shadow root is WXT's concern; the panel mounts straight into a container here.
vi.mock('wxt/utils/content-script-ui/shadow-root', () => ({
	createShadowRootUi: vi.fn(
		async (
			_ctx: unknown,
			options: {
				onMount: (container: HTMLElement) => () => void
				onRemove: (teardown?: () => void) => void
			},
		) => {
			let teardown: (() => void) | undefined
			return {
				mount() {
					const container = document.createElement('div')
					document.body.append(container)
					teardown = options.onMount(container)
				},
				remove() {
					options.onRemove(teardown)
				},
			}
		},
	),
}))

let store: PanelStore
let panel: Awaited<ReturnType<typeof startPanel>> | undefined

// A classic Files changed page: one section per file, a review comment inside the spec's section.
async function loadFilesPage(hash: string) {
	const anchorIds = new Map(
		await Promise.all(
			LAYERS.flatMap((layer) => layer.files).map(
				async ({ path }) => [path, await anchorIdForPath(path)] as const,
			),
		),
	)
	document.body.innerHTML = `<div id="files">${[...anchorIds]
		.map(
			([path, id]) =>
				`<div class="file js-file" id="${id}" data-tagsearch-path="${path}"><div class="file-header" data-path="${path}"></div></div>`,
		)
		.join('')}</div>`
	window.location.hash = hash
	// github.content.ts holds the link's target before it starts a view.
	holdReviewAnchor()
	store = createPanelStore(LAYERS, { status: 'Ready', savePosition: vi.fn() })
	vi.mocked(createReviewSession).mockResolvedValue({ store, anchorIds, stop: vi.fn() })

	return anchorIds
}

async function mount() {
	panel = await startPanel({} as ContentScriptContext, {
		owner: 'owner',
		repo: 'repo',
		number: 1,
		tab: 'files',
	})
	await act(async () => panel?.mount())
	await vi.advanceTimersByTimeAsync(50)
}

beforeEach(() => {
	vi.useFakeTimers()
	vi.stubGlobal('matchMedia', () => ({ matches: false }))
	vi.stubGlobal('scrollTo', vi.fn())
	vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(async () => {
	await act(async () => panel?.remove())
	panel = undefined
	releaseReviewAnchor()
	window.location.hash = ''
	vi.useRealTimers()
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe('panel on a followed review link', () => {
	it('selects the commented file without moving the viewport GitHub set', async () => {
		const anchorIds = await loadFilesPage('#r42')
		const comment = document.createElement('div')
		comment.id = 'r42'
		document.getElementById(anchorIds.get(HANDLER_SPEC) ?? '')?.append(comment)
		await mount()

		expect(currentFile(store.getSnapshot())?.path).toBe(HANDLER_SPEC)
		expect(window.scrollTo).not.toHaveBeenCalled()
		expect(window.location.hash).toBe('#r42')
	})

	it('selects the file once GitHub loads the comment in', async () => {
		const anchorIds = await loadFilesPage('#discussion_r43')
		await mount()
		expect(currentFile(store.getSnapshot())?.path).toBe(LAYERS[0]?.files[0]?.path)

		const comment = document.createElement('div')
		comment.id = 'r43'
		await act(async () => {
			document.getElementById(anchorIds.get(HANDLER_SPEC) ?? '')?.append(comment)
			await vi.advanceTimersByTimeAsync(50)
		})

		expect(currentFile(store.getSnapshot())?.path).toBe(HANDLER_SPEC)
		expect(window.scrollTo).not.toHaveBeenCalled()
	})

	it('keeps the reviewer where they went once they scrolled', async () => {
		const anchorIds = await loadFilesPage('#r44')
		await mount()
		window.dispatchEvent(new Event('wheel'))
		const comment = document.createElement('div')
		comment.id = 'r44'
		await act(async () => {
			document.getElementById(anchorIds.get(HANDLER_SPEC) ?? '')?.append(comment)
			await vi.advanceTimersByTimeAsync(50)
		})

		expect(currentFile(store.getSnapshot())?.path).toBe(LAYERS[0]?.files[0]?.path)
	})

	it('selects the file a line link names', async () => {
		await loadFilesPage(`#${await anchorIdForPath(HANDLER_SPEC)}R12`)
		await mount()

		expect(store.getSnapshot()).toMatchObject({ layerIndex: 1, fileIndex: 3 })
		expect(window.scrollTo).not.toHaveBeenCalled()
	})
})
