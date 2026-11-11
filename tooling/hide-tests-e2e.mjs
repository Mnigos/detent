// Loads the built extension into headless Chromium, logged out, and checks the Hide tests switch on
// the classic Files changed page of a public pull request with test files.
// Usage: bun tooling/hide-tests-e2e.mjs [pull request files url]
// Screenshots and report.json land in a fresh /tmp/detent-hide-tests-e2e-* directory (E2E_OUTPUT moves it).
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { classifyRole } from '../src/lib/layers/roles.ts'

const extensionPath = join(import.meta.dirname, '..', '.output', 'chrome-mv3')
const url = process.argv[2] ?? 'https://github.com/TanStack/router/pull/8170/files'
const output = mkdtempSync(join(process.env.E2E_OUTPUT ?? '/tmp', 'detent-hide-tests-e2e-'))
const report = { url, output, steps: [] }

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

function check(condition, message) {
	if (!condition) throw new Error(message)
}

// Every file section on the page with whether it takes up space, and what the panel shows.
const pageState = (page) =>
	page.evaluate(() => {
		const sections = new Map()
		for (const element of document.querySelectorAll('[data-tagsearch-path], [data-file-path]')) {
			const path =
				element.getAttribute('data-tagsearch-path') ?? element.getAttribute('data-file-path')
			// GitHub's inline wrapper keeps a zero-height box around a hidden section.
			const shown = element.getBoundingClientRect().height > 0
			sections.set(path, (sections.get(path) ?? false) || shown)
		}
		const host = document.querySelector('detent-panel')
		const root = host?.shadowRoot
		const toggle = [...(root?.querySelectorAll('header button') ?? [])].find(
			(button) => button.textContent === 'Hide tests',
		)

		return {
			isNewHost: host !== window.__detentHost,
			sections: [...sections].map(([path, shown]) => ({ path, shown })),
			pressed: toggle?.getAttribute('aria-pressed'),
			hint: root?.querySelector('[data-detent-hint]')?.textContent ?? null,
			layers: [...(root?.querySelectorAll('ol > li') ?? [])].map((item) =>
				item.querySelector('span span')?.textContent?.trim(),
			),
			counters: [...(root?.querySelectorAll('ol > li .tabular-nums') ?? [])]
				.map((element) => element.textContent?.trim())
				.filter((text) => text?.includes('files')),
			listed: [...(root?.querySelectorAll('ul li span[title]') ?? [])].map(
				(span) => span.getAttribute('title')?.split('\n')[0],
			),
			current: root
				?.querySelector('ul li button[aria-current="true"] span[title]')
				?.getAttribute('title')
				?.split('\n')[0],
		}
	})

const storedHideTests = async () => {
	const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))

	return worker.evaluate(async () => (await chrome.storage.local.get('hideTests')).hideTests)
}

async function step(page, name, state) {
	const path = join(output, `${String(report.steps.length + 1).padStart(2, '0')}-${name}.png`)
	await page.screenshot({ path })
	report.steps.push({ name, screenshot: path, state })
	console.log(`${name}:`, JSON.stringify({ ...state, sections: state.sections.length }))
}

const isTest = (path) => classifyRole(path) === 'test'

try {
	const page = await context.newPage()
	page.on('console', (message) => {
		if (message.text().includes('[detent]')) console.log('console:', message.text())
	})
	await page.goto(url, { waitUntil: 'domcontentloaded' })
	await page.waitForSelector('detent-panel', { state: 'attached', timeout: 30_000 })
	await page.waitForFunction(
		() => document.querySelector('detent-panel')?.shadowRoot?.querySelector('aside header'),
		undefined,
		{ timeout: 30_000 },
	)
	await page.waitForTimeout(2000)
	await page.evaluate(() => {
		window.__detentHost = document.querySelector('detent-panel')
	})

	const before = await pageState(page)
	await step(page, 'tests-shown', before)
	const tests = before.sections.filter(({ path }) => isTest(path))
	check(tests.length > 0, `no test file sections on ${url}`)
	check(
		tests.every(({ shown }) => shown),
		'a test diff was hidden before the switch was on',
	)
	check(before.pressed === 'false', `Hide tests starts pressed: ${before.pressed}`)
	check(before.hint === null, 'the hint shows while tests are shown')
	check((await storedHideTests()) === undefined, 'hideTests was stored before any toggle')

	const toggle = page.locator('detent-panel').getByRole('button', { name: 'Hide tests' })
	await toggle.focus()
	await page.keyboard.press('Enter')
	await page.waitForTimeout(800)
	const hidden = await pageState(page)
	await step(page, 'tests-hidden', hidden)
	check(hidden.pressed === 'true', 'Enter on the focused switch did not turn it on')
	check(!hidden.isNewHost, 'the panel remounted (and refetched) when the filter changed')
	for (const { path, shown } of hidden.sections)
		check(shown === !isTest(path), `${path} is ${shown ? 'shown' : 'hidden'} with tests hidden`)
	check(
		hidden.listed.every((path) => !isTest(path)),
		`the panel still lists a test file: ${hidden.listed.find(isTest)}`,
	)
	const totalTests = new Set(tests.map(({ path }) => path)).size
	check(
		hidden.hint?.startsWith(`${totalTests} test file${totalTests === 1 ? '' : 's'} hidden`),
		`unexpected hint: ${hidden.hint}`,
	)
	check((await storedHideTests()) === true, 'hideTests was not saved')

	// j walks every file still shown and never lands on a hidden test.
	const visited = []
	for (let index = 0; index < hidden.sections.length; index += 1) {
		await page.keyboard.press('j')
		await page.waitForTimeout(80)
		visited.push((await pageState(page)).current)
	}
	check(
		visited.every((path) => path && !isTest(path)),
		`j landed on a test: ${visited.find(isTest)}`,
	)
	report.visited = [...new Set(visited)]

	await page.reload({ waitUntil: 'domcontentloaded' })
	await page.waitForFunction(
		() => document.querySelector('detent-panel')?.shadowRoot?.querySelector('aside header'),
		undefined,
		{ timeout: 30_000 },
	)
	await page.waitForTimeout(2000)
	const reloaded = await pageState(page)
	await step(page, 'reloaded-still-hidden', reloaded)
	check(reloaded.pressed === 'true', 'the choice was not remembered across a reload')
	check(
		reloaded.sections.filter(({ path }) => isTest(path)).every(({ shown }) => !shown),
		'a test diff is shown after the reload',
	)
	await page.evaluate(() => {
		window.__detentHost = document.querySelector('detent-panel')
	})

	await page.locator('detent-panel').getByRole('button', { name: 'Show' }).click()
	await page.waitForTimeout(800)
	const restored = await pageState(page)
	await step(page, 'tests-restored', restored)
	check(restored.pressed === 'false', 'Show did not turn the switch off')
	check(!restored.isNewHost, 'the panel remounted when the filter was turned off')
	check(restored.hint === null, 'the hint stayed after showing tests')
	check(
		restored.sections.every(({ shown }) => shown),
		`a diff stayed hidden: ${restored.sections.find(({ shown }) => !shown)?.path}`,
	)
	check((await storedHideTests()) === false, 'hideTests was not saved as off')

	report.result = 'pass'
	console.log(`PASS · ${totalTests} test files · report ${join(output, 'report.json')}`)
} catch (error) {
	report.result = 'fail'
	report.error = String(error)
	throw error
} finally {
	writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2))
	await context.close()
}
