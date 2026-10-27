import { type PanelState, type ViewMode, viewModeOf } from '../panel/store'

export const TOGGLE_ID = 'detent-tree-toggle'
export const PRIORITY_REVIEW = 'Priority Review'

interface ModeButton {
	mode: ViewMode
	label: string
	title?: string
}

const MODES: ModeButton[] = [
	{ mode: 'layers', label: 'Layers' },
	{ mode: 'priority', label: 'Priority', title: `${PRIORITY_REVIEW}: the files to read first` },
	{ mode: 'files', label: 'Files' },
]

function textButton(label: string, onClick: () => void): HTMLButtonElement {
	const button = document.createElement('button')
	button.type = 'button'
	const native = document.querySelector<HTMLButtonElement>(
		'button[data-size="small"][data-component="Button"]',
	)
	button.className =
		native?.className
			.split(' ')
			.filter((name) => name.startsWith('prc-Button-'))
			.join(' ') || 'prc-Button-ButtonBase-9n-Xk'
	button.dataset.component = 'Button'
	button.dataset.size = 'small'
	button.textContent = label
	button.addEventListener('click', onClick)

	return button
}

/** Layers | Priority | Files, styled as small Primer buttons copied from the page. */
export function createModeToggle(onSetMode: (mode: ViewMode) => void) {
	const element = document.createElement('div')
	element.id = TOGGLE_ID
	element.className = 'd-flex gap-1 px-2 py-1'
	const buttons = MODES.map(({ mode, label, title }) => {
		const button = textButton(label, () => onSetMode(mode))
		button.dataset.mode = mode
		if (title) button.title = title

		return button
	})
	element.append(...buttons)

	return {
		element,
		update(state: PanelState) {
			const current = viewModeOf(state)
			for (const button of buttons) {
				const isPressed = button.dataset.mode === current
				button.dataset.variant = isPressed ? 'default' : 'invisible'
				button.setAttribute('aria-pressed', String(isPressed))
			}
		},
	}
}
