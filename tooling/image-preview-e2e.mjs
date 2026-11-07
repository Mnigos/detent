// Loads the built extension into headless Chromium and exercises the image preview on a public
// pull request, logged out. Usage: bun tooling/image-preview-e2e.mjs [pull request url]
// Screenshots go to a fresh directory under the system temp folder, printed at the start.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const EXTENSION_PATH = join(import.meta.dirname, '..', '.output', 'chrome-mv3')
const OUTPUT = mkdtempSync(join(tmpdir(), 'detent-image-preview-e2e-'))
const url = process.argv[2] ?? 'https://github.com/TanStack/router/pull/7338'
console.log('output:', OUTPUT)

const context = await chromium.launchPersistentContext(
	mkdtempSync(join(tmpdir(), 'detent-image-preview-profile-')),
	{
		channel: process.env.PROBE_CHANNEL || undefined,
		executablePath: process.env.PROBE_EXECUTABLE || undefined,
		headless: false,
		viewport: { width: 1400, height: 900 },
		args: [
			'--headless=new',
			`--disable-extensions-except=${EXTENSION_PATH}`,
			`--load-extension=${EXTENSION_PATH}`,
		],
	},
)

function check(condition, message, detail) {
	if (!condition) throw new Error(`${message}: ${JSON.stringify(detail)}`)
	console.log('ok:', message)
}

const preview = (page) =>
	page.evaluate(() => {
		const root = document.querySelector('detent-image-preview')?.shadowRoot
		if (!root) return { isOpen: false, overflow: document.documentElement.style.overflow }

		const image = root.querySelector('.zoom img')
		return {
			isOpen: true,
			counter: root.querySelector('.counter')?.textContent,
			src: image?.getAttribute('src'),
			natural: image?.naturalWidth,
			width: image?.getBoundingClientRect().width,
			isZoomed: root.querySelector('.zoom')?.getAttribute('aria-pressed') === 'true',
			focused: root.activeElement?.className,
			label: root.querySelector('[role="dialog"]')?.getAttribute('aria-label'),
			overflow: document.documentElement.style.overflow,
		}
	})

// Each screenshot in the pull request description, and an image that links to another site.
const targets = (page) =>
	page.evaluate(() => {
		const body = document.querySelector('.markdown-body')
		const tag = (image, name) => {
			image.setAttribute('data-e2e', name)
			return {
				src: image.currentSrc,
				href: image.closest('a[href]')?.href,
				complete: image.complete && image.naturalWidth > 0,
			}
		}
		const linksAway = (image) => {
			const href = image.closest('a[href]')?.href
			return href && href !== image.currentSrc && !/githubusercontent|user-attachments/.test(href)
		}
		const screenshots = [...(body?.querySelectorAll('img') ?? [])]
			.filter((image) => !linksAway(image))
			.map((image, index) => tag(image, `shot-${index}`))
		const away = [...document.querySelectorAll('.markdown-body img')].find(linksAway)

		return { screenshots, away: away ? tag(away, 'away') : undefined }
	})

try {
	const page = await context.newPage()
	page.on('console', (message) => {
		if (message.text().includes('[detent]')) console.log('console:', message.text())
	})
	// Start on the files tab so the conversation is reached by GitHub's soft navigation.
	await page.goto(`${url}/files`, { waitUntil: 'domcontentloaded' })
	await page.waitForTimeout(3000)
	await page.click(`a[href$="${new URL(url).pathname}"]`)
	await page.waitForURL(url)
	await page.waitForSelector('.markdown-body img')
	await page.waitForTimeout(3000)
	const found = await targets(page)
	const short = (target) =>
		target && { ...target, src: target.src.slice(0, 90), href: target.href?.slice(0, 90) }
	console.log('screenshots:', found.screenshots.map(short), 'away:', short(found.away))
	check(found.screenshots.length >= 2, 'the description has screenshots', found.screenshots.length)

	let opened = 0
	context.on('page', () => {
		opened += 1
	})
	await page.click('[data-e2e="shot-0"]')
	await page.waitForTimeout(800)
	let state = await preview(page)
	await page.screenshot({ path: join(OUTPUT, '01-open.png') })
	console.log('open:', JSON.stringify({ ...state, src: state.src?.slice(0, 90) }))
	check(state.isOpen && opened === 0, 'a plain click opens the preview, not a tab', {
		state,
		opened,
	})
	check(state.counter === `1 / ${found.screenshots.length}`, 'the counter shows 1 / n', state)
	check(state.natural > 0, 'the preview shows the already loaded image', state)
	check(
		state.overflow === 'hidden' && state.focused?.includes('close'),
		'scroll lock + focus',
		state,
	)

	await page.keyboard.press('ArrowRight')
	await page.waitForTimeout(500)
	state = await preview(page)
	await page.screenshot({ path: join(OUTPUT, '02-next.png') })
	check(state.counter === `2 / ${found.screenshots.length}`, 'ArrowRight moves on', state)
	check(state.src === found.screenshots[1].src, 'the second screenshot is shown', state)

	const fitted = state.width
	await page.click('detent-image-preview >> .zoom')
	await page.waitForTimeout(400)
	state = await preview(page)
	await page.screenshot({ path: join(OUTPUT, '03-natural-size.png') })
	check(state.isOpen && state.isZoomed, 'an image click toggles natural size', state)
	console.log('fitted width:', fitted, 'natural width:', state.width, 'file width:', state.natural)

	// The zoom button keeps focus after the click; the controls follow it in tab order.
	const order = []
	for (let index = 0; index < 6; index += 1) {
		await page.keyboard.press('Tab')
		order.push((await preview(page)).focused)
	}
	console.log('tab order:', order.join(' → '))
	check(order.every(Boolean) && order[5] === order[0], 'Tab cycles inside the preview', order)
	await page.keyboard.press('Shift+Tab')
	check((await preview(page)).focused === order[4], 'Shift+Tab goes back', order)
	while (!(await preview(page)).focused?.includes('close')) await page.keyboard.press('Tab')
	await page.keyboard.press('Enter')
	await page.waitForTimeout(300)
	state = await preview(page)
	const focus = await page.evaluate(() => ({
		tag: document.activeElement?.tagName,
		hasShot: Boolean(document.activeElement?.querySelector('[data-e2e="shot-0"]')),
		isShot: document.activeElement?.getAttribute('data-e2e') === 'shot-0',
	}))
	check(!state.isOpen && state.overflow === '', 'Enter on Close closes and unlocks scroll', state)
	check(focus.hasShot || focus.isShot, 'focus returns to the clicked image', focus)

	await page.click('[data-e2e="shot-1"]')
	await page.waitForTimeout(400)
	await page.keyboard.press('Escape')
	await page.waitForTimeout(200)
	check(!(await preview(page)).isOpen, 'Escape closes', undefined)

	await page.click('[data-e2e="shot-0"]')
	await page.waitForTimeout(400)
	await page.mouse.click(200, 860)
	await page.waitForTimeout(200)
	check(!(await preview(page)).isOpen, 'a backdrop click closes', undefined)

	const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
	await page.click('[data-e2e="shot-0"]', { modifiers: [modifier] })
	await page.waitForTimeout(1500)
	check(!(await preview(page)).isOpen && opened === 1, `${modifier}+click keeps GitHub's tab`, {
		opened,
	})

	if (found.away) {
		await page.screenshot({ path: join(OUTPUT, '04-before-away-click.png') })
		await page.click('[data-e2e="away"]')
		await page.waitForTimeout(3000)
		// The link opens a tab when it has target=_blank and leaves this page when it does not.
		const followed = opened === 2 || page.url() !== url
		check(followed && !(await preview(page)).isOpen, 'an image linking away is left alone', {
			opened,
			url: page.url(),
		})
	} else console.log('skip: no image linking to another site on this page')
	console.log('all checks passed; screenshots in', OUTPUT)
} finally {
	await context.close()
}
