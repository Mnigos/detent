// Captures the Chrome Web Store screenshots (1280x800 PNG) from the built extension in headless Playwright Chromium,
// in a fresh temporary profile, signed out, on public TanStack/router pages. It never starts a visible browser.
// Usage: bun run build && node tooling/store-screenshots.mjs
// 1. layers: the classic Files changed page with the panel and Hide tests switched on.
// 2. list: the pull request list with diff sizes and code lines. Conflict markers need a GitHub sign-in, so the
//    list's empty user-login meta tag is filled in and the merge box answers are stubbed in the service worker, the
//    way tooling/list-conflicts-e2e.mjs does: one row conflicts, one cannot be rebased, one has unresolved comments.
// 3. header: a pull request's header with the code lines after GitHub's +additions −deletions.
//    A label in the corner of the shot says the markers are illustrated.
// 4. image preview: an image from a pull request description opened over the page.
// 5. popup: the popup with the provider choice, laid over the layers page.
// Priority Review is not captured: it lives on GitHub's new Changes page, which GitHub serves only to signed-in users.
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const EXTENSION = join(import.meta.dirname, '..', '.output', 'chrome-mv3')
const OUTPUT = join(import.meta.dirname, '..', 'docs', 'store')
const PULL_REQUEST = 'https://github.com/TanStack/router/pull/8170'
const LIST = 'https://github.com/TanStack/router/pulls'
const IMAGES = 'https://github.com/TanStack/router/pull/7338'
const SIZE = { width: 1280, height: 800 }
const REBASE_QUERY = '?merge_method=REBASE&bypass_requirements=false'
mkdirSync(OUTPUT, { recursive: true })
const shot = (name) => join(OUTPUT, name)

// Headless Chromium names itself HeadlessChrome, which GitHub may treat differently; send the desktop Chrome one.
const probe = await chromium.launch()
const userAgent = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${probe.version()} Safari/537.36`
await probe.close()

const context = await chromium.launchPersistentContext(
	mkdtempSync(join(tmpdir(), 'detent-shots-')),
	{
		headless: false,
		viewport: SIZE,
		deviceScaleFactor: 1,
		colorScheme: 'dark',
		userAgent,
		args: [
			'--headless=new',
			`--user-agent=${userAgent}`,
			`--disable-extensions-except=${EXTENSION}`,
			`--load-extension=${EXTENSION}`,
		],
	},
)
const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
const extensionId = new URL(worker.url()).host

// Without a provider the panel shows a notice over its footer; it would cover the panel in every shot.
const hideNotice = (page) =>
	page.addStyleTag({ content: '#detent-no-key { display: none !important }' })

// Runs inside the service worker: merge box requests get the stubbed answer, everything else goes to GitHub.
function stubMergeBoxes({ conflicts, rebaseBlocked, unresolved, rebaseQuery }) {
	const original = globalThis.__detentOriginalFetch ?? globalThis.fetch
	globalThis.__detentOriginalFetch = original
	const condition = (result) => ({
		type: 'PULL_REQUEST_MERGE_CONFLICT_STATE',
		result,
		conflicts: [],
	})
	const resolution = (number) => {
		const result = unresolved.includes(number) ? 'FAILED' : 'PASSED'
		return {
			type: 'PULL_REQUEST_RULES',
			result,
			ruleRollups: [{ ruleType: 'REQUIRED_REVIEW_THREAD_RESOLUTION', result, metadata: null }],
		}
	}
	const pullRequest = (number, mergeStateStatus) => ({
		state: 'OPEN',
		mergeStateStatus,
		viewerMergeActions: [
			{
				name: 'DIRECT_MERGE',
				mergeMethods: [
					{ name: 'MERGE', allowableStatus: 'DISABLED' },
					{ name: 'SQUASH', allowableStatus: 'ALLOWED' },
					{
						name: 'REBASE',
						allowableStatus: rebaseBlocked.includes(number) ? 'ALLOWED' : 'DISABLED',
					},
				],
			},
		],
	})
	function answer(number, query) {
		if (query === rebaseQuery)
			return {
				pullRequest: pullRequest(number, 'CLEAN'),
				mergeRequirements: {
					conditions: [condition(rebaseBlocked.includes(number) ? 'FAILED' : 'PASSED')],
				},
			}
		if (conflicts.includes(number))
			return {
				pullRequest: pullRequest(number, 'DIRTY'),
				mergeRequirements: { conditions: [condition('FAILED'), resolution(number)] },
			}
		return {
			pullRequest: pullRequest(number, unresolved.includes(number) ? 'BLOCKED' : 'CLEAN'),
			mergeRequirements: { conditions: [condition('PASSED'), resolution(number)] },
		}
	}
	globalThis.fetch = async function (input, init) {
		const url = new URL(String(input?.url ?? input))
		const match = /\/pull\/(\d+)\/page_data\/merge_box$/.exec(url.pathname)
		if (!match) return original.call(this, input, init)
		return Response.json(answer(Number(match[1]), url.search))
	}
}

// Every row on screen carries its diff size, and every stubbed marker has appeared.
function listIsReady(markers) {
	const rows = [...document.querySelectorAll('li a[data-testid="listitem-title-link"]')]
		.map((link) => link.closest('li'))
		.filter((row) => {
			const { top, bottom } = row.getBoundingClientRect()
			return bottom > 0 && top < window.innerHeight
		})
	const shown = document.querySelectorAll('[data-detent-conflicts], [data-detent-unresolved]')
	return (
		rows.length > 0 &&
		rows.every((row) => row.querySelector('[data-detent-diff-stats]')) &&
		shown.length >= markers
	)
}

async function layers(page) {
	await page.goto(`${PULL_REQUEST}/files`, { waitUntil: 'domcontentloaded' })
	await page.waitForSelector('detent-panel', { state: 'attached', timeout: 30_000 })
	await hideNotice(page)
	await page.waitForTimeout(3000)
	await page.locator('detent-panel >> header button', { hasText: 'Hide tests' }).click()
	await page.waitForSelector('detent-panel >> [data-detent-hint]', { timeout: 10_000 })
	await page.waitForTimeout(1500)
	await page.screenshot({ path: shot('screenshot-1-layers-hide-tests.png') })
}

async function list(page) {
	// Signed out first, to pick the open rows on screen that get a marker.
	await page.goto(LIST, { waitUntil: 'domcontentloaded' })
	await page.waitForSelector('li a[data-testid="listitem-title-link"]')
	const open = await page.evaluate(() =>
		[...document.querySelectorAll('li a[data-testid="listitem-title-link"]')]
			.filter((link) => {
				const row = link.closest('li')
				const isOpen =
					row?.querySelector('svg.octicon')?.getAttribute('aria-label') === 'Open pull request'
				return isOpen && row.getBoundingClientRect().top < window.innerHeight
			})
			.map((link) => Number(/\/pull\/(\d+)/.exec(link.getAttribute('href') ?? '')?.[1])),
	)
	const rules = {
		conflicts: open.filter((_, index) => index === 1),
		rebaseBlocked: open.filter((_, index) => index === 4),
		unresolved: open.filter((_, index) => index === 1 || index === 6),
	}
	await worker.evaluate(stubMergeBoxes, { ...rules, rebaseQuery: REBASE_QUERY })
	await page.route(
		(target) => target.pathname === new URL(LIST).pathname,
		async (route) => {
			if (route.request().headers().accept?.includes('application/json')) return route.continue()
			const response = await route.fetch()
			const body = (await response.text()).replace(
				'<meta name="user-login" content="">',
				'<meta name="user-login" content="detent-screenshots">',
			)
			await route.fulfill({ response, body })
		},
	)
	await page.goto(LIST, { waitUntil: 'domcontentloaded' })
	const markers = new Set([...rules.conflicts, ...rules.rebaseBlocked, ...rules.unresolved]).size
	await page.waitForFunction(listIsReady, markers, { timeout: 90_000 })
	await page.waitForTimeout(1500)
	// The merge states are stubbed on real pull requests; the image says so itself, since the store has no captions.
	await page.evaluate(() => {
		const label = document.createElement('div')
		label.textContent = 'Merge markers illustrated. They need a GitHub sign-in.'
		label.style.cssText =
			'position:fixed;right:16px;bottom:16px;z-index:99999;padding:6px 12px;border-radius:6px;' +
			'background:#1f2328;color:#f0f6fc;border:1px solid #3d444d;font:13px system-ui,sans-serif'
		document.body.append(label)
	})
	await page.screenshot({ path: shot('screenshot-2-list-sizes-markers.png') })
	await page.unrouteAll({ behavior: 'wait' })
}

async function header(page) {
	await page.goto(PULL_REQUEST, { waitUntil: 'domcontentloaded' })
	await page.waitForSelector('[data-detent-header-code]', { timeout: 60_000 })
	await page.waitForTimeout(1500)
	await page.screenshot({ path: shot('screenshot-3-header-code-lines.png') })
}

async function imagePreview(page) {
	await page.goto(IMAGES, { waitUntil: 'domcontentloaded' })
	await page.waitForSelector('.markdown-body img')
	await page.waitForTimeout(3000)
	await page
		.locator('[data-testid="pr-body"] .markdown-body img, .comment-body img')
		.first()
		.click()
	await page.waitForSelector('detent-image-preview', { state: 'attached', timeout: 10_000 })
	await page.waitForTimeout(1500)
	await page.screenshot({ path: shot('screenshot-4-image-preview.png') })
	await page.keyboard.press('Escape')
}

// The popup is a page of its own; it is captured alone and laid over the layers shot where Chrome opens it.
async function popup(page) {
	await worker.evaluate(() =>
		chrome.storage.local
			.get('settings')
			.then(({ settings }) =>
				chrome.storage.local.set({ settings: { ...settings, provider: 'chatgpt' } }),
			),
	)
	await page.setViewportSize({ width: 480, height: 800 })
	await page.goto(`chrome-extension://${extensionId}/popup.html`)
	await page.getByText('Continue with ChatGPT').waitFor({ timeout: 10_000 })
	await page.waitForTimeout(500)
	const popupImage = await page.locator('main').screenshot()
	await page.setViewportSize(SIZE)
	const background = readFileSync(shot('screenshot-1-layers-hide-tests.png'))
	const source = (buffer) => `data:image/png;base64,${buffer.toString('base64')}`
	await page.setContent(`<!doctype html>
		<body style="margin:0;width:1280px;height:800px;overflow:hidden;background:#0d1117">
			<img src="${source(background)}" style="position:absolute;inset:0">
			<img src="${source(popupImage)}" style="position:absolute;top:12px;right:16px;border:1px solid #3d444d;border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,.6)">
		</body>`)
	await page.waitForTimeout(300)
	await page.screenshot({ path: shot('screenshot-5-popup.png') })
}

try {
	const page = context.pages()[0] ?? (await context.newPage())
	await layers(page)
	await list(page)
	await header(page)
	await imagePreview(page)
	await popup(page)
	console.log('screenshots written to', OUTPUT)
} finally {
	await context.close()
}
