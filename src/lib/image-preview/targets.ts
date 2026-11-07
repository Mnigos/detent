const MARKDOWN_BODY = '.markdown-body'
const NOT_PREVIEWED = '.emoji, g-emoji, .avatar, [data-hovercard-type]'
// /user-attachments/assets/<id> redirects to the signed upload, whose file name carries the id.
const ATTACHMENT = /^\/user-attachments\/assets\/([\da-f-]{36})$/
// A repository file links to its blob page and loads from its raw address.
const FILE_VIEW = /^(\/[^/]+\/[^/]+)\/(?:blob|raw)\//

export interface PreviewImage {
	image: HTMLImageElement
	/** The already loaded address; private-user-images carry a signature that expires. */
	src: string
	/** What a plain click opened before: the wrapping link, or the image itself. */
	original: string
	alt: string
}

const parse = (url: string) => {
	try {
		return new URL(url, document.baseURI)
	} catch {
		return undefined
	}
}

const sourcesOf = (image: HTMLImageElement) =>
	[image.currentSrc, image.src, image.getAttribute('data-canonical-src') ?? '']
		.filter(Boolean)
		.map(parse)
		.filter((url) => url !== undefined)

// The signature in the query changes with every render, so an image is its address without it.
const identity = (url: URL) => `${url.origin}${url.pathname.replace(FILE_VIEW, '$1/raw/')}`

// GitHub wraps each markdown image in a link to itself; a badge or logo links somewhere else.
function linksToImage(link: HTMLAnchorElement, image: HTMLImageElement): boolean {
	const url = parse(link.getAttribute('href') ?? '')
	if (!url) return false

	const sources = sourcesOf(image)
	if (sources.some((source) => identity(source) === identity(url))) return true

	const attachment = url.hostname === 'github.com' ? ATTACHMENT.exec(url.pathname)?.[1] : undefined

	return attachment !== undefined && sources.some((source) => source.pathname.includes(attachment))
}

const linkOf = (image: HTMLImageElement) => image.closest<HTMLAnchorElement>('a[href]')

export function isPreviewable(image: HTMLImageElement): boolean {
	if (!image.closest(MARKDOWN_BODY) || image.closest(NOT_PREVIEWED)) return false
	if (!(image.currentSrc || image.src)) return false

	const link = linkOf(image)

	return !link || linksToImage(link, image)
}

export function toPreviewImage(image: HTMLImageElement): PreviewImage {
	const src = image.currentSrc || image.src

	return { image, src, original: linkOf(image)?.href || src, alt: image.alt }
}

/** The images a click opens and the one it landed on, or undefined to leave the click to GitHub. */
export function previewTarget(
	event: MouseEvent,
): { images: PreviewImage[]; index: number } | undefined {
	if (event.defaultPrevented || event.button !== 0) return undefined
	if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return undefined

	const target = event.composedPath()[0] ?? event.target
	if (!(target instanceof HTMLImageElement) || !isPreviewable(target)) return undefined

	// The images of one comment, description or review comment step through together.
	const body = target.closest(MARKDOWN_BODY) as Element
	const images = [...body.querySelectorAll('img')].filter(
		(image) => image.closest(MARKDOWN_BODY) === body && isPreviewable(image),
	)

	return { images: images.map(toPreviewImage), index: images.indexOf(target) }
}
