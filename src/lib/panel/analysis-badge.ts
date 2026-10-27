const BADGE_ID = 'detent-analyzing'
const BADGE_STYLE =
	'position:fixed;right:16px;bottom:16px;z-index:9998;display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;background:#1f2937;color:#f3f4f6;font:12px/1.4 sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.35)'
const SPINNER_STYLE =
	'width:12px;height:12px;border-radius:50%;border:2px solid #9ca3af;border-top-color:transparent;animation:detent-spin .8s linear infinite'

const KEY_BADGE_ID = 'detent-no-key'
const KEY_BADGE_STYLE =
	'position:fixed;right:16px;bottom:16px;z-index:9998;max-width:24rem;padding:8px 12px;border-radius:8px;background:#78350f;color:#fef3c7;font:12px/1.4 sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.35)'

export const LOADING_TEXT = 'detent is loading…'
export const GROUPING_TEXT = 'detent is grouping the files…'

// Without a key every layer is structural, which looks like a bad answer; say so where it is seen.
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
		'detent has no OpenRouter key, so the layers come from the file structure. Add a key in the extension popup and reload.'
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

	if (!document.getElementById(`${BADGE_ID}-style`)) {
		const style = document.createElement('style')
		style.id = `${BADGE_ID}-style`
		style.textContent = '@keyframes detent-spin{to{transform:rotate(360deg)}}'
		document.head.append(style)
	}
	const badge = document.createElement('div')
	badge.id = BADGE_ID
	badge.setAttribute('role', 'status')
	badge.style.cssText = BADGE_STYLE
	const spinner = document.createElement('span')
	spinner.style.cssText = SPINNER_STYLE
	badge.append(spinner, text)
	document.body.append(badge)
}
