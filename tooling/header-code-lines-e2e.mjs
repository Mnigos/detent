// Loads the built extension into headless Chromium, signed out, and reads the code lines detent adds to a pull
// request's header. Usage: bun run build && node tooling/header-code-lines-e2e.mjs [pull request url] [screenshot dir]
// The service worker sends the diff requests, so its fetch is wrapped: each diff is recorded and answered with a
// hand-written one (a code file and a test file, so the header shows `(+2 −1)`), since GitHub rate-limits signed-out
// diffs. The page opens on Conversation, switches tabs inside GitHub's app, loads Files changed, and turns the list
// stats switch off at the end.
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const extensionPath = join(import.meta.dirname, '..', '.output', 'chrome-mv3')
const url = (process.argv[2] ?? 'https://github.com/TanStack/router/pull/8658').replace(/\/$/, '')
const screenshots = process.argv[3] ?? join(tmpdir(), 'detent-header-code-lines')
mkdirSync(screenshots, { recursive: true })
const { pathname } = new URL(url)
const MARKER = '[data-detent-header-code]'
const EXPECTED = '(+2−1)'

// Runs inside the service worker: records every diff request and answers it from the stub.
function wrapWorkerFetch() {
	const original = globalThis.__detentOriginalFetch ?? globalThis.fetch
	globalThis.__detentOriginalFetch = original
	globalThis.__detentDiffs = []
	globalThis.fetch = async function (input, init) {
		const target = new URL(String(input?.url ?? input))
		const match = /\/pull\/(\d+)\.diff$/.exec(target.pathname)
		if (!match) return original.call(this, input, init)

		globalThis.__detentDiffs.push(Number(match[1]))
		return new Response(
			'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1,3 @@\n-old\n+new\n+added\n+\n' +
				'diff --git a/src/a.spec.ts b/src/a.spec.ts\n--- a/src/a.spec.ts\n+++ b/src/a.spec.ts\n' +
				'@@ -1 +1,2 @@\n-old test\n+new test\n+more test\n',
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

// Every marker on the page, with the totals it follows.
const readMarkers = (page) =>
	page.evaluate(
		(selector) =>
			[...document.querySelectorAll(selector)].map((element) => ({
				text: element.textContent,
				after: element.previousElementSibling?.textContent?.trim() ?? null,
				title: element.getAttribute('title'),
				opacity: getComputedStyle(element).opacity,
				addition: getComputedStyle(element.querySelector('.fgColor-success')).color,
				deletion: getComputedStyle(element.querySelector('.fgColor-danger')).color,
			})),
		MARKER,
	)

let failed = false
const fail = (message) => {
	failed = true
	console.error(`FAIL ${message}`)
}

// Waits for the header's marker, then a little longer so a duplicate or a removal would show.
async function check(page, step) {
	await page.waitForSelector(MARKER, { timeout: 30_000 }).catch(() => undefined)
	await page.waitForTimeout(1500)
	const markers = await readMarkers(page)
	console.log(`${step}: ${page.url()}`)
	for (const marker of markers)
		console.log(
			`  ${marker.after} ${marker.text}  opacity ${marker.opacity}  ${marker.addition} / ${marker.deletion}`,
		)
	if (markers.length !== 1) fail(`${step}: expected one marker, found ${markers.length}`)
	const [marker] = markers
	if (marker && marker.text !== EXPECTED) fail(`${step}: expected ${EXPECTED}, got ${marker.text}`)
	if (
		marker &&
		!/^Lines of code, .+\nExcluded: tests \+2 −1, blank and comment lines \+1\./.test(
			marker.title ?? '',
		)
	)
		fail(`${step}: unexpected tooltip ${JSON.stringify(marker.title)}`)
	if (marker && marker.opacity !== '0.7') fail(`${step}: expected opacity 0.7`)
	if (marker && marker.addition === marker.deletion)
		fail(`${step}: additions and deletions share a colour`)

	return markers
}

async function clickTab(page, href) {
	await page.locator(`a[href="${href}"]`).first().click()
	await page.waitForURL((current) => current.pathname === href, { timeout: 30_000 })
}

try {
	const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
	await worker.evaluate(wrapWorkerFetch)
	const diffs = () => worker.evaluate(() => globalThis.__detentDiffs)
	const page = context.pages()[0] ?? (await context.newPage())
	page.on('console', (message) => {
		if (message.text().includes('[detent]')) console.log('console:', message.text())
	})

	await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
	await check(page, 'conversation')
	const header = page
		.locator(MARKER)
		.first()
		.locator('xpath=ancestor::*[@data-component="PH_Navigation"][1]')
	if ((await header.count()) > 0)
		await header.screenshot({ path: join(screenshots, 'conversation-header.png') })
	await page.locator(MARKER).first().hover()
	await page.waitForTimeout(1200)
	await page.screenshot({
		path: join(screenshots, 'conversation-hover.png'),
		clip: { x: 0, y: 0, width: 1400, height: 420 },
	})

	await clickTab(page, `${pathname}/commits`)
	await check(page, 'commits (soft navigation)')
	await clickTab(page, pathname)
	await check(page, 'conversation again (soft navigation)')
	const beforeFiles = (await diffs()).length

	await clickTab(page, `${pathname}/files`)
	await check(page, 'files changed')
	const diffstat = page.locator('#diffstat')
	if ((await diffstat.count()) > 0)
		await diffstat.screenshot({ path: join(screenshots, 'files-diffstat.png') })
	await page.screenshot({
		path: join(screenshots, 'files.png'),
		clip: { x: 0, y: 0, width: 1400, height: 420 },
	})
	const afterFiles = await diffs()
	console.log(`diff requests: ${afterFiles.length} (${beforeFiles} before Files changed)`)
	if (beforeFiles !== 1) fail(`expected one diff request before Files changed, got ${beforeFiles}`)
	// The Files changed page names the same head commit, so the cached counts are reused; the layers may download
	// the diff for themselves only on a pull request small enough to group without a click.
	const headerRequests = afterFiles.length - beforeFiles
	if (headerRequests > 1) fail(`Files changed sent ${headerRequests} diff requests`)

	await clickTab(page, `${pathname}/commits`)
	await check(page, 'commits after Files changed')

	// A fresh document on Files changed with nothing cached downloads once; a reload reuses the counts stored for the
	// head commit the page names.
	await worker.evaluate(() => chrome.storage.local.remove('diffStats:v2'))
	const beforeLoad = (await diffs()).length
	await page.goto(`${url}/files`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
	await check(page, 'files changed, loaded with nothing cached')
	const cached = await worker.evaluate(
		async () => (await chrome.storage.local.get('diffStats:v2'))['diffStats:v2'],
	)
	console.log(
		'cached entry:',
		JSON.stringify(
			Object.entries(cached ?? {}).map(([key, entry]) => [key, entry.headSha, entry.code]),
		),
	)
	await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
	await check(page, 'files changed, reloaded')
	const loads = (await diffs()).length - beforeLoad
	console.log(`diff requests for the two loads: ${loads}`)
	if (loads !== 1) fail(`expected one diff request for a cold load and its reload, got ${loads}`)
	if (!Object.values(cached ?? {}).some((entry) => /^[0-9a-f]{40}$/.test(entry.headSha ?? '')))
		fail('the counts were stored without the head commit')

	await worker.evaluate(async () => {
		const { settings = {} } = await chrome.storage.local.get('settings')
		await chrome.storage.local.set({ settings: { ...settings, showListStats: false } })
	})
	await page.waitForTimeout(1500)
	const off = await readMarkers(page)
	console.log(`switched off: ${off.length} markers`)
	if (off.length !== 0) fail('the marker stayed after the list stats switch was turned off')

	console.log('screenshots:', screenshots)
} catch (error) {
	failed = true
	console.error(error)
} finally {
	await context.close()
}
console.log(failed ? 'header e2e: FAILED' : 'header e2e: passed')
process.exit(failed ? 1 : 0)
