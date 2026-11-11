// Loads the built extension into headless Chromium, logged out, and reads the list stats rows.
// Usage: bun tooling/list-code-lines-e2e.mjs [pull request list url] [screenshot directory]
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const extensionPath = join(import.meta.dirname, '..', '.output', 'chrome-mv3')
const url = process.argv[2] ?? 'https://github.com/TanStack/router/pulls'
const screenshots = process.argv[3] ?? join(tmpdir(), 'detent-code-lines')
mkdirSync(screenshots, { recursive: true })

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'detent-e2e-')), {
	channel: process.env.PROBE_CHANNEL || undefined,
	executablePath: process.env.PROBE_EXECUTABLE || undefined,
	headless: false,
	viewport: { width: 1400, height: 1000 },
	args: [
		'--headless=new',
		`--disable-extensions-except=${extensionPath}`,
		`--load-extension=${extensionPath}`,
	],
})

const readRows = (page) =>
	page.evaluate(() =>
		[...document.querySelectorAll('[data-detent-diff-stats]')].map((element) => ({
			number: element.dataset.detentDiffStats?.split(':')[0]?.split('/')[2],
			text: element.textContent,
			title: element.querySelector('[title]')?.getAttribute('title') ?? null,
		})),
	)

let failed = false
try {
	const page = await context.newPage()
	page.on('console', (message) => {
		if (message.text().includes('[detent]')) console.log('console:', message.text())
	})
	await page.goto(url, { waitUntil: 'domcontentloaded' })
	await page.waitForSelector('[data-detent-diff-stats]', { timeout: 30_000 })
	// Rows load three at a time; wait until the count stops growing.
	let rows = []
	for (let previous = -1; rows.length !== previous; ) {
		previous = rows.length
		await page.waitForTimeout(4000)
		rows = await readRows(page)
	}

	for (const row of rows)
		console.log(
			`#${row.number} ${row.text}${row.title ? `\n  ${row.title.replaceAll('\n', ' | ')}` : ''}`,
		)
	const format = /^·\+[\d\u2009]+−[\d\u2009]+(\(\+[\d\u2009]+−[\d\u2009]+\))?·[\d\u2009]+ files?$/
	const malformed = rows.filter((row) => !format.test(row.text ?? ''))
	const withCode = rows.filter((row) => row.text?.includes('('))
	console.log(
		`rows: ${rows.length}, with code part: ${withCode.length}, malformed: ${malformed.length}`,
	)
	if (
		malformed.length > 0 ||
		withCode.length === 0 ||
		withCode.some((row) => !/^Lines of code, .+\nExcluded: /.test(row.title ?? ''))
	) {
		failed = true
		console.error(
			'expected "+a −d (+c −e) · N files" rows titled "Lines of code, …" then "Excluded:"',
		)
	}

	await page.screenshot({ path: join(screenshots, 'list.png') })
	const first = page.locator('[data-detent-diff-stats] [title]').first()
	if ((await first.count()) > 0) {
		const row = first.locator('xpath=ancestor::li[1]')
		await row.screenshot({ path: join(screenshots, 'row.png') })
		await first.hover()
		await page.waitForTimeout(1500)
		await page.screenshot({ path: join(screenshots, 'hover.png') })
	}
	console.log('screenshots:', screenshots)
} catch (error) {
	failed = true
	console.error(error)
} finally {
	await context.close()
}
process.exit(failed ? 1 : 0)
