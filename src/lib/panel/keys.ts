export type PanelKeyAction =
	| 'next-file'
	| 'previous-file'
	| 'next-layer'
	| 'previous-layer'
	| 'scroll-to-file'
	| 'toggle-viewed'
	| 'toggle-raw'
	| 'toggle-collapsed'

const KEYS: Record<string, PanelKeyAction> = {
	j: 'next-file',
	k: 'previous-file',
	n: 'next-layer',
	p: 'previous-layer',
	Enter: 'scroll-to-file',
	v: 'toggle-viewed',
	r: 'toggle-raw',
	'`': 'toggle-collapsed',
}

const TYPING = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]'
const ACTIVATED_BY_ENTER = 'a[href], button, summary, label, [role="button"], [role="link"]'
const OPEN_DIALOG = 'dialog[open], details[open] > details-dialog, modal-dialog:not([hidden])'

export function panelKeyAction(event: KeyboardEvent): PanelKeyAction | undefined {
	if (event.metaKey || event.ctrlKey || event.altKey) return undefined

	// composedPath keeps the real target: events from the panel's shadow root retarget to its host.
	const target = event.composedPath()[0] ?? event.target
	if (!(target instanceof Node)) return undefined

	const action = KEYS[event.key]
	if (target instanceof Element && target.closest(TYPING)) return undefined
	if (
		action === 'scroll-to-file' &&
		target instanceof Element &&
		target.closest(ACTIVATED_BY_ENTER)
	)
		return undefined
	if ((target.ownerDocument ?? (target as Document)).querySelector(OPEN_DIALOG)) return undefined

	return action
}
