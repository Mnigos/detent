// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	anchorIdForPath,
	DIMMED_CLASS,
	fetchPullRequestBody,
	fileSections,
	findFileSection,
	observeMutations,
	readPullRequestSummary,
	readViewedPaths,
	resolveColorMode,
	setDimmedPaths,
	toggleViewed,
} from './github-dom'

const SPEC = 'apps/api/src/modules/github-import/application/github-import.service.spec.ts'
const SERVICE = 'apps/api/src/modules/github-import/application/github-import.service.ts'
const CONTRACT = 'packages/contracts/src/github-import.contract.ts'
const SPEC_ANCHOR = 'diff-f72ff48835cbca079104e27f76b0c2e31cced3c5ab43c8c244abc79b20a293ea'
const CONTRACT_ANCHOR = 'diff-256dd4fe6a834440cf206becbdfc6d30712a6672ee6ed582bd31bb16059b8e18'
const page = readFileSync(resolve(process.cwd(), 'fixtures/github-files-page.html'), 'utf8')

beforeEach(() => {
	vi.stubGlobal('matchMedia', () => ({ matches: false }))
	vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
		callback()

		return 1
	})
	vi.stubGlobal('cancelAnimationFrame', () => undefined)
	document.documentElement.removeAttribute('data-color-mode')
	document.head.innerHTML = ''
	document.body.innerHTML = page
})

describe('anchorIdForPath', () => {
	it('matches the anchor ids GitHub renders on the files page', async () => {
		await expect(anchorIdForPath(SPEC)).resolves.toBe(SPEC_ANCHOR)
		await expect(anchorIdForPath(CONTRACT)).resolves.toBe(CONTRACT_ANCHOR)
	})
})

describe('fileSections', () => {
	it('lists one section per rendered path', () => {
		expect(fileSections().map(({ path }) => path)).toEqual([SPEC, SERVICE])
	})
})

describe('findFileSection', () => {
	it('prefers the anchor id', () => {
		expect(findFileSection(SPEC, SPEC_ANCHOR)?.id).toBe(SPEC_ANCHOR)
	})

	it('falls back to the path attributes when the anchor is missing', () => {
		document.getElementById(SPEC_ANCHOR)?.removeAttribute('id')

		expect(findFileSection(SPEC, SPEC_ANCHOR)?.getAttribute('data-file-path')).toBe(SPEC)
	})

	it('returns nothing for a file that is not rendered yet', () => {
		expect(findFileSection(CONTRACT, CONTRACT_ANCHOR)).toBeUndefined()
	})
})

describe('readViewedPaths', () => {
	it('reads the checked review checkbox and the viewed attribute', () => {
		expect([...readViewedPaths()]).toEqual([SERVICE])
	})

	it('reads the attribute GitHub toggles when the checkbox markup is replaced', () => {
		for (const checkbox of document.querySelectorAll('.js-reviewed-checkbox')) checkbox.remove()
		document.getElementById(SPEC_ANCHOR)?.setAttribute('data-file-user-viewed', '')

		expect([...readViewedPaths()]).toEqual([SPEC, SERVICE])
	})

	it('reflects a checkbox the user just ticked', () => {
		document
			.getElementById(SPEC_ANCHOR)
			?.querySelector<HTMLInputElement>('.js-reviewed-checkbox')
			?.click()

		expect([...readViewedPaths()]).toEqual([SPEC, SERVICE])
	})
})

describe('toggleViewed', () => {
	it('clicks GitHub own checkbox and reports when there is none', () => {
		const checkbox = document
			.getElementById(SPEC_ANCHOR)
			?.querySelector<HTMLInputElement>('.js-reviewed-checkbox')

		expect(toggleViewed(SPEC, SPEC_ANCHOR)).toBe(true)
		expect(checkbox?.checked).toBe(true)
		expect(toggleViewed(CONTRACT, CONTRACT_ANCHOR)).toBe(false)
	})
})

describe('setDimmedPaths', () => {
	it('adds the class to the listed sections only and injects the transition once', () => {
		setDimmedPaths(new Set([SPEC]))
		setDimmedPaths(new Set([SPEC]))
		const [spec, service] = fileSections()

		expect(spec?.section.classList.contains(DIMMED_CLASS)).toBe(true)
		expect(service?.section.classList.contains(DIMMED_CLASS)).toBe(false)
		expect(document.querySelectorAll('style#detent-dimming')).toHaveLength(1)
		expect(document.getElementById('detent-dimming')?.textContent).toContain('opacity:.45')

		setDimmedPaths(new Set())

		expect(spec?.section.classList.contains(DIMMED_CLASS)).toBe(false)
	})
})

describe('resolveColorMode', () => {
	it('follows data-color-mode and falls back to the media query', () => {
		document.documentElement.dataset.colorMode = 'dark'

		expect(resolveColorMode()).toBe('dark')

		document.documentElement.dataset.colorMode = 'auto'

		expect(resolveColorMode()).toBe('light')
	})
})

describe('observeMutations', () => {
	it('reports GitHub viewed toggles and ignores the panel own dimming class', async () => {
		const onChange = vi.fn()
		const stop = observeMutations(document.body, ['data-file-user-viewed'], onChange)
		setDimmedPaths(new Set([SPEC]))
		await Promise.resolve()

		expect(onChange).not.toHaveBeenCalled()

		document.getElementById(SPEC_ANCHOR)?.setAttribute('data-file-user-viewed', '')
		await Promise.resolve()

		expect(onChange).toHaveBeenCalledTimes(1)
		stop()
		document.getElementById(SPEC_ANCHOR)?.removeAttribute('data-file-user-viewed')
		await Promise.resolve()

		expect(onChange).toHaveBeenCalledTimes(1)
	})
})

describe('fetchPullRequestBody', () => {
	it('reads the description out of the conversation page and answers nothing on failure', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(
					new Response(
						'<div class="js-discussion"><div class="timeline-comment"><div class="comment-body">Start with the schema.</div></div></div>',
					),
				),
		)
		expect(await fetchPullRequestBody('https://github.com/o/r/pull/1')).toBe(
			'Start with the schema.',
		)
		expect(fetch).toHaveBeenCalledWith('https://github.com/o/r/pull/1', {
			credentials: 'same-origin',
		})
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })))
		expect(await fetchPullRequestBody('https://github.com/o/r/pull/1')).toBe('')
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
		expect(await fetchPullRequestBody('https://github.com/o/r/pull/1')).toBe('')
		vi.unstubAllGlobals()
	})
})

describe('readPullRequestSummary', () => {
	it('reads the issue title and the first timeline comment', () => {
		document.title = 'ignored by the heading · Pull Request #165 · Mnigos/tessera · GitHub'

		expect(readPullRequestSummary()).toEqual({
			title: 'feat(github-import): import a repository from GitHub',
			body: 'Adds the import contract, the service that walks the tree and the source selector.',
		})
	})

	it('falls back to the document title without GitHub own suffix', () => {
		document.querySelector('bdi.js-issue-title')?.remove()
		document.title =
			'feat(github-import): import a repository by Mnigos · Pull Request #165 · Mnigos/tessera · GitHub'

		expect(readPullRequestSummary().title).toBe('feat(github-import): import a repository')
	})

	it('ignores review threads, the only comments the files page renders', () => {
		document.body.innerHTML = `<div class="js-discussion">
			<div class="js-inline-comments-container">
				<div class="timeline-comment"><div class="comment-body">nit: rename this</div></div>
			</div>
		</div>`
		document.title = 'a title · Pull Request #165 · Mnigos/tessera · GitHub'

		expect(readPullRequestSummary()).toEqual({ title: 'a title', body: '' })
	})

	it('strips the suffix even when the tab renders no trailing GitHub name', () => {
		document.body.innerHTML = ''
		document.title = 'a title by Mnigos · Pull Request #165 · Mnigos/tessera'

		expect(readPullRequestSummary().title).toBe('a title')
	})

	it('returns empty strings when neither the heading nor a comment is rendered', () => {
		document.body.innerHTML = ''
		document.title = ''

		expect(readPullRequestSummary()).toEqual({ title: '', body: '' })
	})
})
