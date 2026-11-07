// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://github.com/example/shop/pull/1"}
import { beforeEach, describe, expect, it } from 'vitest'
import { previewTarget } from './targets'

const ID = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d'
const UPLOAD = `https://private-user-images.githubusercontent.com/1/2-${ID}.png?jwt=signed-for-src`

function clickOn(element: Element, init: MouseEventInit = {}) {
	let target: ReturnType<typeof previewTarget>
	element.ownerDocument.addEventListener(
		'click',
		(event) => {
			target = previewTarget(event)
			// jsdom cannot follow the link; the test only asks what the click would do.
			event.preventDefault()
		},
		{ once: true },
	)
	element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }))

	return target
}

const image = (selector = 'img') => document.querySelector(selector) as HTMLImageElement

beforeEach(() => {
	document.body.innerHTML = ''
})

describe('previewTarget', () => {
	it('opens an image whose wrapping link points at the same address', () => {
		document.body.innerHTML = `<div class="markdown-body"><a href="${UPLOAD}" target="_blank"><img src="${UPLOAD}" alt="Login screen"></a></div>`

		expect(clickOn(image())).toEqual({
			images: [{ image: image(), src: UPLOAD, original: UPLOAD, alt: 'Login screen' }],
			index: 0,
		})
	})

	it('opens an upload whose link carries another signature, its attachment or the blob page', () => {
		document.body.innerHTML = `<div class="markdown-body">
			<a href="https://private-user-images.githubusercontent.com/1/2-${ID}.png?jwt=signed-for-link"><img id="signed" src="${UPLOAD}"></a>
			<a href="https://github.com/user-attachments/assets/${ID}"><img id="attachment" src="${UPLOAD}"></a>
			<a href="https://camo.githubusercontent.com/ab/cd"><img id="camo" src="https://camo.githubusercontent.com/ab/cd"></a>
			<a href="/example/shop/blob/main/docs/flow.png"><img id="file" src="/example/shop/raw/main/docs/flow.png"></a>
		</div>`

		for (const id of ['signed', 'attachment', 'camo', 'file'])
			expect(clickOn(image(`#${id}`))?.images.map(({ image }) => image.id)).toEqual([
				'signed',
				'attachment',
				'camo',
				'file',
			])
		expect(clickOn(image('#attachment'))?.images[1]?.original).toBe(
			`https://github.com/user-attachments/assets/${ID}`,
		)
	})

	it('matches the link against the canonical address of a proxied image', () => {
		document.body.innerHTML = `<div class="markdown-body"><a href="https://example.com/chart.png"><img src="https://camo.githubusercontent.com/1" data-canonical-src="https://example.com/chart.png"></a></div>`

		expect(clickOn(image())?.index).toBe(0)
	})

	it('opens an image without a link', () => {
		document.body.innerHTML = `<div class="markdown-body"><p><img src="${UPLOAD}"></p></div>`

		expect(clickOn(image())?.images).toHaveLength(1)
	})

	it('leaves images that link to another site, file, image or attachment to GitHub', () => {
		document.body.innerHTML = `<div class="markdown-body">
			<a href="https://github.com/example/shop/actions"><img id="badge" src="https://camo.githubusercontent.com/badge"></a>
			<a href="https://example.com"><img id="logo" src="https://example.com/logo.png"></a>
			<a href="https://raw.githubusercontent.com/example/shop/main/README.md"><img id="readme" src="https://raw.githubusercontent.com/example/shop/main/logo.png"></a>
			<a href="https://example.com/large.png"><img id="thumbnail" src="https://example.com/small.png"></a>
			<a href="https://example.com/image.php?id=2"><img id="query" src="https://camo.githubusercontent.com/q" data-canonical-src="https://example.com/image.php?id=1"></a>
			<a href="https://github.com/user-attachments/assets/ffffffff-0000-4000-8000-000000000000"><img id="other" src="${UPLOAD}"></a>
		</div>`

		for (const id of ['badge', 'logo', 'readme', 'thumbnail', 'query', 'other'])
			expect(clickOn(image(`#${id}`)), id).toBeUndefined()
	})

	it.each([
		['Cmd', { metaKey: true }],
		['Ctrl', { ctrlKey: true }],
		['Shift', { shiftKey: true }],
		['Alt', { altKey: true }],
		['middle button', { button: 1 }],
	])('leaves a click with %s to GitHub', (_, init) => {
		document.body.innerHTML = `<div class="markdown-body"><a href="${UPLOAD}"><img src="${UPLOAD}"></a></div>`

		expect(clickOn(image(), init)).toBeUndefined()
	})

	it('leaves a click another handler already took', () => {
		document.body.innerHTML = `<div class="markdown-body"><img src="${UPLOAD}"></div>`
		image().addEventListener('click', (event) => event.preventDefault())

		expect(clickOn(image())).toBeUndefined()
	})

	it('leaves emoji, avatars, images outside markdown and clicks beside the image alone', () => {
		document.body.innerHTML = `
			<div class="markdown-body">
				<g-emoji><img id="emoji" src="https://github.githubassets.com/e.png"></g-emoji>
				<img id="avatar" class="avatar" src="https://avatars.githubusercontent.com/u/1">
				<a id="link" href="${UPLOAD}">screenshot <img src="${UPLOAD}"></a>
			</div>
			<img id="outside" src="${UPLOAD}">`

		for (const selector of ['#emoji', '#avatar', '#outside'])
			expect(clickOn(image(selector))).toBeUndefined()
		expect(clickOn(document.querySelector('#link') as Element)).toBeUndefined()
	})

	it('steps through the previewable images of the clicked comment only', () => {
		document.body.innerHTML = `
			<div class="markdown-body" id="first">
				<img id="a" src="https://camo.githubusercontent.com/a">
				<a href="https://example.com"><img src="https://example.com/badge.svg"></a>
				<img class="emoji" src="https://github.githubassets.com/e.png">
				<img id="b" src="https://camo.githubusercontent.com/b">
				<div class="markdown-body"><img id="quoted" src="https://camo.githubusercontent.com/q"></div>
			</div>
			<div class="markdown-body"><img id="other" src="https://camo.githubusercontent.com/c"></div>`

		const target = clickOn(image('#b'))

		expect(target?.images.map(({ image }) => image.id)).toEqual(['a', 'b'])
		expect(target?.index).toBe(1)
	})
})
