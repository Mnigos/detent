const MARKDOWN_BODY = '.markdown-body'
const NOT_PREVIEWED = '.emoji, g-emoji, .avatar, [data-hovercard-type]'
// GitHub serves uploads, proxied external images and repository files from these hosts.
const IMAGE_HOSTS = new Set([
	'camo.githubusercontent.com',
	'private-user-images.githubusercontent.com',
	'user-images.githubusercontent.com',
	'raw.githubusercontent.com',
	'media.githubusercontent.com',
	'objects.githubusercontent.com',
])
// /user-attachments/assets/<id> redirects to the signed upload; /<owner>/<repo>/assets/<id> is older.
const ASSET_PATH = /^\/(?:user-attachments|[^/]+\/[^/]+)\/assets\//
const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp|avif|svg|bmp)$/i

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
		.map((url) => parse(url)?.href)

// GitHub wraps each markdown image in a link to itself; a badge or logo links somewhere else.
function linksToImage(link: HTMLAnchorElement, image: HTMLImageElement): boolean {
	const url = parse(link.getAttribute('href') ?? '')
	if (!url) return false
	if (sourcesOf(image).includes(url.href)) return true
	if (IMAGE_HOSTS.has(url.hostname)) return true
	if (url.hostname === 'github.com' && ASSET_PATH.test(url.pathname)) return true

	return IMAGE_FILE.test(url.pathname)
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
