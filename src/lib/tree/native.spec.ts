// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	ENV,
	ENV_ANCHOR,
	HANDLER_SPEC,
	HANDLER_SPEC_ANCHOR,
	loadChangesPage,
} from '../../test/changes-page'
import {
	readViewed,
	regionsByPath,
	scrollToAnchor,
	type TreeTemplates,
	toggleViewedInHeader,
} from './native'

let anchorIds: Map<string, string>
let templates: TreeTemplates

beforeEach(async () => {
	vi.useFakeTimers()
	vi.stubGlobal('scrollTo', vi.fn())
	;({ anchorIds, templates } = await loadChangesPage())
})

afterEach(() => {
	vi.clearAllTimers()
	vi.useRealTimers()
	vi.unstubAllGlobals()
})

describe('readTemplates', () => {
	it('clones a directory row and a file row without ids, labels or nested groups', () => {
		expect(anchorIds.get(ENV)).toBe(ENV_ANCHOR)
		expect(templates.section.hasAttribute('aria-expanded')).toBe(true)
		expect(templates.section.querySelector('ul')).toBeNull()
		expect(templates.file.querySelector('a')).not.toBeNull()
		for (const row of [templates.section, templates.file]) {
			expect(row.id).toBe('')
			expect(row.querySelectorAll('[id], [aria-labelledby], [aria-describedby]')).toHaveLength(0)
		}
		expect(templates.levelLine?.className).toContain('level-line')
	})
})

describe('readViewed', () => {
	it('reads aria-pressed from loaded headers and keeps the last state of unloaded ones', () => {
		const button = document.querySelector(`#${ENV_ANCHOR} button[aria-pressed]`) as HTMLElement

		expect(readViewed(new Set([HANDLER_SPEC, ENV]), anchorIds)).toEqual(new Set([HANDLER_SPEC]))

		button.setAttribute('aria-pressed', 'true')

		expect(readViewed(new Set(), anchorIds)).toEqual(new Set([ENV]))
	})

	it('lists the regions that exist on the page', () => {
		expect(regionsByPath(anchorIds).map(({ path, section }) => [path, section.id])).toEqual([
			[ENV, ENV_ANCHOR],
			[HANDLER_SPEC, HANDLER_SPEC_ANCHOR],
		])
	})
})

describe('scrollToAnchor', () => {
	it('sets the hash once and scrolls to the region when the hash already points at it', () => {
		scrollToAnchor(ENV_ANCHOR)

		expect(window.location.hash).toBe(`#${ENV_ANCHOR}`)
		expect(window.scrollTo).not.toHaveBeenCalled()

		scrollToAnchor(ENV_ANCHOR)

		expect(window.scrollTo).toHaveBeenCalledTimes(1)
	})

	it('corrects the reordered destination after hash navigation and ignores stale navigation', async () => {
		vi.useFakeTimers()
		scrollToAnchor(ENV_ANCHOR)
		await vi.advanceTimersByTimeAsync(20)
		expect(window.scrollTo).toHaveBeenCalledTimes(1)
		vi.mocked(window.scrollTo).mockClear()

		scrollToAnchor(HANDLER_SPEC_ANCHOR)
		scrollToAnchor(ENV_ANCHOR)
		await vi.advanceTimersByTimeAsync(20)
		expect(window.location.hash).toBe(`#${ENV_ANCHOR}`)
		expect(window.scrollTo).toHaveBeenCalledTimes(1)
	})
})

describe('toggleViewedInHeader', () => {
	it('clicks the Viewed button of a loaded header', async () => {
		const button = document.querySelector(`#${ENV_ANCHOR} button[aria-pressed]`) as HTMLElement
		const click = vi.spyOn(button, 'click')

		await expect(toggleViewedInHeader(ENV_ANCHOR)).resolves.toBe(true)
		expect(click).toHaveBeenCalledTimes(1)
	})

	it('navigates to a placeholder and gives up when its header never loads', async () => {
		vi.useFakeTimers()
		const outcome = toggleViewedInHeader(HANDLER_SPEC_ANCHOR)
		await vi.advanceTimersByTimeAsync(2000)

		expect(window.location.hash).toBe(`#${HANDLER_SPEC_ANCHOR}`)
		await expect(outcome).resolves.toBe(false)
	})
})
