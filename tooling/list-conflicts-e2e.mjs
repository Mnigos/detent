// Loads the built extension into headless Chromium, signed out, on a public pull request list.
// Usage: bun run build && node tooling/list-conflicts-e2e.mjs
// Run 1 (signed out as GitHub serves it): no merge box request and no marker, the diff stats still show.
// Run 2 (simulated sign-in): the list's empty user-login meta tag is filled in and every merge box request is
// answered DIRTY, UNKNOWN, CLEAN with a failed rebase conflict condition, or CLEAN (see isConflicting, isUnknown
// and isRebaseBlocked), so both markers run on GitHub's real list DOM.
// The real signed-in merge box answer is not covered; check it by hand in a signed-in browser.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const EXTENSION_PATH = join(import.meta.dirname, '..', '.output', 'chrome-mv3')
const OUTPUT = mkdtempSync(join(tmpdir(), 'detent-conflicts-e2e-'))
const LIST = process.env.LIST ?? 'https://github.com/TanStack/router/pulls'
const CLOSED = `${LIST}?q=is%3Apr+is%3Aclosed`
// Without CONFLICTS, UNKNOWN or REBASE the stub picks rows by number, so no pull request has to stay open.
const numbers = (value) => value?.split(',').map(Number)
const conflictsOf = numbers(process.env.CONFLICTS)
const unknownOf = numbers(process.env.UNKNOWN)
const isConflicting = (number) => conflictsOf?.includes(number) ?? number % 3 === 0
const isUnknown = (number) => unknownOf?.includes(number) ?? number % 3 === 1
const rebaseOf = numbers(process.env.REBASE)
const isRebaseBlocked = (number) =>
	!isConflicting(number) && !isUnknown(number) && (rebaseOf?.includes(number) ?? number % 2 === 0)
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
	const queries = new Set()
	page.on('request', (request) => {
		const match = MERGE_BOX.exec(request.url())
		if (!match) return
		asked.push(Number(match[1]))
		queries.add(new URL(request.url()).search)
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
			const status = isConflicting(number) ? 'DIRTY' : isUnknown(number) ? 'UNKNOWN' : 'CLEAN'
			const conditions = isRebaseBlocked(number)
				? [{ type: 'PULL_REQUEST_MERGE_CONFLICT_STATE', result: 'FAILED', conflicts: [] }]
				: []
			return route.fulfill({
				json: {
					pullRequest: { state: 'OPEN', mergeStateStatus: status },
					mergeRequirements: { conditions },
				},
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
				marker:
					row?.querySelector('[data-detent-conflicts]')?.getAttribute('data-detent-conflicts') ??
					null,
				text: row?.querySelector('[data-detent-conflicts]')?.textContent ?? null,
				line: row?.querySelector('[data-detent-conflicts]')?.parentElement?.textContent ?? null,
			}
		})
	})
	const marked = result.filter((row) => row.conflicts).map((row) => row.number)
	const markedAs = (marker) =>
		result.filter((row) => row.marker === marker).map((row) => row.number)
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
		queries: [...queries],
		marked,
		conflicting: markedAs('conflicts'),
		rebaseBlocked: markedAs('rebase-blocked'),
		rows: result,
		screenshot,
	}
}

const report = {
	output: OUTPUT,
	conflicts: conflictsOf ?? 'n % 3 = 0',
	unknown: unknownOf ?? 'n % 3 = 1',
	rebaseBlocked: rebaseOf ?? 'the other even n',
	runs: [],
}
report.runs.push(await run('signed-out', LIST, { signedIn: false }))
report.runs.push(await run('simulated-sign-in', LIST, { signedIn: true }))
report.runs.push(await run('simulated-sign-in-closed', CLOSED, { signedIn: true }))
writeFileSync(join(OUTPUT, 'report.json'), JSON.stringify(report, null, 2))

const [signedOut, signedIn, closed] = report.runs
const openRows = signedIn.rows.filter((row) => /^(Open|Draft) pull request$/.test(row.state ?? ''))
const checks = {
	'signed out asks for no merge box': signedOut.asked.length === 0,
	'signed out shows no marker': signedOut.marked.length === 0,
	'signed out still shows diff stats': signedOut.rows.some((row) => row.stats),
	// One request per open row; an unknown row may get its single retry 15 s later, if the run lasted that long.
	'signed in asks once per open row, unknown ones at most twice': openRows.every((row) => {
		const count = signedIn.asked.filter((number) => number === row.number).length
		return count === 1 || (count === 2 && isUnknown(row.number))
	}),
	'signed in asks only about open rows': signedIn.asked.every((number) =>
		openRows.some((row) => row.number === number),
	),
	'signed in asks for rebase merging': (() =>
		signedIn.queries.length === 1 &&
		signedIn.queries[0] === '?merge_method=REBASE&bypass_requirements=false')(),
	'signed in marks exactly the conflicting rows as Conflicts': (() => {
		const expected = openRows.map((row) => row.number).filter(isConflicting)
		return (
			expected.length > 0 &&
			JSON.stringify(signedIn.conflicting) === JSON.stringify(expected) &&
			signedIn.rows.every((row) => row.marker !== 'conflicts' || row.text === '·Conflicts')
		)
	})(),
	"signed in marks exactly the rebase-blocked rows as Can't rebase": (() => {
		const expected = openRows.map((row) => row.number).filter(isRebaseBlocked)
		return (
			expected.length > 0 &&
			JSON.stringify(signedIn.rebaseBlocked) === JSON.stringify(expected) &&
			signedIn.rows.every((row) => row.marker !== 'rebase-blocked' || row.text === "·Can't rebase")
		)
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
				conflicting: signedIn.conflicting,
				rebaseBlocked: signedIn.rebaseBlocked,
				lines: [
					signedIn.rows.find((row) => row.marker === 'conflicts')?.line,
					signedIn.rows.find((row) => row.marker === 'rebase-blocked')?.line,
				],
			},
			screenshots: report.runs.map((run) => run.screenshot),
		},
		null,
		2,
	),
)
process.exit(Object.values(checks).every(Boolean) ? 0 : 1)
