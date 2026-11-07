import { previewTarget } from '@/src/lib/image-preview/targets'
import { closeImagePreview, openImagePreview } from './overlay'

// One delegated listener on the document survives GitHub's soft navigations and new comments.
export function startImagePreview(isActive: () => boolean): () => void {
	function onClick(event: MouseEvent) {
		if (!isActive()) return

		const target = previewTarget(event)
		const image = target?.images[target.index]?.image
		if (!target || !image) return

		event.preventDefault()
		event.stopPropagation()
		openImagePreview(target.images, target.index, image.closest<HTMLElement>('a[href]') ?? image)
	}
	document.addEventListener('click', onClick, true)

	return () => {
		document.removeEventListener('click', onClick, true)
		closeImagePreview()
	}
}
