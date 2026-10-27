// Loads the built extension into Chromium and exercises the panel on a public pull request.
// Usage: bun tooling/panel-e2e.mjs [pull request files url]
// With OPENROUTER_KEY set it seeds the settings first and waits for the model labels.
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const extensionPath = join(import.meta.dirname, '..', '.output', 'chrome-mv3')
const url = process.argv[2] ?? 'https://github.com/Mnigos/tessera/pull/165/files'
const screenshots = join(import.meta.dirname, '..', 'docs', 'screenshots')
const openRouterKey = process.env.OPENROUTER_KEY
const model = process.env.OPENROUTER_MODEL ?? 'openai/gpt-5.6-luna'
mkdirSync(screenshots, { recursive: true })

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'detent-e2e-')), {
	channel: process.env.PROBE_CHANNEL || undefined,
	executablePath: process.env.PROBE_EXECUTABLE || undefined,
	headless: false,
	viewport: { width: 1600, height: 1000 },
	args: [
		'--headless=new',
		`--disable-extensions-except=${extensionPath}`,
		`--load-extension=${extensionPath}`,
	],
})

const STATUS_LINES = [
	/^Layer names from .+\.$/,
	'Add an OpenRouter key in the extension popup to name the layers.',
	'Layer names come from the file structure.',
	'OpenRouter rejected the API key. Check it in the extension popup.',
	'OpenRouter reports no credits left.',
	'OpenRouter took too long; layer names come from the file structure.',
	'OpenRouter request failed; layer names come from the file structure.',
]

const panelState = async (page) =>
	page.evaluate(() => {
		const host = document.querySelector('detent-panel')
		const root = host?.shadowRoot
		const aside = root?.querySelector('aside')
		const current = root?.querySelector('ol li button[aria-current="true"] span span')
		const file = root?.querySelector('ul li button[aria-current="true"] span[title]')
		return {
			mounted: Boolean(root),
			panelVisible: Boolean(aside),
			status: aside?.querySelector('footer span')?.textContent?.trim(),
			header: aside?.querySelector('header')?.textContent?.trim(),
			layer: current?.textContent?.trim(),
			file: file?.getAttribute('title'),
			layers: [...(root?.querySelectorAll('ol li') ?? [])].map((li) =>
				li.querySelector('span span')?.textContent?.trim(),
			),
			summaries: [...(root?.querySelectorAll('ol li') ?? [])].map((li) =>
				li.querySelector('.line-clamp-2')?.textContent?.trim(),
			),
			dimmed: document.querySelectorAll('.detent-dimmed').length,
			sections: document.querySelectorAll('[data-tagsearch-path], [data-file-path]').length,
			scrollY: window.scrollY,
		}
	})

try {
	const page = await context.newPage()
	page.on('console', (message) => {
		if (message.text().includes('[detent]')) console.log('console:', message.text())
	})
	console.log(
		'service workers:',
		context.serviceWorkers().map((worker) => worker.url()),
	)
	page.on('console', (message) =>
		console.log('page console:', message.type(), message.text().slice(0, 200)),
	)
	if (openRouterKey) {
		const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
		await worker.evaluate((settings) => chrome.storage.local.set({ settings }), {
			openRouterKey,
			model,
		})
		console.log('seeded settings for model:', model)
	}
	await page.goto(url, { waitUntil: 'domcontentloaded' })
	await page.waitForTimeout(4000)
	console.log('url:', page.url(), 'title:', await page.title())
	console.log(
		'service workers after load:',
		context.serviceWorkers().map((worker) => worker.url()),
	)
	console.log(
		'host present:',
		await page.evaluate(() => Boolean(document.querySelector('detent-panel'))),
	)
	await page.waitForSelector('detent-panel', { state: 'attached', timeout: 20000 })
	await page.waitForTimeout(1500)
	const mounted = await panelState(page)
	console.log('after mount:', JSON.stringify(mounted))
	if (
		!STATUS_LINES.some((line) =>
			line instanceof RegExp ? line.test(mounted.status ?? '') : line === mounted.status,
		)
	)
		throw new Error(`unexpected footer status line: ${JSON.stringify(mounted.status)}`)

	console.log('status line:', JSON.stringify(mounted.status))
	if (openRouterKey) {
		const expected = `Layer names from ${model}.`
		const deadline = Date.now() + 30_000
		let state = mounted
		while (state.status !== expected && Date.now() < deadline) {
			await page.waitForTimeout(1000)
			state = await panelState(page)
		}
		if (state.status !== expected)
			throw new Error(`OpenRouter labels did not arrive: ${JSON.stringify(state.status)}`)

		console.log('model labels:')
		for (const [index, name] of state.layers.entries())
			console.log(`  ${index + 1}. ${name} — ${state.summaries[index] ?? ''}`)
	}
	await page.screenshot({ path: join(screenshots, 'e2e-01-mounted.png') })

	await page.keyboard.press('j')
	await page.keyboard.press('j')
	await page.waitForTimeout(600)
	console.log('after j j:', JSON.stringify(await panelState(page)))
	await page.screenshot({ path: join(screenshots, 'e2e-02-after-jj.png') })

	await page.keyboard.press('n')
	await page.waitForTimeout(600)
	console.log('after n:', JSON.stringify(await panelState(page)))
	await page.screenshot({ path: join(screenshots, 'e2e-03-after-n.png') })

	await page.keyboard.press('r')
	await page.waitForTimeout(300)
	console.log('after r:', JSON.stringify(await panelState(page)))

	await page.keyboard.press('`')
	await page.waitForTimeout(300)
	console.log('after backtick:', JSON.stringify(await panelState(page)))
	await page.screenshot({ path: join(screenshots, 'e2e-04-collapsed.png') })
} finally {
	await context.close()
}
