import { type PanelState, type ViewMode, viewModeOf } from '../panel/store'

export const TOGGLE_ID = 'detent-tree-toggle'
export const PRIORITY_REVIEW = 'Priority Review'

interface ModeButton {
	mode: ViewMode
	label: string
	title?: string
}

export const HIDE_TESTS_LABEL = 'Hide tests'
// Octicon beaker-16.
const BEAKER =
	'M5 5.782V2.5h-.25a.75.75 0 0 1 0-1.5h6.5a.75.75 0 0 1 0 1.5H11v3.282l3.666 5.76C15.619 13.04 14.543 15 12.767 15H3.233c-1.776 0-2.852-1.96-1.899-3.458Zm-2.4 6.565a.75.75 0 0 0 .633 1.153h9.534a.75.75 0 0 0 .633-1.153L12.225 10.5h-8.45ZM9.5 2.5h-3V6c0 .143-.04.283-.117.403L4.73 9h6.54L9.617 6.403A.746.746 0 0 1 9.5 6Z'

function beakerIcon(): SVGSVGElement {
	const namespace = 'http://www.w3.org/2000/svg'
	const svg = document.createElementNS(namespace, 'svg')
	svg.setAttribute('viewBox', '0 0 16 16')
	svg.setAttribute('width', '16')
	svg.setAttribute('height', '16')
	svg.setAttribute('fill', 'currentColor')
	svg.setAttribute('aria-hidden', 'true')
	svg.classList.add('octicon')
	const path = document.createElementNS(namespace, 'path')
	path.setAttribute('d', BEAKER)
	svg.append(path)

	return svg
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

/** Layers | Priority | Files and the Hide tests switch, styled as small Primer buttons from the page. */
export function createModeToggle(onSetMode: (mode: ViewMode) => void, onToggleTests: () => void) {
	const element = document.createElement('div')
	element.id = TOGGLE_ID
	element.className = 'd-flex gap-1 px-2 py-1'
	const buttons = MODES.map(({ mode, label, title }) => {
		const button = textButton(label, () => onSetMode(mode))
		button.dataset.mode = mode
		if (title) button.title = title

		return button
	})
	const tests = textButton(HIDE_TESTS_LABEL, onToggleTests)
	tests.dataset.detentTests = ''
	tests.setAttribute('aria-label', HIDE_TESTS_LABEL)
	tests.style.marginLeft = 'auto'
	tests.replaceChildren(beakerIcon())
	element.append(...buttons, tests)

	return {
		element,
		update(state: PanelState) {
			const current = viewModeOf(state)
			for (const button of buttons) {
				const isPressed = button.dataset.mode === current
				button.dataset.variant = isPressed ? 'default' : 'invisible'
				button.setAttribute('aria-pressed', String(isPressed))
			}
			tests.dataset.variant = state.isHidingTests ? 'default' : 'invisible'
			tests.setAttribute('aria-pressed', String(state.isHidingTests))
			tests.title = state.isHidingTests ? 'Show test files' : 'Hide test files'
		},
	}
}
