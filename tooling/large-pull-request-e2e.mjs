import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { chromium } from 'playwright'

const EXTENSION_PATH = join(import.meta.dirname, '..', '.output', 'chrome-mv3')
const OUTPUT = mkdtempSync(join(tmpdir(), 'detent-gate-e2e-'))
const LARGE = 'https://github.com/TanStack/router/pull/8658'
const SMALL = 'https://github.com/Mnigos/tessera/pull/165'
const REPORT = { output: OUTPUT, started: new Date().toISOString(), cases: [] }
mkdirSync(OUTPUT, { recursive: true })

function save() {
	writeFileSync(join(OUTPUT, 'report.json'), JSON.stringify(REPORT, null, 2))
}

function instrument() {
	const probe = { events: [], longTasks: [], heartbeat: [], supported: false }
	window.__detentGateProbe = probe
	const selectors = [
		'#detent-group',
		'#detent-analyzing',
		'detent-panel',
		'#detent-tree',
		'#detent-failure',
	]
	function record(node, action) {
		if (!(node instanceof Element)) return
		for (const selector of selectors) {
			const elements = [
				...(node.matches(selector) ? [node] : []),
				...node.querySelectorAll(selector),
			]
			for (const element of elements)
				probe.events.push({
					t: performance.now(),
					action,
					selector,
					text: element.textContent?.slice(0, 300),
				})
		}
	}
	new MutationObserver((records) => {
		for (const recordEntry of records) {
			for (const node of recordEntry.addedNodes) record(node, 'added')
			for (const node of recordEntry.removedNodes) record(node, 'removed')
		}
	}).observe(document, { childList: true, subtree: true })
	if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
		probe.supported = true
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries())
				probe.longTasks.push({ t: entry.startTime, ms: entry.duration, name: entry.name })
		}).observe({ type: 'longtask', buffered: true })
	}
	let previous = performance.now()
	setInterval(() => {
		const now = performance.now()
		probe.heartbeat.push({ t: now, gap: now - previous })
		previous = now
	}, 50)
}

async function launch() {
	const profile = mkdtempSync(join(tmpdir(), 'detent-e2e-'))
	const context = await chromium.launchPersistentContext(profile, {
		channel: undefined,
		executablePath: undefined,
		headless: false,
		viewport: { width: 1600, height: 1000 },
		args: [
			'--headless=new',
			`--disable-extensions-except=${EXTENSION_PATH}`,
			`--load-extension=${EXTENSION_PATH}`,
		],
	})
	context.setDefaultTimeout(15_000)
	context.setDefaultNavigationTimeout(60_000)
	const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
	await worker.evaluate(() => {
		globalThis.__gateDiffRequests = []
		const original = globalThis.fetch
		globalThis.fetch = async function (...args) {
			const url = String(args[0]?.url ?? args[0])
			if (!/\/pull\/\d+\.diff(?:\?|$)/.test(url)) return original.apply(this, args)
			const entry = { url, start: Date.now() }
			globalThis.__gateDiffRequests.push(entry)
			try {
				const response = await original.apply(this, args)
				Object.assign(entry, { status: response.status, finalUrl: response.url, end: Date.now() })
				return response
			} catch (error) {
				Object.assign(entry, { error: String(error), end: Date.now() })
				throw error
			}
		}
	})
	console.log(
		JSON.stringify({
			launch: { profile, worker: worker.url(), headlessArgument: '--headless=new' },
		}),
	)
	return { context, worker, profile }
}

async function state(page) {
	return page.evaluate(() => {
		const panel = document.querySelector('detent-panel')
		const root = panel?.shadowRoot
		return {
			url: location.href,
			title: document.title,
			loggedOut: !document.querySelector('meta[name="user-login"]')?.content,
			gate: document.querySelector('#detent-group')?.textContent,
			loading: document.querySelector('#detent-analyzing')?.textContent,
			panel: Boolean(root?.querySelector('aside')),
			tree: Boolean(document.querySelector('#detent-tree')),
			failure: document.querySelector('#detent-failure')?.textContent,
			footer: root?.querySelector('footer')?.textContent,
			layers: root?.querySelectorAll('ol li').length,
			sections: document.querySelectorAll('[data-tagsearch-path], [data-file-path]').length,
			inputs: [...document.querySelectorAll('input')].map((input) => ({
				id: input.id,
				placeholder: input.placeholder,
				ariaLabel: input.getAttribute('aria-label'),
				type: input.type,
			})),
			fileTabs: [...document.querySelectorAll('a[href*="/pull/"]')]
				.filter((link) => /\/(files|changes)$/.test(link.getAttribute('href') ?? ''))
				.map((link) => ({ href: link.getAttribute('href'), text: link.textContent?.trim() })),
		}
	})
}

async function evidence(page, label) {
	const screenshot = join(OUTPUT, `${label}.png`)
	await page.screenshot({ path: screenshot, timeout: 15_000 })
	const snapshot = await state(page)
	const probe = await page.evaluate(() => window.__detentGateProbe)
	return { screenshot, snapshot, probe }
}

async function mounted(page) {
	await page.waitForFunction(
		() => {
			return (
				document.querySelector('detent-panel')?.shadowRoot?.querySelector('aside') ||
				document.querySelector('#detent-tree') ||
				document.querySelector('#detent-failure')
			)
		},
		undefined,
		{ timeout: 90_000 },
	)
	const result = await state(page)
	if (result.failure) throw new Error(result.failure)
	return result
}

async function responsiveness(page) {
	const samples = []
	for (let index = 0; index < 6; index += 1) {
		const evaluateStart = performance.now()
		const value = await page.evaluate(() => 1)
		const evaluateMs = performance.now() - evaluateStart
		const scrollStart = performance.now()
		const scroll = await page.evaluate(
			(direction) => {
				const before = window.scrollY
				window.scrollBy({ top: direction * 200, behavior: 'instant' })
				return { before, after: window.scrollY }
			},
			index % 2 === 0 ? 1 : -1,
		)
		samples.push({ value, evaluateMs, scrollMs: performance.now() - scrollStart, ...scroll })
		await page.waitForTimeout(1700)
	}
	return {
		pass: samples.every((sample) => sample.evaluateMs < 1000 && sample.scrollMs < 1000),
		samples,
	}
}

async function filterCheck(page) {
	const selector =
		'input[placeholder*="file" i], input[aria-label*="file" i], #file-tree-filter-field'
	const inputs = page.locator(selector)
	for (let index = 0; index < (await inputs.count()); index += 1) {
		const input = inputs.nth(index)
		if (!(await input.isVisible()) || !(await input.isEditable())) continue
		const start = performance.now()
		await input.fill('route')
		const value = await input.inputValue()
		await input.fill('')
		return { pass: value === 'route', selector, index, value, ms: performance.now() - start }
	}
	return { status: 'not present when logged out', selector }
}

async function runCase(label, page, action) {
	const result = { label }
	REPORT.cases.push(result)
	console.log(`START ${label}`)
	try {
		Object.assign(result, await action())
	} catch (error) {
		result.error = String(error)
		result.pass = false
	}
	try {
		Object.assign(result, await evidence(page, label))
	} catch (error) {
		result.evidenceError = String(error)
	}
	save()
	console.log(
		JSON.stringify({
			label,
			pass: result.pass,
			error: result.error,
			screenshot: result.screenshot,
		}),
	)
	return result
}

async function suite(tab) {
	const { context, worker, profile } = await launch()
	const page = await context.newPage()
	await page.addInitScript(instrument)
	page.on('console', (message) => {
		if (message.text().includes('[detent]'))
			console.log('detent console:', message.text().slice(0, 500))
	})
	page.on('pageerror', (error) => console.log('page error:', String(error).slice(0, 500)))
	const diffRequests = () => worker.evaluate(() => globalThis.__gateDiffRequests)
	try {
		const gate = await runCase(`${tab}-large-before`, page, async () => {
			const response = await page.goto(`${LARGE}/${tab}`, { waitUntil: 'domcontentloaded' })
			await page.waitForSelector('#detent-group', { timeout: 20_000 })
			const initial = await state(page)
			const responsive = await responsiveness(page)
			const filter = await filterCheck(page)
			const requests = await diffRequests()
			const probe = await page.evaluate(() => window.__detentGateProbe)
			const prematureBadges = probe.events.filter(
				(event) => event.action === 'added' && event.selector === '#detent-analyzing',
			)
			return {
				profile,
				httpStatus: response?.status(),
				initial,
				responsive,
				filter,
				requests,
				prematureBadges,
				pass:
					initial.loggedOut &&
					initial.gate === 'Large pull request (570 files). Group with detent' &&
					!initial.loading &&
					!initial.panel &&
					!initial.tree &&
					// The header's code lines download the diff once, counted in the service worker; the gate only
					// holds back grouping.
					requests.length <= 1 &&
					responsive.pass &&
					filter.pass !== false,
			}
		})
		if (gate.snapshot?.gate) {
			await runCase(`${tab}-large-activate`, page, async () => {
				const start = performance.now()
				const mark = await page.evaluate(() => performance.now())
				if (tab === 'changes') {
					await page.locator('#detent-group').focus()
					await page.locator('#detent-group').press('Enter')
				} else await page.locator('#detent-group').click()
				const result = await mounted(page)
				const panelMountMs = performance.now() - start
				await page.waitForTimeout(1500)
				const probe = await page.evaluate(() => window.__detentGateProbe)
				const tasks = probe.longTasks.filter((task) => task.t + task.ms >= mark)
				const heartbeat = probe.heartbeat.filter((sample) => sample.t >= mark)
				const loading = probe.events.filter(
					(event) =>
						event.t >= mark && event.action === 'added' && event.selector === '#detent-analyzing',
				)
				const consent = await worker.evaluate(() =>
					chrome.storage.session.get('large:tanstack/router/8658'),
				)
				return {
					pass:
						!result.gate &&
						(result.panel || result.tree) &&
						loading.length > 0 &&
						consent['large:tanstack/router/8658'] === true,
					activation: tab === 'changes' ? 'Enter' : 'click',
					panelMountMs,
					loading,
					consent,
					longTaskCount: tasks.length,
					longestLongTaskMs: Math.max(0, ...tasks.map((task) => task.ms)),
					maxHeartbeatGapMs: Math.max(0, ...heartbeat.map((sample) => sample.gap)),
					requests: await diffRequests(),
				}
			})
			await runCase(`${tab}-large-reload`, page, async () => {
				const start = performance.now()
				await page.reload({ waitUntil: 'domcontentloaded' })
				const result = await mounted(page)
				const probe = await page.evaluate(() => window.__detentGateProbe)
				const gateEvents = probe.events.filter(
					(event) => event.selector === '#detent-group' && event.action === 'added',
				)
				return {
					pass: !result.gate && gateEvents.length === 0 && (result.panel || result.tree),
					mountMs: performance.now() - start,
					gateEvents,
					requests: await diffRequests(),
				}
			})
		}
		await runCase(`${tab}-small-auto`, page, async () => {
			const start = performance.now()
			const response = await page.goto(`${SMALL}/${tab}`, { waitUntil: 'domcontentloaded' })
			const result = await mounted(page)
			const probe = await page.evaluate(() => window.__detentGateProbe)
			const gateEvents = probe.events.filter(
				(event) => event.selector === '#detent-group' && event.action === 'added',
			)
			return {
				pass:
					result.loggedOut &&
					!result.gate &&
					gateEvents.length === 0 &&
					(result.panel || result.tree),
				httpStatus: response?.status(),
				mountMs: performance.now() - start,
				gateEvents,
				requests: await diffRequests(),
			}
		})
	} finally {
		await context.close()
	}
}

console.log(`Evidence directory: ${OUTPUT}`)
try {
	await suite('files')
	await suite('changes')
} catch (error) {
	REPORT.fatal = String(error)
	console.error(REPORT.fatal)
	process.exitCode = 1
} finally {
	REPORT.finished = new Date().toISOString()
	if (REPORT.cases.some((result) => result.pass === false)) process.exitCode = 1
	save()
	console.log(`Report: ${join(OUTPUT, 'report.json')}`)
}
