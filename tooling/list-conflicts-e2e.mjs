// Loads the built extension into headless Chromium, signed out, on a public pull request list.
// Usage: bun run build && node tooling/list-conflicts-e2e.mjs
// Run 1 (signed out as GitHub serves it): no merge box request and no marker, the diff stats still show.
// Run 2 (simulated sign-in): the list's empty user-login meta tag is filled in and every merge box request is
// answered from CONFLICTS (DIRTY), UNKNOWN (UNKNOWN) or CLEAN, so the marker path runs on GitHub's real list DOM.
// The real signed-in merge box answer is not covered; check it by hand in a signed-in browser.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const EXTENSION_PATH = join(import.meta.dirname, '..', '.output', 'chrome-mv3')
const OUTPUT = mkdtempSync(join(tmpdir(), 'detent-conflicts-e2e-'))
const LIST = process.env.LIST ?? 'https://github.com/TanStack/router/pulls'
const CLOSED = `${LIST}?q=is%3Apr+is%3Aclosed`
// TanStack/router #8842 had mergeable_state "dirty" in the REST API on 2026-11-07.
const CONFLICTS = (process.env.CONFLICTS ?? '8842').split(',').map(Number)
const UNKNOWN = (process.env.UNKNOWN ?? '8858').split(',').map(Number)
const MERGE_BOX = /\/pull\/(\d+)\/page_data\/merge_box/

async function run(name, url, { signedIn }) {
	const context = await chromium.launchPersistentContext(
		mkdtempSync(join(tmpdir(), 'detent-e2e-')),
		{
			headless: false,
			viewport: { width: 1400, height: 1000 },
			args: [
				'--headless=new',
				`--disable-extensions-except=${EXTENSION_PATH}`,
				`--load-extension=${EXTENSION_PATH}`,
			],
		},
	)
	const page = context.pages()[0] ?? (await context.newPage())
	const asked = []
	page.on('request', (request) => {
		const match = MERGE_BOX.exec(request.url())
		if (match) asked.push(Number(match[1]))
	})
	if (signedIn) {
		await page.route(
			(target) => target.pathname.endsWith('/pulls'),
			async (route) => {
				const response = await route.fetch()
				const body = (await response.text()).replace(
					'<meta name="user-login" content="">',
					'<meta name="user-login" content="detent-e2e">',
				)
				await route.fulfill({ response, body })
			},
		)
		await page.route(MERGE_BOX, (route) => {
			const number = Number(MERGE_BOX.exec(route.request().url())?.[1])
			const status = CONFLICTS.includes(number)
				? 'DIRTY'
				: UNKNOWN.includes(number)
					? 'UNKNOWN'
					: 'CLEAN'
			return route.fulfill({
				json: { pullRequest: { state: 'OPEN', mergeStateStatus: status }, mergeRequirements: {} },
			})
		})
	}
	await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
	await page
		.waitForFunction(
			() => document.querySelectorAll('[data-detent-diff-stats]').length >= 5,
			null,
			{
				timeout: 60_000,
			},
		)
		.catch(() => undefined)
	await page.waitForTimeout(4000)
	const result = await page.evaluate(() => {
		const rows = [...document.querySelectorAll('li a[data-testid="listitem-title-link"]')]
		return rows.map((link) => {
			const row = link.closest('li')
			return {
				number: Number(/\/pull\/(\d+)/.exec(link.getAttribute('href') ?? '')?.[1]),
				state: row?.querySelector('svg.octicon')?.getAttribute('aria-label'),
				stats: Boolean(row?.querySelector('[data-detent-diff-stats]')),
				conflicts: row?.querySelector('[data-detent-conflicts]')?.getAttribute('title') ?? null,
				line: row?.querySelector('[data-detent-conflicts]')?.parentElement?.textContent ?? null,
			}
		})
	})
	const marked = result.filter((row) => row.conflicts).map((row) => row.number)
	const first = result.find((row) => row.conflicts)
	if (first) {
		await page.locator(`li:has(a[href$="/pull/${first.number}"])`).first().scrollIntoViewIfNeeded()
	}
	const screenshot = join(OUTPUT, `${name}.png`)
	await page.screenshot({ path: screenshot })
	await context.close()

	return {
		name,
		url,
		signedIn,
		// Every request, repeats included, so a request loop fails the per-row count.
		asked: asked.sort((a, b) => a - b),
		marked,
		rows: result,
		screenshot,
	}
}

const report = { output: OUTPUT, conflicts: CONFLICTS, unknown: UNKNOWN, runs: [] }
report.runs.push(await run('signed-out', LIST, { signedIn: false }))
report.runs.push(await run('simulated-sign-in', LIST, { signedIn: true }))
report.runs.push(await run('simulated-sign-in-closed', CLOSED, { signedIn: true }))
writeFileSync(join(OUTPUT, 'report.json'), JSON.stringify(report, null, 2))

const [signedOut, signedIn, closed] = report.runs
const listed = signedIn.rows.map((row) => row.number)
const openRows = signedIn.rows.filter((row) => /^(Open|Draft) pull request$/.test(row.state ?? ''))
const checks = {
	'signed out asks for no merge box': signedOut.asked.length === 0,
	'signed out shows no marker': signedOut.marked.length === 0,
	'signed out still shows diff stats': signedOut.rows.some((row) => row.stats),
	// One request per open row; an unknown row may get its single retry 15 s later, if the run lasted that long.
	'signed in asks once per open row, unknown ones at most twice': openRows.every((row) => {
		const count = signedIn.asked.filter((number) => number === row.number).length
		return count === 1 || (count === 2 && UNKNOWN.includes(row.number))
	}),
	'signed in asks only about open rows': signedIn.asked.every((number) =>
		openRows.some((row) => row.number === number),
	),
	'signed in marks exactly the conflicting rows': (() => {
		const expected = CONFLICTS.filter((number) => listed.includes(number))
		return expected.length > 0 && JSON.stringify(signedIn.marked) === JSON.stringify(expected)
	})(),
	'closed list asks for nothing and marks nothing':
		closed.asked.length === 0 && closed.marked.length === 0,
}
console.log(
	JSON.stringify(
		{
			output: OUTPUT,
			checks,
			signedIn: {
				asked: signedIn.asked.length,
				marked: signedIn.marked,
				line: signedIn.rows.find((row) => row.line)?.line,
			},
			screenshots: report.runs.map((run) => run.screenshot),
		},
		null,
		2,
	),
)
process.exit(Object.values(checks).every(Boolean) ? 0 : 1)
