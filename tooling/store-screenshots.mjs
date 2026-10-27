// Captures the Chrome Web Store screenshots (1280x800) from the built extension on a public pull
// request. Usage: bun tooling/store-screenshots.mjs [pull request files url]
// With OPENROUTER_KEY set the layers carry model names; without it, structural ones.
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const extensionPath = join(import.meta.dirname, '..', '.output', 'chrome-mv3')
const url = process.argv[2] ?? 'https://github.com/TanStack/router/pull/8170/files'
const output = join(import.meta.dirname, '..', 'docs', 'store')
mkdirSync(output, { recursive: true })

const context = await chromium.launchPersistentContext(
	mkdtempSync(join(tmpdir(), 'detent-shots-')),
	{
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

try {
	const page = await context.newPage()
	if (process.env.OPENROUTER_KEY) {
		const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
		await worker.evaluate((settings) => chrome.storage.local.set({ settings }), {
			openRouterKey: process.env.OPENROUTER_KEY,
			model: process.env.OPENROUTER_MODEL ?? 'openai/gpt-5.6-luna',
		})
	}
	await page.goto(url, { waitUntil: 'domcontentloaded' })
	await page.waitForSelector('detent-panel', { state: 'attached', timeout: 30000 })
	await page.waitForTimeout(process.env.OPENROUTER_KEY ? 25000 : 2500)
	await page.screenshot({ path: join(output, 'screenshot-1-layers.png') })
	await page.keyboard.press('j')
	await page.keyboard.press('j')
	await page.waitForTimeout(800)
	await page.screenshot({ path: join(output, 'screenshot-2-navigation.png') })
	await page.keyboard.press('n')
	await page.waitForTimeout(800)
	await page.screenshot({ path: join(output, 'screenshot-3-next-layer.png') })
	console.log('screenshots written to', output)
} finally {
	await context.close()
}
