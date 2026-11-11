// Headless check of "Continue with ChatGPT" without signing in:
// 1. The popup's button opens OpenAI's authorize URL, which lands on a login page, not an OAuth error.
// 2. A faked consent redirect from an auth.openai.com page (served by Playwright, not OpenAI) to the
//    loopback callback lands on detent's callback page through the declarativeNetRequest rule. A
//    server listening on 127.0.0.1:47801 must see nothing. The service worker then reaches OpenAI's
//    token endpoint with the fake code, which must answer invalid_grant.
// 3. The popup shows the signed-out state with that one error line.
// Usage: bun run build && node tooling/chatgpt-e2e.mjs
import { mkdirSync, mkdtempSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const extensionPath = join(import.meta.dirname, '..', '.output', 'chrome-mv3')
const out = process.env.E2E_OUT ?? '/tmp/detent-chatgpt-e2e'
mkdirSync(out, { recursive: true })
// Cloudflare in front of auth.openai.com never clears a HeadlessChrome user agent.
const USER_AGENT =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'
const OAUTH_ERROR =
	/invalid_request|invalid_client|unauthorized_client|invalid_scope|invalid_redirect|unknown client|Something went wrong|Oops/i

const failures = []
const check = (condition, label) => {
	console.log(`${condition ? 'PASS' : 'FAIL'} ${label}`)
	if (!condition) failures.push(label)
}

// Anything reaching this port means the code left the browser.
const leaks = []
const listener = createServer((request, response) => {
	leaks.push(request.url)
	response.end('leaked')
})
await new Promise((resolve, reject) => {
	listener.once('error', reject)
	listener.listen(47_801, '127.0.0.1', resolve)
})

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'detent-e2e-')), {
	headless: false,
	viewport: { width: 1280, height: 900 },
	args: [
		'--headless=new',
		`--disable-extensions-except=${extensionPath}`,
		`--load-extension=${extensionPath}`,
		'--disable-blink-features=AutomationControlled',
		`--user-agent=${USER_AGENT}`,
	],
})

try {
	const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
	const extensionId = new URL(worker.url()).host
	const popupUrl = `chrome-extension://${extensionId}/popup.html`
	const popup = await context.newPage()
	await popup.goto(popupUrl)
	await popup.getByText('ChatGPT', { exact: true }).click()

	const authPagePromise = context.waitForEvent('page')
	await popup.getByRole('button', { name: 'Continue with ChatGPT' }).click()
	const auth = await authPagePromise
	await auth.waitForLoadState('domcontentloaded')
	const authorizeUrl = new URL(
		auth.url().startsWith('https://auth.openai.com') ? auth.url() : 'about:blank',
	)
	await auth.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
	for (
		let waited = 0;
		waited < 30_000 && /Just a moment/i.test(await auth.title().catch(() => ''));
		waited += 1000
	)
		await auth.waitForTimeout(1000)
	await auth.waitForTimeout(2000)
	const landedText = (await auth.evaluate(() => document.body?.innerText ?? '').catch(() => ''))
		.replace(/\s+/g, ' ')
		.slice(0, 300)
	await auth.screenshot({ path: join(out, '01-authorize.png') })
	console.log('authorize landed:', auth.url().slice(0, 120), '|', landedText.slice(0, 120))
	check(authorizeUrl.origin === 'https://auth.openai.com', 'the button opens auth.openai.com')
	check(!/Just a moment/i.test(await auth.title()), 'Cloudflare let the request through')
	check(
		!OAUTH_ERROR.test(`${new URL(auth.url()).searchParams.get('error') ?? ''} ${landedText}`),
		'OpenAI answers the authorize request with a login page, not an OAuth error',
	)

	const pending = await worker.evaluate(
		() =>
			new Promise((resolve, reject) => {
				const open = indexedDB.open('detent-chatgpt')
				open.onerror = () => reject(open.error)
				open.onsuccess = () => {
					const read = open.result.transaction('vault').objectStore('vault').get('pending')
					read.onsuccess = () => resolve(read.result)
					read.onerror = () => reject(read.error)
				}
			}),
	)
	check(Boolean(pending?.state && pending?.verifier), 'the attempt is kept in the worker vault')

	// The consent click on auth.openai.com answers with a 302 to the loopback callback. Both pages
	// are faked here, on the auth.openai.com origin, so the navigation has the real initiator.
	const callback = `http://127.0.0.1:47801/auth/callback?code=detent-e2e-fake-code&state=${encodeURIComponent(pending.state)}&client_id=oaiapp_detent_e2e_fake&scope=openid`
	await context.route('https://auth.openai.com/detent-e2e/consent', (route) =>
		route.fulfill({
			contentType: 'text/html',
			body: '<a id="approve" href="/detent-e2e/approve">Allow</a>',
		}),
	)
	await context.route('https://auth.openai.com/detent-e2e/approve', (route) =>
		route.fulfill({ status: 302, headers: { Location: callback } }),
	)
	await auth.goto('https://auth.openai.com/detent-e2e/consent')
	await auth.click('#approve')
	await auth.waitForURL(/chatgpt-callback\.html/, { timeout: 10_000 }).catch(() => {})
	console.log('callback landed:', auth.url())
	check(
		auth.url() === `chrome-extension://${extensionId}/chatgpt-callback.html`,
		'the callback lands on the extension page, its query already cleared',
	)
	await auth
		.getByText(/invalid_grant|failed|Signed in/)
		.waitFor({ timeout: 20_000 })
		.catch(() => {})
	const callbackText = await auth.locator('#status').textContent()
	console.log('callback page:', callbackText)
	await auth.screenshot({ path: join(out, '02-callback.png') })
	check(
		callbackText?.includes('invalid_grant') === true,
		'the token endpoint saw the fake code and answered invalid_grant',
	)
	check(leaks.length === 0, `nothing reached 127.0.0.1:47801 (${leaks.length} requests)`)

	await popup.reload()
	await popup.getByRole('button', { name: 'Continue with ChatGPT' }).waitFor()
	const alert = await popup.getByRole('alert').textContent()
	console.log('popup notice:', alert)
	await popup.screenshot({ path: join(out, '03-popup.png'), fullPage: true })
	check(alert?.includes('invalid_grant') === true, 'the popup shows the failure in one line')
} finally {
	await context.close()
	listener.close()
}

console.log(failures.length === 0 ? 'ALL PASSED' : `${failures.length} FAILED`)
process.exit(failures.length === 0 ? 0 : 1)
