// Opens review-comment links with the built extension, headless and logged out, and checks that the
// linked comment is on screen and its file is detent's current file once grouping is done.
// Usage: bun tooling/review-anchor-e2e.mjs
//
// Logged out GitHub serves the classic Files changed page, so the real page covers the panel. The
// Changes page (detent's tree, which reorders the files) needs a session; that case serves a small
// hand-written Changes page at the real /changes URL, built from the pull request's public diff, and
// scrolls to the comment first the way GitHub does before detent groups the page.
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const EXTENSION_PATH = join(import.meta.dirname, '..', '.output', 'chrome-mv3')
const OUTPUT = mkdtempSync(join(tmpdir(), 'detent-anchor-e2e-'))
const PULL = 'https://github.com/TanStack/router/pull/8882'
const COMMENT = 'r4479369071'
const COMMENTED = 'packages/start-server-core/src/createStartHandler.ts'
const SETTLE_MILLISECONDS = 4000
const REPORT = { output: OUTPUT, started: new Date().toISOString(), cases: [] }
mkdirSync(OUTPUT, { recursive: true })

const anchorOf = (path) => `diff-${createHash('sha256').update(path).digest('hex')}`

async function launch() {
	const context = await chromium.launchPersistentContext(
		mkdtempSync(join(tmpdir(), 'detent-e2e-')),
		{
			headless: false,
			viewport: { width: 1600, height: 1000 },
			args: [
				'--headless=new',
				`--disable-extensions-except=${EXTENSION_PATH}`,
				`--load-extension=${EXTENSION_PATH}`,
			],
		},
	)
	context.setDefaultTimeout(30_000)
	context.setDefaultNavigationTimeout(60_000)
	if (context.serviceWorkers().length === 0) await context.waitForEvent('serviceworker')

	return context
}

// Where the target is, which file detent holds as current, and whether the hash survived.
const observe = (page, id) =>
	page.evaluate((targetId) => {
		const target = document.getElementById(targetId)
		const rect = target?.getBoundingClientRect()
		const panel = document.querySelector('detent-panel')?.shadowRoot
		const panelFile = panel
			?.querySelector('ul li button[aria-current="true"] span[title]')
			?.getAttribute('title')
		const treeFile = document
			.querySelector('#detent-tree li[aria-selected="true"][data-path]')
			?.getAttribute('data-path')
		return {
			hash: location.hash,
			scrollY: Math.round(scrollY),
			target: rect && { top: Math.round(rect.top), bottom: Math.round(rect.bottom) },
			inView: Boolean(rect && rect.bottom > 60 && rect.top < innerHeight),
			current: panelFile ?? treeFile,
			sections: document.querySelectorAll('[data-detent-section]').length,
		}
	}, id)

async function runCase(label, action) {
	const result = { label }
	REPORT.cases.push(result)
	try {
		Object.assign(result, await action(result))
	} catch (error) {
		result.pass = false
		result.error = String(error)
	}
	writeFileSync(join(OUTPUT, 'report.json'), JSON.stringify(REPORT, null, 2))
	console.log(JSON.stringify(result))
}

async function filesPage(context) {
	const page = await context.newPage()
	await page.goto(`${PULL}/files#${COMMENT}`, { waitUntil: 'domcontentloaded' })
	await page.waitForFunction(() =>
		document.querySelector('detent-panel')?.shadowRoot?.querySelector('aside'),
	)
	await page.waitForTimeout(SETTLE_MILLISECONDS)
	const seen = await observe(page, COMMENT)
	const screenshot = join(OUTPUT, 'files-review-comment.png')
	await page.screenshot({ path: screenshot })
	await page.close()

	return {
		screenshot,
		...seen,
		pass: seen.inView && seen.hash === `#${COMMENT}` && seen.current === COMMENTED,
	}
}

// The minimum of the Changes page detent reads: the size, a native tree row to clone, and one
// progressive diff entry per file. The comment sits deep in its file, which sits deep in the list.
function changesPage(paths) {
	const entry = (path) => `
		<div class="Diff-module__diffEntry">
			<div role="region" id="${anchorOf(path)}">
				<div data-diff-header-wrapper style="height:40px;border-bottom:1px solid #ccc">
					<span class="file-path-section">${path}</span>
					<button aria-pressed="false" aria-label="Not Viewed">Viewed</button>
				</div>
				<div style="height:700px">diff of ${path}</div>
				${path === COMMENTED ? `<div id="${COMMENT}" style="height:160px;background:#fde68a">review comment</div><div style="height:300px"></div>` : ''}
			</div>
		</div>`
	const row = (path) => `
		<li role="treeitem" id="${path}" aria-level="1" aria-selected="false">
			<div class="PRIVATE_TreeView-item-container" style="--level:1">
				<div class="PRIVATE_TreeView-item-content">
					<a href="#${anchorOf(path)}"><span class="PRIVATE_TreeView-item-content-text">${path.split('/').at(-1)}</span></a>
				</div>
			</div>
		</li>`

	return `<!doctype html><html><head><title>Changes · Pull Request #8882</title></head><body style="margin:0">
		<a href="/TanStack/router/pull/8882/changes">Files changed <span class="Counter">${paths.length}</span></a>
		<span class="sr-only">Lines changed: 400 additions &amp; 20 deletions</span>
		<div style="display:flex;align-items:flex-start">
			<aside style="width:320px;position:sticky;top:0">
				<span class="ViewedFileProgress-module__ProgressContainer">0 / ${paths.length} viewed</span><span class="sr-only">0 of ${paths.length} files viewed</span>
				<ul role="tree" aria-label="File Tree">${paths.map(row).join('')}</ul>
			</aside>
			<div data-testid="progressive-diffs-list" style="display:flex;flex-direction:column;flex:1">${paths.map(entry).join('')}</div>
		</div>
		<script>
			// GitHub scrolls to the linked comment as soon as it is rendered, well before detent groups.
			setTimeout(() => document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'center' }), 300)
		</script>
	</body></html>`
}

async function changesTab(context) {
	const diff = await (await fetch(`${PULL}.diff`)).text()
	const paths = [...diff.matchAll(/^diff --git a\/\S+ b\/(\S+)$/gm)].map((match) => match[1])
	const page = await context.newPage()
	await page.route(`${PULL}/changes`, (route) =>
		route.fulfill({ status: 200, contentType: 'text/html', body: changesPage(paths) }),
	)
	await page.goto(`${PULL}/changes#${COMMENT}`, { waitUntil: 'domcontentloaded' })
	await page.waitForFunction(() => document.querySelector('[data-detent-section]'))
	await page.waitForTimeout(SETTLE_MILLISECONDS)
	const seen = await observe(page, COMMENT)
	const order = await page.evaluate(
		(id) => document.getElementById(id)?.closest('[class*="diffEntry"]')?.style.order,
		anchorOf(COMMENTED),
	)
	const screenshot = join(OUTPUT, 'changes-review-comment.png')
	await page.screenshot({ path: screenshot })
	await page.close()

	return {
		screenshot,
		files: paths.length,
		commentedFileOrder: order,
		...seen,
		pass:
			seen.sections > 0 && seen.inView && seen.hash === `#${COMMENT}` && seen.current === COMMENTED,
	}
}

console.log(`Evidence directory: ${OUTPUT}`)
const context = await launch()
try {
	await runCase('files-review-comment', () => filesPage(context))
	await runCase('changes-review-comment', () => changesTab(context))
} finally {
	await context.close()
	REPORT.finished = new Date().toISOString()
	writeFileSync(join(OUTPUT, 'report.json'), JSON.stringify(REPORT, null, 2))
	if (REPORT.cases.some((result) => !result.pass)) process.exitCode = 1
	console.log(`Report: ${join(OUTPUT, 'report.json')}`)
}
