// Measures the extension on a real Changes page in Helium's logged-in test profile: scroll
// movements around mount and grouping, a CPU profile of a Viewed click and of a tree-row click,
// and whether reordering entries moves the viewport (scroll anchoring).
// Usage: bun tooling/changes-probe.mjs <pull request changes url> [settle seconds]
// The profile is the one capture-dom.mjs uses; when it is signed out, log in to GitHub in the
// window that opens and the probe continues on its own.

import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const url = process.argv[2]
if (!url) throw new Error('pull request url required')
const settleSeconds = Number(process.argv[3] ?? 45)
const extensionPath = join(import.meta.dirname, '..', '.output', 'chrome-mv3')
const profile = join(homedir(), 'Library', 'Application Support', 'detent-for-github-helium')

const context = await chromium.launchPersistentContext(profile, {
	executablePath: '/Applications/Helium.app/Contents/MacOS/Helium',
	headless: false,
	viewport: { width: 1600, height: 1000 },
	args: [
		...(process.env.PROBE_HEADED ? [] : ['--headless=new']),
		`--disable-extensions-except=${extensionPath}`,
		`--load-extension=${extensionPath}`,
	],
})

// Runs in the main world before GitHub's scripts: GitHub's own scroll calls are visible here,
// the content script's are not (isolated world), which tells the two apart.
const PROBE_INIT = () => {
	const probe = { events: [], samples: [], longTasks: [] }
	window.__probe = probe
	const t = () => Math.round(performance.now())
	const log = (kind, detail) => probe.events.push({ t: t(), kind, detail, y: Math.round(scrollY) })
	for (const name of ['scrollTo', 'scrollBy', 'scroll']) {
		const original = window[name]
		window[name] = function (...args) {
			log(
				`window.${name}`,
				JSON.stringify(args).slice(0, 80) +
					'\n' +
					new Error().stack?.split('\n').slice(2, 4).join(' | ').slice(0, 200),
			)
			return original.apply(this, args)
		}
	}
	const scrollIntoView = Element.prototype.scrollIntoView
	Element.prototype.scrollIntoView = function (...args) {
		log(
			'scrollIntoView',
			`${this.tagName}#${this.id} ` +
				new Error().stack?.split('\n').slice(2, 4).join(' | ').slice(0, 200),
		)
		return scrollIntoView.apply(this, args)
	}
	window.addEventListener('hashchange', () => log('hashchange', location.hash.slice(0, 20)))
	new PerformanceObserver((list) => {
		for (const entry of list.getEntries())
			probe.longTasks.push({ t: Math.round(entry.startTime), ms: Math.round(entry.duration) })
	}).observe({ type: 'longtask', buffered: true })
	setInterval(() => {
		const list = document.querySelector('[data-testid="progressive-diffs-list"]')
		probe.samples.push({
			t: t(),
			y: Math.round(scrollY),
			entries: list ? list.childElementCount : -1,
			status: document.querySelector('#detent-tree > div:last-child')?.textContent?.slice(0, 60),
		})
	}, 250)
}

const summarizeProfile = (profile) => {
	const self = new Map()
	const byId = new Map(profile.nodes.map((node) => [node.id, node]))
	for (const [index, id] of profile.samples.entries()) {
		const node = byId.get(id)
		if (!node) continue
		const frame = node.callFrame
		const url = frame.url
			.replace(/^chrome-extension:\/\/[^/]+/, 'ext:')
			.replace(/^https:\/\/github\.githubassets\.com\/assets\//, 'gh:')
		const key = `${frame.functionName || '(anonymous)'} ${url.slice(-60)}:${frame.lineNumber}`
		self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[index] ?? 0))
	}
	const total = [...self.values()].reduce((sum, value) => sum + value, 0)
	const ext = [...self]
		.filter(([key]) => key.includes('ext:'))
		.reduce((sum, [, value]) => sum + value, 0)
	console.log(
		`  sampled ${Math.round(total / 1000)} ms total, ${Math.round(ext / 1000)} ms in extension frames`,
	)
	for (const [key, value] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 14))
		console.log(`  ${String(Math.round(value / 1000)).padStart(5)} ms  ${key}`)
}

async function profiled(page, cdp, label, action) {
	console.log(`\n== ${label}`)
	await page.evaluate(() => {
		window.__probe.longTasks.length = 0
	})
	await cdp.send('Profiler.start')
	const started = Date.now()
	await action()
	await page.waitForTimeout(2500)
	const { profile } = await cdp.send('Profiler.stop')
	summarizeProfile(profile)
	const tasks = await page.evaluate(() => window.__probe.longTasks)
	console.log(
		`  long tasks: ${tasks.map((task) => `${task.ms}ms`).join(', ') || 'none'} (${Date.now() - started} ms wall)`,
	)
}

try {
	const page = await context.newPage()
	await page.addInitScript(PROBE_INIT)
	page.on('console', (message) => {
		if (message.text().includes('[detent]')) console.log('console:', message.text().slice(0, 200))
	})
	const cdp = await context.newCDPSession(page)
	await cdp.send('Profiler.enable')
	await cdp.send('Profiler.setSamplingInterval', { interval: 200 })

	await page.goto(url, { waitUntil: 'domcontentloaded' })
	const signedIn = () =>
		page.evaluate(() => document.querySelector('meta[name="user-login"]')?.content || '')
	if (!(await signedIn())) {
		if (!process.env.PROBE_HEADED)
			throw new Error('Not signed in. Run with PROBE_HEADED=1 and log in to GitHub in the window.')
		console.log('Not signed in. Log in to GitHub in the Helium window; waiting for the login.')
		await page.waitForFunction(
			() => Boolean(document.querySelector('meta[name="user-login"]')?.content),
			undefined,
			{ timeout: 300_000 },
		)
		await page.goto(url, { waitUntil: 'domcontentloaded' })
	}
	console.log('signed in as:', await signedIn())
	await page.waitForTimeout(settleSeconds * 1000)
	console.log('url now:', page.url())

	const probe = await page.evaluate(() => window.__probe)
	console.log('\n== timeline (t ms, scrollY, loaded entries, detent status)')
	let last = ''
	for (const sample of probe.samples) {
		const line = `${sample.y} ${sample.entries} ${sample.status ?? ''}`
		if (line === last) continue
		last = line
		console.log(
			`  ${String(sample.t).padStart(6)}  y=${sample.y}  entries=${sample.entries}  ${sample.status ?? ''}`,
		)
	}
	console.log('\n== scroll calls from GitHub scripts and hash changes')
	for (const event of probe.events)
		console.log(`  ${String(event.t).padStart(6)}  ${event.kind} y=${event.y}  ${event.detail}`)
	console.log(
		'\n== long tasks during load:',
		probe.longTasks.map((task) => `${task.t}:${task.ms}ms`).join(' '),
	)

	// Scroll anchoring: with the viewport on the first entry, push that entry to the end by `order`.
	console.log('\n== reorder experiment')
	const anchoring = await page.evaluate(() => {
		const list = document.querySelector('[data-testid="progressive-diffs-list"]')
		const entries = [...list.children].filter((entry) => /diffEntry/.test(entry.className))
		const first = entries.find((entry) => entry.getBoundingClientRect().height > 0)
		if (!first) return 'no entries'
		window.scrollTo({ top: first.getBoundingClientRect().top + scrollY - 100 })
		void list.offsetHeight
		const before = scrollY
		const previous = first.style.order
		first.style.order = '5000000'
		void list.offsetHeight
		const after = scrollY
		first.style.order = previous
		void list.offsetHeight
		return { before, after, restored: scrollY, anchorStyle: getComputedStyle(list).overflowAnchor }
	})
	console.log('  ', JSON.stringify(anchoring))

	await page.evaluate(() => window.scrollTo({ top: 0 }))
	await page.waitForTimeout(500)

	const viewed = page
		.locator(
			'button[aria-pressed][aria-label="Viewed"], button[aria-pressed][aria-label="Not Viewed"]',
		)
		.first()
	if (await viewed.count()) {
		await viewed.scrollIntoViewIfNeeded()
		await page.waitForTimeout(800)
		const pressed = await viewed.getAttribute('aria-pressed')
		await profiled(page, cdp, `Viewed click (was ${pressed})`, async () => {
			await viewed.click()
			await page
				.waitForFunction(
					([selector, expected]) =>
						document.querySelector(selector)?.getAttribute('aria-pressed') === expected,
					[
						`button[aria-pressed][aria-label="${pressed === 'true' ? 'Viewed' : 'Not Viewed'}"]`,
						pressed === 'true' ? 'false' : 'true',
					],
					{ timeout: 5000 },
				)
				.catch(() => console.log('  aria-pressed did not flip in 5 s'))
		})
		await profiled(page, cdp, 'Viewed click back', () => viewed.click())
	} else console.log('no Viewed button (not signed in?)')

	const row = page.locator('#detent-tree li[data-path]').nth(3)
	if (await row.count()) await profiled(page, cdp, 'tree row click', () => row.click())
} finally {
	await context.close()
}
