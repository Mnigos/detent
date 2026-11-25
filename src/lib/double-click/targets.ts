import { viewedCheckbox } from '../panel/github-dom'
import { viewedButton } from '../tree/native'

// The Changes page wraps each file, header and diff, in a region named by its anchor.
const CHANGES_FILE = '[role="region"][id^="diff-"]'
const CLASSIC_FILE = '.js-file, [data-details-container-group="file"], [data-tagsearch-path]'
// A double-click there is someone typing, choosing or acting, not reading the diff. Forms cover
// comment boxes and the classic Viewed toggle; the class-name guesses cover the Changes page's
// React review threads, whose markup is hashed and not captured in a fixture.
const IGNORED = [
	'input',
	'textarea',
	'select',
	'button',
	'a[href]',
	'label',
	'summary',
	'form',
	'[contenteditable]:not([contenteditable="false"])',
	'[role="button"]',
	'[role="link"]',
	'[role="textbox"]',
	'.js-inline-comments-container',
	'.inline-comments',
	'.js-comment-container',
	'.review-comment',
	'.js-inline-comment-form-container',
	'[data-testid*="review-thread" i]',
	'[data-testid*="comment" i]',
	'[class*="ReviewThread"]',
	'[class*="InlineComment"]',
	'[class*="CommentBox"]',
	'[class*="MarkdownEditor"]',
].join(', ')

export interface ViewedTarget {
	/** The file's whole box; it is what shrinks when GitHub collapses a viewed file. */
	section: HTMLElement
	/** GitHub's own Viewed control: the Changes page button or the classic checkbox. */
	control: HTMLElement
}

/** The file a double-click landed on, or nothing when it hit a control, a comment or no file. */
export function viewedTarget(event: MouseEvent): ViewedTarget | undefined {
	if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
		return undefined

	const origin = event.composedPath()[0] ?? event.target
	const element = origin instanceof Element ? origin : (origin as Node | null)?.parentElement
	if (!element || element.closest(IGNORED)) return undefined

	const region = element.closest<HTMLElement>(CHANGES_FILE)
	const button = region && viewedButton(region.id)
	if (region && button) return { section: region, control: button }

	const section = element.closest<HTMLElement>(CLASSIC_FILE)
	const checkbox = section && viewedCheckbox(section)

	return section && checkbox ? { section, control: checkbox } : undefined
}
