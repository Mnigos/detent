// Loads the built extension into headless Chromium, signed out, on a public pull request list.
// Usage: bun run build && node tooling/list-conflicts-e2e.mjs
// Run 1 (signed out as GitHub serves it): no merge box request and no marker, the diff stats still show.
// Run 2 (simulated sign-in): the list's empty user-login meta tag is filled in and both merge box requests are
// stubbed. The default one (no merge_method) answers DIRTY, UNKNOWN or CLEAN, offering rebase merging on the rows
// of allowsRebase; the rebase one (merge_method=REBASE) answers a failed conflict condition on the rows of
// isRebaseBlocked, CLEAN on the other rows that allow rebase, and a refused merge method (BLOCKED, as a repository
// without rebase merging answers, with no word on the conflict) everywhere else. So both markers run on GitHub's
// real list DOM, and a build that asked only for rebase would lose the conflicts on the squash-only rows.
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
// Even rows (and REBASE ones) offer rebase merging; odd rows are squash-only, conflicting ones included.
const allowsRebase = (number) => rebaseOf?.includes(number) || number % 2 === 0
const isRebaseBlocked = (number) =>
	!isConflicting(number) && !isUnknown(number) && (rebaseOf?.includes(number) ?? number % 4 === 0)
// A clean default answer that offers rebase merging is asked once more, for rebase.
const asksTwice = (number) => allowsRebase(number) && !isConflicting(number) && !isUnknown(number)
const MERGE_BOX = /\/pull\/(\d+)\/page_data\/merge_box/
const DEFAULT_QUERY = ''
const REBASE_QUERY = '?merge_method=REBASE&bypass_requirements=false'
const methods = (number) => [
	{ name: 'MERGE', allowableStatus: 'DISABLED' },
	{ name: 'SQUASH', allowableStatus: 'ALLOWED' },
	{ name: 'REBASE', allowableStatus: allowsRebase(number) ? 'ALLOWED' : 'DISABLED' },
]
const conflictCondition = (result) => ({
	type: 'PULL_REQUEST_MERGE_CONFLICT_STATE',
	result,
	conflicts: [],
})

// The stub's answer to one merge box request, by pull request number and query.
function answer(number, query) {
	const pullRequest = (mergeStateStatus) => ({
		state: 'OPEN',
		mergeStateStatus,
		viewerMergeActions: [{ name: 'DIRECT_MERGE', mergeMethods: methods(number) }],
	})
	if (query === REBASE_QUERY) {
		if (!allowsRebase(number))
			return {
				pullRequest: pullRequest('BLOCKED'),
				mergeRequirements: {
					conditions: [{ type: 'PULL_REQUEST_MERGE_METHOD', result: 'FAILED' }],
				},
			}
		if (isRebaseBlocked(number))
			return {
				pullRequest: pullRequest('CLEAN'),
				mergeRequirements: { conditions: [conflictCondition('FAILED')] },
			}
	}
	if (isConflicting(number))
		return {
			pullRequest: pullRequest('DIRTY'),
			mergeRequirements: { conditions: [conflictCondition('FAILED')] },
		}
	if (isUnknown(number)) return { pullRequest: pullRequest('UNKNOWN'), mergeRequirements: {} }

	return {
		pullRequest: pullRequest('CLEAN'),
		mergeRequirements: { conditions: [conflictCondition('PASSED')] },
	}
}

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
	const requests = []
	page.on('request', (request) => {
		const match = MERGE_BOX.exec(request.url())
		if (!match) return
		asked.push(Number(match[1]))
		requests.push({ number: Number(match[1]), query: new URL(request.url()).search })
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
			const url = new URL(route.request().url())
			const number = Number(MERGE_BOX.exec(url.pathname)?.[1])
			return route.fulfill({ json: answer(number, url.search) })
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
		requests,
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
	rebaseAllowed: rebaseOf ? `${rebaseOf} and even n` : 'even n',
	rebaseBlocked: rebaseOf ?? 'the other n % 4 = 0',
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
	// One default request per open row; an unknown row may get its single retry 15 s later, if the run lasted that
	// long. One rebase request more only for a clean row that offers rebase merging.
	'signed in asks the default merge box once per open row, unknown ones at most twice':
		openRows.every((row) => {
			const count = signedIn.requests.filter(
				(request) => request.number === row.number && request.query === DEFAULT_QUERY,
			).length
			return count === 1 || (count === 2 && isUnknown(row.number))
		}),
	'signed in asks for rebase exactly once per clean row that offers it': (() => {
		const rebaseAsked = signedIn.requests.filter((request) => request.query === REBASE_QUERY)
		const expected = openRows
			.map((row) => row.number)
			.filter(asksTwice)
			.sort((a, b) => a - b)
		return (
			expected.length > 0 &&
			JSON.stringify(rebaseAsked.map((request) => request.number).sort((a, b) => a - b)) ===
				JSON.stringify(expected)
		)
	})(),
	'signed in asks only about open rows': signedIn.asked.every((number) =>
		openRows.some((row) => row.number === number),
	),
	'signed in asks only the two known merge box shapes': signedIn.requests.every((request) =>
		[DEFAULT_QUERY, REBASE_QUERY].includes(request.query),
	),
	'signed in marks exactly the conflicting rows as Conflicts, squash-only ones included': (() => {
		const expected = openRows.map((row) => row.number).filter(isConflicting)
		return (
			(conflictsOf !== undefined || expected.some((number) => !allowsRebase(number))) &&
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
