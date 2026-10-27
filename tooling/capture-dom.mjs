// Opens Helium with a persistent test profile (log in to GitHub there once) and saves a trimmed
// snapshot of a pull request's Files changed page for selector work.
// Usage: bun tooling/capture-dom.mjs <pull request changes url> [output html path]
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { chromium } from 'playwright'

const url = process.argv[2]
if (!url) throw new Error('pull request url required')
const output =
	process.argv[3] ?? join(import.meta.dirname, '..', 'fixtures', 'github-changes-page.html')
const profile = join(homedir(), 'Library', 'Application Support', 'detent-for-github-helium')
mkdirSync(profile, { recursive: true })
mkdirSync(dirname(output), { recursive: true })

const context = await chromium.launchPersistentContext(profile, {
	executablePath: '/Applications/Helium.app/Contents/MacOS/Helium',
	headless: false,
	viewport: { width: 1600, height: 1000 },
})

try {
	const page = context.pages()[0] ?? (await context.newPage())
	await page.goto(url, { waitUntil: 'domcontentloaded' })
	const signedIn = () =>
		page.evaluate(() => Boolean(document.querySelector('meta[name="user-login"]')?.content))
	if (!(await signedIn())) {
		console.log('Not signed in. Log in to GitHub in the Helium window; waiting for the login.')
		await page.waitForFunction(
			() => Boolean(document.querySelector('meta[name="user-login"]')?.content),
			undefined,
			{ timeout: Number(process.env.LOGIN_WAIT_MS ?? 300_000) },
		)
		await page.goto(url, { waitUntil: 'domcontentloaded' })
	}
	await page.waitForTimeout(6000)

	const facts = await page.evaluate(() => {
		const count = (selector) => document.querySelectorAll(selector).length
		const sample = (selector, attribute) =>
			[...document.querySelectorAll(selector)]
				.slice(0, 3)
				.map((element) => element.getAttribute(attribute))
		return {
			url: location.href,
			user: document.querySelector('meta[name="user-login"]')?.content,
			diffIds: count('[id^="diff-"]'),
			diffIdSamples: [...document.querySelectorAll('[id^="diff-"]')].slice(0, 3).map((e) => e.id),
			dataFilePath: count('[data-file-path]'),
			dataTagsearchPath: count('[data-tagsearch-path]'),
			dataPath: count('[data-path]'),
			viewedCheckboxes: count('input[type="checkbox"]'),
			viewedLabels: [...document.querySelectorAll('label, button')]
				.filter((e) => /viewed/i.test(e.textContent ?? ''))
				.slice(0, 3)
				.map((e) => e.outerHTML.slice(0, 300)),
			fileTreeLinks: count('a[href*="#diff-"]'),
			fileTreeSamples: sample('a[href*="#diff-"]', 'href'),
			colorMode: document.documentElement.dataset.colorMode,
			stickyVars: getComputedStyle(document.documentElement).getPropertyValue(
				'--observed-header-height',
			),
		}
	})
	console.log(JSON.stringify(facts, undefined, 2))

	const html = await page.evaluate(() => {
		const clone = document.documentElement.cloneNode(true)
		for (const element of clone.querySelectorAll('script, style, svg, link')) element.remove()
		return `<!doctype html>\n${clone.outerHTML}`
	})
	writeFileSync(output, html)
	console.log(`saved ${html.length} bytes to ${output}`)
} finally {
	await context.close()
}
