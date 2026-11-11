// Loads the built extension into headless Chromium, signed out, and reads the list stats rows.
// Usage: bun run build && node tooling/list-code-lines-e2e.mjs [pull request list url] [screenshot directory]
// Diffs are asked for only near the viewport, so the page is scrolled a screen at a time until every row shows its
// stats. The service worker sends the diff requests, so its fetch is wrapped: each diff is recorded and answered with
// a hand-written one, since GitHub rate-limits signed-out diffs. Odd rows get code, a test file, a blank and a comment
// line, so they show `(+2 −1)`; even rows only code, so they show no code part. REAL_DIFFS=1 sends the diffs to
// GitHub and only checks the format.
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const extensionPath = join(import.meta.dirname, '..', '.output', 'chrome-mv3')
const url = process.argv[2] ?? 'https://github.com/TanStack/router/pulls'
const screenshots = process.argv[3] ?? join(tmpdir(), 'detent-code-lines')
mkdirSync(screenshots, { recursive: true })
const REAL_DIFFS = process.env.REAL_DIFFS === '1'
const STUB = {
	odd: {
		text: '·+6−2(+2−1)·2 files',
		excluded: 'Excluded: tests +2 −1, blank and comment lines +2.',
	},
	even: { text: '·+2−1·1 file' },
}

// Runs inside the service worker: records every diff request and, unless realDiffs, answers it from the stub.
function wrapWorkerFetch({ realDiffs }) {
	const original = globalThis.__detentOriginalFetch ?? globalThis.fetch
	globalThis.__detentOriginalFetch = original
	globalThis.__detentDiffs = []
	globalThis.__detentLastRequestAt = Date.now()
	const code = (number) =>
		`diff --git a/src/${number}.ts b/src/${number}.ts\n--- a/src/${number}.ts\n+++ b/src/${number}.ts\n`
	globalThis.fetch = async function (input, init) {
		const target = new URL(String(input?.url ?? input))
		const match = /\/pull\/(\d+)\.diff$/.exec(target.pathname)
		if (!match) return original.call(this, input, init)

		const number = Number(match[1])
		globalThis.__detentDiffs.push(number)
		globalThis.__detentLastRequestAt = Date.now()
		if (realDiffs) return original.call(this, input, init)
		if (number % 2 === 0) return new Response(`${code(number)}@@ -1 +1,2 @@\n-old\n+new\n+added\n`)

		return new Response(
			`${code(number)}@@ -1 +1,4 @@\n-old\n+new\n+added\n+\n+// note\n` +
				`diff --git a/src/${number}.spec.ts b/src/${number}.spec.ts\n--- a/src/${number}.spec.ts\n` +
				`+++ b/src/${number}.spec.ts\n@@ -1 +1,2 @@\n-old test\n+new test\n+more test\n`,
		)
	}
}

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

// Every row of the list, with what detent added to it, if anything.
const readRows = (page) =>
	page.evaluate(() =>
		[...document.querySelectorAll('li a[data-testid="listitem-title-link"]')].map((link) => {
			const element = link.closest('li')?.querySelector('[data-detent-diff-stats]')
			return {
				number: Number(/\/pull\/(\d+)/.exec(link.getAttribute('href') ?? '')?.[1]),
				text: element?.textContent ?? null,
				title: element?.querySelector('[title]')?.getAttribute('title') ?? null,
			}
		}),
	)

// Scrolls a screen at a time, as a reader would, waiting until the rows on screen show their stats and the worker has
// sent nothing for a second. Rows flung past before their turn comes are let go, so a jump to the end would leave
// rows bare.
async function scrollToEnd(page, worker) {
	for (let step = 0; step < 20; step += 1) {
		await page
			.waitForFunction(
				() =>
					[...document.querySelectorAll('li a[data-testid="listitem-title-link"]')]
						.map((link) => link.closest('li'))
						.filter((row) => {
							const { top, bottom } = row.getBoundingClientRect()
							return bottom > 0 && top < window.innerHeight
						})
						.every((row) => row.querySelector('[data-detent-diff-stats]')),
				null,
				{ timeout: 20_000 },
			)
			.catch(() => undefined)
		for (let wait = 0; wait < 40; wait += 1) {
			await page.waitForTimeout(250)
			const quiet = await worker.evaluate(() => Date.now() - globalThis.__detentLastRequestAt)
			if (quiet > 1000) break
		}
		const isAtEnd = await page.evaluate(() => {
			const before = window.scrollY
			window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'instant' })
			return window.scrollY === before
		})
		if (isAtEnd) return
	}
}

let failed = false
const fail = (message) => {
	failed = true
	console.error(message)
}
try {
	const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
	await worker.evaluate(wrapWorkerFetch, { realDiffs: REAL_DIFFS })
	const page = context.pages()[0] ?? (await context.newPage())
	page.on('console', (message) => {
		if (message.text().includes('[detent]')) console.log('console:', message.text())
	})
	await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
	await page.waitForSelector('[data-detent-diff-stats]', { timeout: 30_000 })
	await scrollToEnd(page, worker)
	await page.waitForTimeout(2000)
	const rows = await readRows(page)
	const diffs = await worker.evaluate(() => globalThis.__detentDiffs)

	for (const row of rows)
		console.log(
			`#${row.number} ${row.text}${row.title ? `\n  ${row.title.replaceAll('\n', ' | ')}` : ''}`,
		)
	const format = /^·\+[\d ]+−[\d ]+(\(\+[\d ]+−[\d ]+\))?·[\d ]+ files?$/
	const bare = rows.filter((row) => row.text === null)
	const malformed = rows.filter((row) => row.text !== null && !format.test(row.text))
	const withCode = rows.filter((row) => row.text?.includes('('))
	console.log(
		`rows: ${rows.length}, bare: ${bare.length}, with code part: ${withCode.length}, malformed: ${malformed.length}, diff requests: ${diffs.length}`,
	)
	if (rows.length === 0) fail('no list rows found')
	if (bare.length > 0) fail(`rows without stats after scrolling: ${bare.map((row) => row.number)}`)
	if (new Set(diffs).size !== diffs.length) fail('a diff was requested more than once')
	if (
		malformed.length > 0 ||
		withCode.length === 0 ||
		withCode.some((row) => !/^Lines of code, .+\nExcluded: /.test(row.title ?? ''))
	)
		fail('expected "+a −d (+c −e) · N files" rows titled "Lines of code, …" then "Excluded:"')
	if (!REAL_DIFFS) {
		const wrong = rows.filter((row) =>
			row.number % 2 === 1
				? row.text !== STUB.odd.text || !row.title?.includes(STUB.odd.excluded)
				: row.text !== STUB.even.text || row.title !== null,
		)
		if (wrong.length > 0)
			fail(`rows not matching the stubbed diff: ${wrong.map((row) => row.number)}`)
	}

	await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
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
