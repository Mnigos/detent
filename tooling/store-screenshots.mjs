// Captures the Chrome Web Store screenshots (1280x800) from the built extension, logged out, in
// Helium: the layers on a public pull request and the diff size on a public pull request list.
// Usage: bun run build && bun tooling/store-screenshots.mjs [pull request files url] [pull request list url]
// With OPENROUTER_KEY set the layers carry model names; without it, structural ones.
// HELIUM_PATH overrides the browser binary.
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const extensionPath = join(import.meta.dirname, '..', '.output', 'chrome-mv3')
const pullRequestUrl = process.argv[2] ?? 'https://github.com/TanStack/router/pull/8170/files'
const listUrl = process.argv[3] ?? 'https://github.com/TanStack/router/pulls'
const output = join(import.meta.dirname, '..', 'docs', 'store')
mkdirSync(output, { recursive: true })

const context = await chromium.launchPersistentContext(
	mkdtempSync(join(tmpdir(), 'detent-shots-')),
	{
		executablePath: process.env.HELIUM_PATH ?? '/Applications/Helium.app/Contents/MacOS/Helium',
		headless: false,
		viewport: { width: 1280, height: 800 },
		deviceScaleFactor: 1,
		colorScheme: 'dark',
		args: [
			'--headless=new',
			`--disable-extensions-except=${extensionPath}`,
			`--load-extension=${extensionPath}`,
		],
	},
)

// The diff scrolls smoothly to the selected file; a shot taken mid-scroll catches a half-painted page.
async function waitForScrollIdle(page) {
	let last = -1
	let still = 0
	while (still < 3) {
		await page.waitForTimeout(250)
		const scrollY = await page.evaluate(() => window.scrollY)
		still = scrollY === last ? still + 1 : 0
		last = scrollY
	}
	await page.waitForTimeout(500)
}

// Every pull request row on screen carries its diff size.
function visibleRowsHaveStats() {
	const rows = [...document.querySelectorAll('li')].filter((row) => {
		const top = row.getBoundingClientRect().top
		return top >= 0 && top < window.innerHeight && row.querySelector('a[href*="/pull/"]')
	})
	return rows.length > 0 && rows.every((row) => row.querySelector('[data-detent-diff-stats]'))
}

try {
	const page = await context.newPage()
	if (process.env.OPENROUTER_KEY) {
		const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
		await worker.evaluate((settings) => chrome.storage.local.set({ settings }), {
			openRouterKey: process.env.OPENROUTER_KEY,
			model: process.env.OPENROUTER_MODEL ?? 'openai/gpt-5.6-luna',
		})
	}
	await page.goto(pullRequestUrl, { waitUntil: 'domcontentloaded' })
	await page.waitForSelector('detent-panel', { state: 'attached', timeout: 30000 })
	// Without a key the missing-key notice would cover the panel's footer in every shot.
	if (!process.env.OPENROUTER_KEY)
		await page.addStyleTag({ content: '#detent-no-key { display: none !important }' })
	await page.waitForTimeout(process.env.OPENROUTER_KEY ? 25000 : 2500)
	await page.screenshot({ path: join(output, 'screenshot-1-layers.png') })
	await page.keyboard.press('j')
	await page.keyboard.press('j')
	await waitForScrollIdle(page)
	await page.screenshot({ path: join(output, 'screenshot-2-navigation.png') })
	await page.keyboard.press('n')
	await waitForScrollIdle(page)
	await page.screenshot({ path: join(output, 'screenshot-3-next-layer.png') })

	await page.goto(listUrl, { waitUntil: 'domcontentloaded' })
	await page.waitForSelector('[data-detent-diff-stats]', { timeout: 30000 })
	await page.waitForFunction(visibleRowsHaveStats, undefined, { timeout: 60000 })
	await page.waitForTimeout(1000)
	await page.screenshot({ path: join(output, 'screenshot-4-list-stats.png') })
	console.log('screenshots written to', output)
} finally {
	await context.close()
}
