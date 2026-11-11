// Loads the built extension into headless Chromium, signed out, on a public pull request list.
// Usage: bun run build && node tooling/list-conflicts-e2e.mjs
// The service worker sends every list request (diffs, merge boxes, list data), so its fetch is wrapped: each request
// is recorded, and with a simulated sign-in the merge box answers come from the stub below. Diffs answer with a small
// hand-written diff, since the runs ask for well over a hundred and GitHub rate-limits signed-out diffs; REAL_DIFFS=1
// sends them to GitHub. The list pages and their data always come from GitHub.
// Run 1 (signed out as GitHub serves it): no merge box request and no marker, the diff stats still show.
// Run 2 (simulated sign-in): the list's empty user-login meta tag is filled in and both merge box requests are
// stubbed. The default one (no merge_method) answers DIRTY, UNKNOWN or CLEAN, offering rebase merging on the rows
// of allowsRebase; the rebase one (merge_method=REBASE) answers a failed conflict condition on the rows of
// isRebaseBlocked, CLEAN on the other rows that allow rebase, and a refused merge method (BLOCKED, as a repository
// without rebase merging answers, with no word on the conflict) everywhere else. So both markers run on GitHub's
// real list DOM, and a build that asked only for rebase would lose the conflicts on the squash-only rows. Every
// computed default answer carries a conversation resolution rule: failed on the rows of isUnresolved (conflicting
// ones included), passed on the others, as on a repository that requires resolution and has open threads elsewhere.
// The page is scrolled to the end, so every row is asked about.
// Run 3 (simulated rate limit): as run 2, but every merge box request in the first second answers 429 with
// Retry-After: 6. No request may follow for those six seconds, and the markers must still all appear after the pause.
// Run 4 (request cost): a short window, so only part of the list is near the viewport. Before scrolling only rows on
// screen or one screen below are asked about; a reload within a minute sends no diff request; a reload with every
// cache entry made 15 minutes old (no new commits) still sends no diff request and asks the merge box again only for
// the rows near the viewport; GitHub's own navigation to page 2 asks once for that page's list data.
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
const rules = {
	conflicts: numbers(process.env.CONFLICTS) ?? null,
	unknown: numbers(process.env.UNKNOWN) ?? null,
	rebase: numbers(process.env.REBASE) ?? null,
	unresolved: numbers(process.env.UNRESOLVED) ?? null,
}
const isConflicting = (number) => rules.conflicts?.includes(number) ?? number % 3 === 0
const isUnknown = (number) => rules.unknown?.includes(number) ?? number % 3 === 1
// Even rows (and REBASE ones) offer rebase merging; odd rows are squash-only, conflicting ones included.
const allowsRebase = (number) => rules.rebase?.includes(number) || number % 2 === 0
const isRebaseBlocked = (number) =>
	!isConflicting(number) &&
	!isUnknown(number) &&
	(rules.rebase?.includes(number) ?? number % 4 === 0)
// Rows whose unresolved conversations block the merge; an unknown answer says nothing about them.
const isUnresolved = (number) =>
	!isUnknown(number) && (rules.unresolved?.includes(number) ?? number % 5 === 0)
// A clean default answer that offers rebase merging is asked once more, for rebase.
const asksTwice = (number) => allowsRebase(number) && !isConflicting(number) && !isUnknown(number)
const RETRY_AFTER_SECONDS = 6
const DEFAULT_QUERY = ''
const REBASE_QUERY = '?merge_method=REBASE&bypass_requirements=false'
const isOpenRow = (row) => row.state === 'Open pull request'
const MINUTE = 60_000
const REAL_DIFFS = process.env.REAL_DIFFS === '1'

// Runs inside the service worker: records every list request and answers merge boxes from the stub. It repeats the
// stub's rules, since the worker cannot see this script's functions.
function wrapWorkerFetch({ signedIn, rateLimitWindow, rules, retryAfterSeconds, realDiffs }) {
	const original = globalThis.__detentOriginalFetch ?? globalThis.fetch
	globalThis.__detentOriginalFetch = original
	globalThis.__detentRequests = []
	globalThis.__detentLastRequestAt = Date.now()
	let firstMergeBox
	const isConflicting = (n) => rules.conflicts?.includes(n) ?? n % 3 === 0
	const isUnknown = (n) => rules.unknown?.includes(n) ?? n % 3 === 1
	const allowsRebase = (n) => rules.rebase?.includes(n) || n % 2 === 0
	const isRebaseBlocked = (n) =>
		!isConflicting(n) && !isUnknown(n) && (rules.rebase?.includes(n) ?? n % 4 === 0)
	const isUnresolved = (n) => rules.unresolved?.includes(n) ?? n % 5 === 0
	const condition = (result) => ({
		type: 'PULL_REQUEST_MERGE_CONFLICT_STATE',
		result,
		conflicts: [],
	})
	const resolution = (number) => {
		const result = isUnresolved(number) ? 'FAILED' : 'PASSED'
		return {
			type: 'PULL_REQUEST_RULES',
			result,
			ruleRollups: [{ ruleType: 'REQUIRED_REVIEW_THREAD_RESOLUTION', result, metadata: null }],
		}
	}
	function answer(number, query) {
		const pullRequest = (mergeStateStatus) => ({
			state: 'OPEN',
			mergeStateStatus,
			viewerMergeActions: [
				{
					name: 'DIRECT_MERGE',
					mergeMethods: [
						{ name: 'MERGE', allowableStatus: 'DISABLED' },
						{ name: 'SQUASH', allowableStatus: 'ALLOWED' },
						{ name: 'REBASE', allowableStatus: allowsRebase(number) ? 'ALLOWED' : 'DISABLED' },
					],
				},
			],
		})
		if (query === '?merge_method=REBASE&bypass_requirements=false') {
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
					mergeRequirements: { conditions: [condition('FAILED')] },
				}
		}
		if (isConflicting(number))
			return {
				pullRequest: pullRequest('DIRTY'),
				mergeRequirements: { conditions: [condition('FAILED'), resolution(number)] },
			}
		if (isUnknown(number)) return { pullRequest: pullRequest('UNKNOWN'), mergeRequirements: {} }

		return {
			pullRequest: pullRequest(isUnresolved(number) ? 'BLOCKED' : 'CLEAN'),
			mergeRequirements: { conditions: [condition('PASSED'), resolution(number)] },
		}
	}
	globalThis.fetch = async function (input, init) {
		const url = new URL(String(input?.url ?? input))
		const at = Date.now()
		const mergeBox = /\/pull\/(\d+)\/page_data\/merge_box$/.exec(url.pathname)
		const kind = mergeBox
			? 'merge-box'
			: /\/pull\/\d+\.diff$/.test(url.pathname)
				? 'diff'
				: /\/pulls\/?$/.test(url.pathname)
					? 'list-data'
					: undefined
		if (!kind) return original.call(this, input, init)

		const number = Number(/\/pull\/(\d+)/.exec(url.pathname)?.[1])
		const entry = { kind, number, query: url.search, at }
		globalThis.__detentRequests.push(entry)
		globalThis.__detentLastRequestAt = at
		if (kind === 'diff' && !realDiffs)
			return new Response(
				`diff --git a/src/${number}.ts b/src/${number}.ts\n--- a/src/${number}.ts\n+++ b/src/${number}.ts\n@@ -1 +1,2 @@\n-old\n+new\n+added\n`,
			)
		if (kind !== 'merge-box' || !signedIn) return original.call(this, input, init)

		firstMergeBox ??= at
		if (rateLimitWindow && at - firstMergeBox < rateLimitWindow) {
			entry.limited = true
			return new Response('', {
				status: 429,
				headers: { 'Retry-After': String(retryAfterSeconds) },
			})
		}
		return Response.json(answer(number, url.search))
	}
}

async function launch({ height = 1000 } = {}) {
	const context = await chromium.launchPersistentContext(
		mkdtempSync(join(tmpdir(), 'detent-e2e-')),
		{
			headless: false,
			viewport: { width: 1400, height },
			args: [
				'--headless=new',
				`--disable-extensions-except=${EXTENSION_PATH}`,
				`--load-extension=${EXTENSION_PATH}`,
			],
		},
	)
	const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
	const page = context.pages()[0] ?? (await context.newPage())

	return { context, worker, page }
}

// The list as GitHub serves it, with the empty user-login meta tag filled in.
async function simulateSignIn(page) {
	await page.route(
		(target) => target.pathname.endsWith('/pulls'),
		async (route) => {
			if (route.request().headers().accept?.includes('application/json')) return route.continue()
			const response = await route.fetch()
			const body = (await response.text()).replace(
				'<meta name="user-login" content="">',
				'<meta name="user-login" content="detent-e2e">',
			)
			await route.fulfill({ response, body })
		},
	)
}

const workerRequests = (worker) => worker.evaluate(() => globalThis.__detentRequests ?? [])

// Every row of the list: its number, state, what detent added and whether it starts within two window heights of the
// top of the document, which is what is near the viewport before scrolling.
const readRows = (page) =>
	page.evaluate(() =>
		[...document.querySelectorAll('li a[data-testid="listitem-title-link"]')].map((link) => {
			const row = link.closest('li')
			const marker = row?.querySelector('[data-detent-conflicts]')
			const unresolved = row?.querySelector('[data-detent-unresolved]')
			return {
				number: Number(/\/pull\/(\d+)/.exec(link.getAttribute('href') ?? '')?.[1]),
				state: row?.querySelector('svg.octicon')?.getAttribute('aria-label'),
				stats: Boolean(row?.querySelector('[data-detent-diff-stats]')),
				conflicts: marker?.getAttribute('title') ?? null,
				marker: marker?.getAttribute('data-detent-conflicts') ?? null,
				text: marker?.textContent ?? null,
				unresolved: unresolved?.textContent ?? null,
				unresolvedTitle: unresolved?.getAttribute('title') ?? null,
				// The unresolved marker trails the meta line, after any conflict marker.
				unresolvedLast: unresolved
					? unresolved.parentElement?.lastElementChild === unresolved
					: null,
				afterConflict: unresolved && marker ? marker.nextElementSibling === unresolved : null,
				line: (marker ?? unresolved)?.parentElement?.textContent ?? null,
				top: (row?.getBoundingClientRect().top ?? 0) + window.scrollY,
				near:
					(row?.getBoundingClientRect().bottom ?? 0) > 0 &&
					(row?.getBoundingClientRect().top ?? 0) < window.innerHeight * 2,
			}
		}),
	)

// Scrolls a screen at a time, as a reader would, stopping until the rows on screen show their stats and the worker
// has sent nothing for a second. Rows flung past before their turn comes are let go, so a jump to the end would
// leave rows bare.
async function scrollToEnd(page, worker) {
	for (let step = 0; step < 20; step += 1) {
		await page
			.waitForFunction(
				() =>
					[...document.querySelectorAll('li a[data-testid="listitem-title-link"]')]
						.map((link) => link.closest('li'))
						.filter((row) => {
							const { top, bottom } = row.getBoundingClientRect()
							return bottom > 0 && top < window.innerHeight
						})
						.every((row) => row.querySelector('[data-detent-diff-stats]')),
				null,
				{ timeout: 20_000 },
			)
			.catch(() => undefined)
		for (let wait = 0; wait < 40; wait += 1) {
			await page.waitForTimeout(250)
			const quiet = await worker.evaluate(() => Date.now() - globalThis.__detentLastRequestAt)
			if (quiet > 1000) break
		}
		const isAtEnd = await page.evaluate(() => {
			const before = window.scrollY
			window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'instant' })
			return window.scrollY === before
		})
		if (isAtEnd) return
	}
}

async function run(name, url, { signedIn, rateLimited = false }) {
	const { context, worker, page } = await launch()
	await worker.evaluate(wrapWorkerFetch, {
		signedIn,
		rateLimitWindow: rateLimited ? 1000 : 0,
		rules,
		retryAfterSeconds: RETRY_AFTER_SECONDS,
		realDiffs: REAL_DIFFS,
	})
	if (signedIn) await simulateSignIn(page)
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
	// The rate limit pause holds every request; the reader scrolls once it is over.
	if (rateLimited) await page.waitForTimeout(RETRY_AFTER_SECONDS * 1000 + 3000)
	await scrollToEnd(page, worker)
	await page.waitForTimeout(4000)
	const rows = await readRows(page)
	const requests = await workerRequests(worker)
	const first = rows.find((row) => row.conflicts)
	if (first)
		await page.locator(`li:has(a[href$="/pull/${first.number}"])`).first().scrollIntoViewIfNeeded()
	const screenshot = join(OUTPUT, `${name}.png`)
	await page.screenshot({ path: screenshot })
	await context.close()
	const mergeBoxes = requests.filter((request) => request.kind === 'merge-box')
	const markedAs = (marker) => rows.filter((row) => row.marker === marker).map((row) => row.number)

	return {
		name,
		url,
		signedIn,
		// Every request, repeats included, so a request loop fails the per-row count.
		asked: mergeBoxes.map((request) => request.number).sort((a, b) => a - b),
		requests: mergeBoxes,
		diffs: requests.filter((request) => request.kind === 'diff').length,
		marked: rows.filter((row) => row.conflicts).map((row) => row.number),
		conflicting: markedAs('conflicts'),
		rebaseBlocked: markedAs('rebase-blocked'),
		unresolved: rows.filter((row) => row.unresolved).map((row) => row.number),
		rows,
		screenshot,
	}
}

// Moves every cached entry back in time, as if it had been stored that long ago.
const ageCaches = (worker, milliseconds) =>
	worker.evaluate(async (milliseconds) => {
		const stored = await chrome.storage.local.get(['diffStats:v2', 'mergeConflicts:v4'])
		for (const cache of Object.values(stored))
			for (const entry of Object.values(cache)) entry.at -= milliseconds
		await chrome.storage.local.set(stored)
	}, milliseconds)

async function requestCost() {
	const { context, worker, page } = await launch({ height: 600 })
	// detent's own log lines, so a real GitHub rate limit during the run shows in the report.
	const logs = []
	page.on('console', (message) => {
		if (message.text().includes('[detent]')) logs.push(message.text())
	})
	await simulateSignIn(page)
	const load = async (step) => {
		await worker.evaluate(wrapWorkerFetch, {
			signedIn: true,
			rateLimitWindow: 0,
			realDiffs: REAL_DIFFS,
			rules,
			retryAfterSeconds: 0,
		})
		await step()
		await page
			.waitForFunction(
				() => document.querySelectorAll('[data-detent-diff-stats]').length >= 3,
				null,
				{
					timeout: 60_000,
				},
			)
			.catch(() => undefined)
		await page.waitForTimeout(6000)
		return { rows: await readRows(page), requests: await workerRequests(worker) }
	}
	const count = (requests, kind) => requests.filter((request) => request.kind === kind).length
	const numbersOf = (requests, kind) =>
		[...new Set(requests.filter((request) => request.kind === kind).map((r) => r.number))].sort(
			(a, b) => a - b,
		)

	const first = await load(() =>
		page.goto(LIST, { waitUntil: 'domcontentloaded', timeout: 60_000 }),
	)
	const scrolled = await load(() => scrollToEnd(page, worker))
	// Opened again rather than reloaded, since Chrome restores the scroll position on reload: each visit starts
	// at the top like the first.
	const reloadFromTop = async () => {
		await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
		await page.goto(LIST, { waitUntil: 'domcontentloaded', timeout: 60_000 })
		await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
	}
	const reload = await load(reloadFromTop)
	await ageCaches(worker, 15 * MINUTE)
	const later = await load(reloadFromTop)
	const stored = await worker.evaluate(() => chrome.storage.local.get('diffStats:v2'))
	const navigated = await load(async () => {
		await page.evaluate(() =>
			window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }),
		)
		await page.locator('a[data-component="Pagination.Page"][aria-label="Page 2"]').first().click()
		await page.waitForURL(/page=2/, { timeout: 30_000 })
		await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
	})
	await page.screenshot({ path: join(OUTPUT, 'request-cost.png') })
	await context.close()

	const near = first.rows.filter((row) => row.near)
	const nearOpen = near.filter(isOpenRow)
	return {
		rows: first.rows.length,
		nearRows: near.map((row) => row.number),
		firstLoad: {
			diffs: numbersOf(first.requests, 'diff'),
			diffRequests: count(first.requests, 'diff'),
			mergeBoxes: count(first.requests, 'merge-box'),
			mergeBoxRows: numbersOf(first.requests, 'merge-box'),
			listData: count(first.requests, 'list-data'),
		},
		afterScroll: {
			diffs: numbersOf(scrolled.requests, 'diff'),
			diffRequests: count(scrolled.requests, 'diff'),
			mergeBoxes: count(scrolled.requests, 'merge-box'),
		},
		reloadWithinAMinute: {
			diffs: count(reload.requests, 'diff'),
			mergeBoxes: count(reload.requests, 'merge-box'),
			mergeBoxRows: numbersOf(reload.requests, 'merge-box'),
			listData: count(reload.requests, 'list-data'),
		},
		reloadFifteenMinutesLater: {
			diffs: count(later.requests, 'diff'),
			mergeBoxes: count(later.requests, 'merge-box'),
			mergeBoxRows: numbersOf(later.requests, 'merge-box'),
			listData: count(later.requests, 'list-data'),
			nearOpen: later.rows.filter((row) => row.near && isOpenRow(row)).map((row) => row.number),
		},
		storedWithHead: Object.values(stored['diffStats:v2'] ?? {}).filter((entry) => entry.headSha)
			.length,
		pageTwo: {
			url: page.url(),
			listData: count(navigated.requests, 'list-data'),
			diffs: numbersOf(navigated.requests, 'diff'),
			rows: navigated.rows.map((row) => row.number),
			withStats: navigated.rows.filter((row) => row.stats).length,
			nearRows: navigated.rows.filter((row) => row.near).map((row) => row.number),
		},
		nearOpen: nearOpen.map((row) => row.number),
		logs,
		allOpen: first.rows.filter(isOpenRow).map((row) => row.number),
	}
}

const report = {
	output: OUTPUT,
	rules,
	runs: [],
}
report.runs.push(await run('signed-out', LIST, { signedIn: false }))
report.runs.push(await run('simulated-sign-in', LIST, { signedIn: true }))
report.runs.push(await run('simulated-sign-in-closed', CLOSED, { signedIn: true }))
report.runs.push(await run('simulated-rate-limit', LIST, { signedIn: true, rateLimited: true }))
report.cost = await requestCost()
writeFileSync(join(OUTPUT, 'report.json'), JSON.stringify(report, null, 2))

const [signedOut, signedIn, closed, limited] = report.runs
const { cost } = report
const sorted = (values) => JSON.stringify([...values].sort((a, b) => a - b))
const openRows = signedIn.rows.filter(isOpenRow)
const limitedOpen = limited.rows.filter(isOpenRow)
const isSubset = (values, of) => values.every((value) => of.includes(value))
const checks = {
	'signed out asks for no merge box': signedOut.asked.length === 0,
	'signed out shows no marker': signedOut.marked.length === 0,
	'signed out still shows diff stats': signedOut.rows.some((row) => row.stats),
	'signed out asks for each diff once': signedOut.diffs === signedOut.rows.length,
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
		const expected = openRows.map((row) => row.number).filter(asksTwice)
		return expected.length > 0 && sorted(rebaseAsked.map((r) => r.number)) === sorted(expected)
	})(),
	'signed in asks only about open rows, never drafts': signedIn.asked.every((number) =>
		openRows.some((row) => row.number === number),
	),
	'signed in asks only the two known merge box shapes': signedIn.requests.every((request) =>
		[DEFAULT_QUERY, REBASE_QUERY].includes(request.query),
	),
	'signed in marks exactly the conflicting rows as Conflicts, squash-only ones included': (() => {
		const expected = openRows.map((row) => row.number).filter(isConflicting)
		return (
			(rules.conflicts !== null || expected.some((number) => !allowsRebase(number))) &&
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
	'signed in marks exactly the rows whose conversation resolution rule fails as Unresolved comments':
		(() => {
			const expected = openRows.map((row) => row.number).filter(isUnresolved)
			return (
				expected.length > 0 &&
				JSON.stringify(signedIn.unresolved) === JSON.stringify(expected) &&
				signedIn.rows.every(
					(row) =>
						!row.unresolved ||
						(row.unresolved === '·Unresolved comments' &&
							row.unresolvedTitle === 'Resolve all comments before this can merge' &&
							row.unresolvedLast &&
							(row.marker === null || row.afterConflict)),
				)
			)
		})(),
	'closed list asks for nothing and marks nothing':
		closed.asked.length === 0 && closed.marked.length === 0 && closed.unresolved.length === 0,
	'signed out shows no unresolved marker': signedOut.unresolved.length === 0,
	// Every request in the first second answers 429; the next one waits out Retry-After from the first.
	'rate-limited list sends nothing more until Retry-After has passed': (() => {
		const [first] = limited.requests
		const next = limited.requests.find((request) => !request.limited)
		return Boolean(first?.limited && next) && next.at - first.at >= RETRY_AFTER_SECONDS * 1000 - 500
	})(),
	'rate-limited list asks again and marks the conflicting rows after the pause':
		limitedOpen.length > 0 &&
		JSON.stringify(limited.conflicting) ===
			JSON.stringify(limitedOpen.map((row) => row.number).filter(isConflicting)) &&
		JSON.stringify(limited.rebaseBlocked) ===
			JSON.stringify(limitedOpen.map((row) => row.number).filter(isRebaseBlocked)),
	'rate-limited list still shows diff stats': limited.rows.some((row) => row.stats),
	'before scrolling only rows near the viewport are asked about':
		cost.nearRows.length < cost.rows &&
		cost.firstLoad.diffs.length > 0 &&
		isSubset(cost.firstLoad.diffs, cost.nearRows) &&
		isSubset(cost.firstLoad.mergeBoxRows, cost.nearOpen),
	'the page data gives the head commits, so a fresh load asks for no list data':
		cost.firstLoad.listData === 0 && cost.reloadWithinAMinute.listData === 0,
	'scrolling to the end asks about the remaining rows, each diff once overall':
		new Set([...cost.firstLoad.diffs, ...cost.afterScroll.diffs]).size === cost.rows &&
		cost.firstLoad.diffRequests + cost.afterScroll.diffRequests === cost.rows,
	'a reload within a minute sends no diff request': cost.reloadWithinAMinute.diffs === 0,
	'a reload within a minute asks the merge box only about unknown rows':
		cost.reloadWithinAMinute.mergeBoxRows.every(isUnknown),
	'stats are stored with their head commit': cost.storedWithHead === cost.rows,
	'a reload 15 minutes later without new commits sends no diff request':
		cost.reloadFifteenMinutesLater.diffs === 0,
	'a reload 15 minutes later asks the merge box only about open rows near the viewport':
		cost.reloadFifteenMinutesLater.mergeBoxRows.length > 0 &&
		isSubset(
			cost.reloadFifteenMinutesLater.mergeBoxRows,
			cost.reloadFifteenMinutesLater.nearOpen,
		) &&
		cost.reloadFifteenMinutesLater.mergeBoxRows.length < cost.allOpen.length,
	"GitHub's navigation to page 2 asks once for its list data and fetches only near rows' diffs":
		/page=2/.test(cost.pageTwo.url) &&
		cost.pageTwo.listData === 1 &&
		cost.pageTwo.diffs.length > 0 &&
		isSubset(cost.pageTwo.diffs, cost.pageTwo.rows),
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
				unresolved: signedIn.unresolved,
				lines: [
					signedIn.rows.find((row) => row.marker === 'conflicts')?.line,
					signedIn.rows.find((row) => row.marker === 'rebase-blocked')?.line,
					signedIn.rows.find((row) => row.unresolved && row.marker)?.line,
					signedIn.rows.find((row) => row.unresolved && !row.marker)?.line,
				],
			},
			cost,
			screenshots: report.runs.map((run) => run.screenshot),
		},
		null,
		2,
	),
)
process.exit(Object.values(checks).every(Boolean) ? 0 : 1)
