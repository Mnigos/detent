import type { PreviewImage } from '@/src/lib/image-preview/targets'
import { PREVIEW_STYLE } from './style'

export const PREVIEW_HOST = 'detent-image-preview'
const FOCUSABLE = 'button:not([hidden]), a[href]:not([hidden])'

interface Preview {
	host: HTMLElement
	root: ShadowRoot
	images: PreviewImage[]
	index: number
	opener: HTMLElement
	overflow: string
}

let current: Preview | undefined

const part = <T extends HTMLElement>(root: ShadowRoot, selector: string) =>
	root.querySelector(selector) as T

function control(tag: 'a' | 'button', className: string, label: string, text: string) {
	const element = document.createElement(tag)
	element.className = `control ${className}`
	element.setAttribute('aria-label', label)
	element.textContent = text
	if (element instanceof HTMLButtonElement) element.type = 'button'

	return element
}

function build(): ShadowRoot {
	const host = document.createElement(PREVIEW_HOST)
	const root = host.attachShadow({ mode: 'open' })
	const style = document.createElement('style')
	style.textContent = PREVIEW_STYLE

	const dialog = document.createElement('div')
	dialog.className = 'dialog'
	dialog.setAttribute('role', 'dialog')
	dialog.setAttribute('aria-modal', 'true')

	const stage = document.createElement('div')
	stage.className = 'stage'
	const zoom = document.createElement('button')
	zoom.type = 'button'
	zoom.className = 'zoom'
	zoom.append(document.createElement('img'))
	stage.append(zoom)

	const bar = document.createElement('div')
	bar.className = 'bar'
	const counter = document.createElement('span')
	counter.className = 'counter'
	counter.setAttribute('aria-live', 'polite')
	const title = document.createElement('span')
	title.className = 'title'
	const spacer = document.createElement('span')
	spacer.className = 'spacer'
	const original = control('a', 'original', 'Open original in a new tab', 'Open original')
	original.setAttribute('target', '_blank')
	original.setAttribute('rel', 'noopener noreferrer')
	bar.append(
		counter,
		title,
		spacer,
		original,
		control('button', 'close', 'Close image preview', '✕'),
	)

	dialog.append(
		stage,
		bar,
		control('button', 'step previous', 'Previous image', '‹'),
		control('button', 'step next', 'Next image', '›'),
	)
	root.append(style, dialog)

	stage.addEventListener('click', (event) => {
		if (event.target === stage) closeImagePreview()
	})
	zoom.addEventListener('click', () => setZoom(zoom.getAttribute('aria-pressed') !== 'true'))
	part(root, '.close').addEventListener('click', () => closeImagePreview())
	part(root, '.previous').addEventListener('click', () => step(-1))
	part(root, '.next').addEventListener('click', () => step(1))

	return root
}

function setZoom(isNatural: boolean) {
	if (!current) return

	const zoom = part<HTMLButtonElement>(current.root, '.zoom')
	zoom.setAttribute('aria-pressed', String(isNatural))
	zoom.setAttribute('aria-label', isNatural ? 'Fit image to screen' : 'Show image at full size')
	part(current.root, '.stage').scrollTo?.(0, 0)
}

function render() {
	if (!current) return

	const { root, images, index } = current
	const shown = images[index] as PreviewImage
	const image = part<HTMLImageElement>(root, '.zoom img')
	image.src = shown.src
	image.alt = shown.alt
	part<HTMLAnchorElement>(root, '.original').href = shown.original
	part(root, '.title').textContent = shown.alt
	part(root, '.dialog').setAttribute(
		'aria-label',
		shown.alt ? `Image preview: ${shown.alt}` : 'Image preview',
	)

	const isSingle = images.length < 2
	part(root, '.counter').textContent = isSingle ? '' : `${index + 1} / ${images.length}`
	for (const button of root.querySelectorAll<HTMLElement>('.step')) button.hidden = isSingle
	setZoom(false)
}

function step(by: number) {
	if (!current || current.images.length < 2) return

	const count = current.images.length
	current.index = (current.index + by + count) % count
	render()
}

// Tab and Shift+Tab cycle through the preview's own controls; the page behind stays out of reach.
function trapFocus(event: KeyboardEvent, root: ShadowRoot) {
	const focusable = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
	const at = focusable.indexOf(root.activeElement as HTMLElement)
	const next = event.shiftKey
		? at <= 0
			? focusable.length - 1
			: at - 1
		: at === -1 || at === focusable.length - 1
			? 0
			: at + 1
	focusable[next]?.focus()
}

// Registered on window in the capture phase, so GitHub's hotkeys and detent's panel keys stay quiet.
function onKeyDown(event: KeyboardEvent) {
	if (!current) return

	event.stopPropagation()
	const action =
		event.key === 'Escape'
			? closeImagePreview
			: event.key === 'ArrowLeft'
				? () => step(-1)
				: event.key === 'ArrowRight'
					? () => step(1)
					: event.key === 'Tab'
						? () => trapFocus(event, (current as Preview).root)
						: undefined
	if (!action || event.metaKey || event.ctrlKey || event.altKey) return

	event.preventDefault()
	action()
}

function onFocusIn(event: FocusEvent) {
	if (current && event.target !== current.host) part(current.root, '.close').focus()
}

const onPopState = () => closeImagePreview()

export const isImagePreviewOpen = () => Boolean(current)

/** Shows `images[index]` over the page; focus returns to `opener` when the preview closes. */
export function openImagePreview(images: PreviewImage[], index: number, opener: HTMLElement) {
	closeImagePreview()
	if (!images[index]) return

	const root = build()
	const host = root.host as HTMLElement
	current = {
		host,
		root,
		images,
		index,
		opener,
		overflow: document.documentElement.style.overflow,
	}
	document.documentElement.style.overflow = 'hidden'
	document.body.append(host)
	render()
	window.addEventListener('keydown', onKeyDown, true)
	window.addEventListener('popstate', onPopState)
	document.addEventListener('focusin', onFocusIn)
	part(root, '.close').focus()
}

export function closeImagePreview() {
	if (!current) return

	const { host, opener, overflow } = current
	current = undefined
	window.removeEventListener('keydown', onKeyDown, true)
	window.removeEventListener('popstate', onPopState)
	document.removeEventListener('focusin', onFocusIn)
	host.remove()
	document.documentElement.style.overflow = overflow
	if (!opener.isConnected) return

	// An image without a link is not focusable; it takes focus once and gives the attribute back.
	if (opener instanceof HTMLImageElement && !opener.hasAttribute('tabindex')) {
		opener.tabIndex = -1
		opener.addEventListener('blur', () => opener.removeAttribute('tabindex'), { once: true })
	}
	opener.focus({ preventScroll: true })
}
