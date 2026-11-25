// Loads the built extension into headless Chromium, logged out, and checks the double-click to mark
// viewed switch on the classic Files changed page of a public pull request.
// Usage: bun tooling/double-click-viewed-e2e.mjs [pull request files url]
// Screenshots and report.json land in a fresh /tmp/detent-double-click-e2e-* directory (E2E_OUTPUT moves it).
//
// Signed out, GitHub serves no Viewed checkbox. The script then adds one to the file's header with
// GitHub's markup (form > label.js-reviewed-toggle > input.js-reviewed-checkbox[name=viewed]) and a
// change handler that does what GitHub's does: toggle data-file-user-viewed and collapse the file. The
// file box, its header and its diff lines are GitHub's own.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const extensionPath = join(import.meta.dirname, '..', '.output', 'chrome-mv3')
const url = process.argv[2] ?? 'https://github.com/TanStack/router/pull/8170/files'
const output = mkdtempSync(join(process.env.E2E_OUTPUT ?? '/tmp', 'detent-double-click-e2e-'))
const profile = mkdtempSync(join(tmpdir(), 'detent-e2e-'))
const report = { url, output, steps: [] }

const context = await chromium.launchPersistentContext(profile, {
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

function check(condition, message, detail) {
	if (!condition) throw new Error(`${message}: ${JSON.stringify(detail)}`)
	console.log('ok:', message)
}

const worker = async () =>
	context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))

async function setSwitch(isOn) {
	await (await worker()).evaluate(async (doubleClickViewed) => {
		const { settings } = await chrome.storage.local.get('settings')
		await chrome.storage.local.set({ settings: { ...settings, doubleClickViewed } })
	}, isOn)
}

const fileState = (page) =>
	page.evaluate(() => {
		const section = document.querySelector('[data-e2e-file]')
		const box = section?.getBoundingClientRect()
		const checkbox = section?.querySelector('.js-reviewed-checkbox')

		return {
			checked: checkbox?.checked ?? null,
			userViewed: section?.hasAttribute('data-file-user-viewed') ?? null,
			sectionTop: box ? Math.round(box.top) : null,
			sectionHeight: box ? Math.round(box.height) : null,
			selection: document.getSelection()?.toString() ?? '',
			isSameHost: document.querySelector('detent-panel') === window.__detentHost,
		}
	})

async function step(page, name) {
	const state = await fileState(page)
	const path = join(output, `${String(report.steps.length + 1).padStart(2, '0')}-${name}.png`)
	await page.screenshot({ path })
	report.steps.push({ name, screenshot: path, state })
	console.log(`${name}:`, JSON.stringify(state))

	return state
}

// The line sits mid-screen with the file's header scrolled away above it, as when reading a long diff.
async function doubleClickLine(page) {
	await page.evaluate(() => {
		const line = document.querySelector('[data-e2e-line]')
		window.scrollTo({ top: line.getBoundingClientRect().top + window.scrollY - 500 })
	})
	await page.waitForTimeout(300)
	await page.dblclick('[data-e2e-line]')
	await page.waitForTimeout(800)
}

try {
	const page = await context.newPage()
	page.on('console', (message) => {
		if (message.text().includes('[detent]')) console.log('console:', message.text())
	})
	await page.goto(url, { waitUntil: 'domcontentloaded' })
	await page.waitForSelector('detent-panel', { state: 'attached', timeout: 30_000 })
	await page.waitForSelector('.js-file td.js-file-line', { timeout: 30_000 })
	await page.waitForTimeout(2000)

	// The first file long enough that its header is off screen while a line in it is read.
	const picked = await page.evaluate(() => {
		const sections = [...document.querySelectorAll('#files .js-file[data-tagsearch-path]')]
		const section = sections.find(
			(candidate) => candidate.querySelectorAll('td.js-file-line').length >= 40,
		)
		if (!section) return undefined

		const hasGitHubCheckbox = Boolean(section.querySelector('.js-reviewed-checkbox'))
		if (!hasGitHubCheckbox) {
			const form = document.createElement('form')
			form.className = 'js-replace-file-header-review'
			form.innerHTML =
				'<label class="form-control d-flex js-reviewed-toggle"><input class="js-reviewed-checkbox" type="checkbox" name="viewed" value="true"> Viewed</label>'
			;(section.querySelector('.file-actions') ?? section.querySelector('.file-header'))?.append(
				form,
			)
			const checkbox = form.querySelector('input')
			checkbox.addEventListener('change', () => {
				section.toggleAttribute('data-file-user-viewed', checkbox.checked)
				section.classList.toggle('Details--on', !checkbox.checked)
				const content = section.querySelector('.js-file-content')
				if (content) content.style.display = checkbox.checked ? 'none' : ''
			})
		}
		const lines = [...section.querySelectorAll('td.js-file-line')]
		// A word on the line, not the blank right side of its cell, so the browser has one to select.
		const line = lines
			.slice(30)
			.map((cell) =>
				[...cell.querySelectorAll('.blob-code-inner span')].find((token) =>
					/^[A-Za-z_]\w{2,}$/.test(token.textContent.trim()),
				),
			)
			.find(Boolean)
		if (!line) return undefined
		section.setAttribute('data-e2e-file', '')
		line.setAttribute('data-e2e-line', '')
		section.querySelector('.file-header')?.setAttribute('data-e2e-header', '')
		window.__detentHost = document.querySelector('detent-panel')

		return {
			path: section.getAttribute('data-tagsearch-path'),
			hasGitHubCheckbox,
			lines: lines.length,
			word: line.textContent.trim(),
		}
	})
	console.log('file:', JSON.stringify(picked))
	check(picked, 'a file with at least 40 diff lines is on the page', picked)
	report.file = picked
	if (!picked.hasGitHubCheckbox)
		console.log(
			'note: signed out, GitHub serves no Viewed checkbox; a stand-in with its markup was added',
		)

	await doubleClickLine(page)
	let state = await step(page, 'off-by-default')
	check(
		!state.checked && !state.userViewed,
		'with the switch off a double-click marks nothing',
		state,
	)
	check(state.selection.length > 0, 'and the browser keeps the word it selected', state)

	await setSwitch(true)
	await page.waitForTimeout(1000)
	state = await fileState(page)
	check(state.isSameHost, 'turning the switch on keeps the mounted panel', state)

	await doubleClickLine(page)
	state = await step(page, 'viewed')
	check(
		state.checked && state.userViewed,
		'a double-click on a diff line marks the file viewed',
		state,
	)
	check(state.selection === '', 'the word the double-click selected is cleared', state)
	check(
		state.sectionTop !== null && state.sectionTop >= 0 && state.sectionTop < 200,
		'the collapsed file keeps its header on screen',
		state,
	)

	// A blank spot of the header: no link, button or the Viewed toggle under the pointer.
	const blank = await page.evaluate(() => {
		const header = document.querySelector('[data-e2e-header]')
		const box = header.getBoundingClientRect()
		const y = box.top + box.height / 2
		for (let x = box.right - 10; x > box.left; x -= 8) {
			const hit = document.elementFromPoint(x, y)
			if (hit && header.contains(hit) && !hit.closest('a, button, input, label, form, summary'))
				return { x, y }
		}

		return undefined
	})
	check(blank, 'the header has a blank spot to double-click', blank)
	await page.mouse.dblclick(blank.x, blank.y)
	await page.waitForTimeout(800)
	state = await step(page, 'unviewed')
	check(
		!state.checked && !state.userViewed,
		'a double-click on the header marks it unviewed',
		state,
	)

	await setSwitch(false)
	await page.waitForTimeout(1000)
	await doubleClickLine(page)
	state = await step(page, 'off-again')
	check(
		!state.checked && !state.userViewed,
		'switched off again, a double-click marks nothing',
		state,
	)
	check(state.isSameHost, 'turning the switch off keeps the mounted panel', state)

	report.passed = true
	console.log('all checks passed; screenshots in', output)
} finally {
	writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2))
	await context.close()
	rmSync(profile, { recursive: true, force: true })
}
