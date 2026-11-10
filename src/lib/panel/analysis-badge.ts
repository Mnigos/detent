const BADGE_ID = 'detent-analyzing'
const BADGE_STYLE =
	'position:fixed;right:16px;bottom:16px;z-index:9998;display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;background:#1f2937;color:#f3f4f6;font:12px/1.4 sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.35)'
const SPINNER_STYLE =
	'width:12px;height:12px;border-radius:50%;border:2px solid #9ca3af;border-top-color:transparent;animation:detent-spin .8s linear infinite'
const STYLE_ID = `${BADGE_ID}-style`

export const GROUP_BUTTON_ID = 'detent-group'
const GROUP_BUTTON_STYLE = `${BADGE_STYLE};border:0;margin:0;cursor:pointer;text-align:left`
const RING_STYLE = 'width:12px;height:12px;border-radius:50%;border:2px solid #9ca3af'

const KEY_BADGE_ID = 'detent-no-key'
const KEY_BADGE_STYLE =
	'position:fixed;right:16px;bottom:16px;z-index:9998;max-width:24rem;padding:8px 12px;border-radius:8px;background:#78350f;color:#fef3c7;font:12px/1.4 sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.35)'

export const LOADING_TEXT = 'detent is loading…'
export const GROUPING_TEXT = 'detent is grouping the files…'

function addBadgeStyle() {
	if (document.getElementById(STYLE_ID)) return

	const style = document.createElement('style')
	style.id = STYLE_ID
	style.textContent = `@keyframes detent-spin{to{transform:rotate(360deg)}}#${GROUP_BUTTON_ID}:focus-visible{outline:2px solid #60a5fa;outline-offset:2px}`
	document.head.append(style)
}

// Without a provider every layer is structural, which looks like a bad answer; say so where it is seen.
export function showKeyBadge(visible: boolean): void {
	const existing = document.getElementById(KEY_BADGE_ID)
	if (!visible) {
		existing?.remove()
		return
	}
	if (existing) return

	const badge = document.createElement('div')
	badge.id = KEY_BADGE_ID
	badge.setAttribute('role', 'status')
	badge.style.cssText = KEY_BADGE_STYLE
	badge.textContent =
		'detent has no model provider set up, so the layers come from the file structure. Choose OpenRouter or ChatGPT in the extension popup and reload.'
	document.body.append(badge)
}

// A reviewer cannot tell a finished fallback from a request still running; the corner badge can.
export function showAnalysisBadge(visible: boolean, text = GROUPING_TEXT): void {
	const existing = document.getElementById(BADGE_ID)
	if (!visible) {
		existing?.remove()
		return
	}
	if (existing) {
		if (existing.lastChild?.textContent !== text) existing.lastChild?.replaceWith(text)
		return
	}

	addBadgeStyle()
	const badge = document.createElement('div')
	badge.id = BADGE_ID
	badge.setAttribute('role', 'status')
	badge.style.cssText = BADGE_STYLE
	const spinner = document.createElement('span')
	spinner.style.cssText = SPINNER_STYLE
	badge.append(spinner, text)
	document.body.append(badge)
}

export const hideGroupButton = () => document.getElementById(GROUP_BUTTON_ID)?.remove()

// A large pull request is grouped only on request; the button takes the loading badge's place.
export function showGroupButton(text: string, onClick: () => void): void {
	hideGroupButton()
	addBadgeStyle()
	const button = document.createElement('button')
	button.id = GROUP_BUTTON_ID
	button.type = 'button'
	button.style.cssText = GROUP_BUTTON_STYLE
	const ring = document.createElement('span')
	ring.style.cssText = RING_STYLE
	button.append(ring, text)
	button.addEventListener(
		'click',
		() => {
			button.remove()
			onClick()
		},
		{ once: true },
	)
	document.body.append(button)
}
